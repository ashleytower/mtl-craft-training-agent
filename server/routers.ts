import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { 
  createConversation,
  getUserConversations,
  getConversationMessages,
  addMessage,
  searchCocktails,
  getCocktailById,
  getCocktailIngredients,
  getAllCocktails
} from "./db";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { storagePut } from "./storage";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Storage upload
  storage: router({
    upload: publicProcedure
      .input(z.object({
        key: z.string(),
        data: z.string(), // base64 encoded
        contentType: z.string(),
      }))
      .mutation(async ({ input }) => {
        // Decode base64 to buffer
        const buffer = Buffer.from(input.data, 'base64');
        
        // Upload to S3
        const result = await storagePut(input.key, buffer, input.contentType);
        
        return result;
      }),
  }),

  // Voice transcription
  voice: router({
    transcribe: publicProcedure
      .input(z.object({
        audioUrl: z.string(),
        language: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await transcribeAudio({
          audioUrl: input.audioUrl,
          language: input.language,
        });
        
        // Check if it's an error response
        if ('error' in result) {
          throw new Error(result.error);
        }
        
        return { text: result.text };
      }),
  }),

  // Cocktail knowledge base
  cocktails: router({
    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        return searchCocktails(input.query);
      }),
    
    getById: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const cocktail = await getCocktailById(input.id);
        if (!cocktail) return null;
        
        const ingredientsList = await getCocktailIngredients(input.id);
        return { ...cocktail, ingredients: ingredientsList };
      }),
    
    getAll: publicProcedure.query(async () => {
      return getAllCocktails();
    }),
  }),

  // Simple chat with LLM
  chat: router({
    // Create a new conversation
    createConversation: protectedProcedure
      .input(z.object({
        title: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const conversationId = await createConversation({
          userId: ctx.user.id,
          title: input.title || "New Conversation",
        });
        return { conversationId };
      }),

    // Get user's conversations
    getConversations: protectedProcedure.query(async ({ ctx }) => {
      return getUserConversations(ctx.user.id);
    }),

    // Get messages for a conversation
    getMessages: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .query(async ({ input }) => {
        return getConversationMessages(input.conversationId);
      }),

    // Send a message and get AI response with recipe detection
    sendMessage: publicProcedure
      .input(z.object({
        conversationId: z.number().optional(),
        message: z.string(),
        audioUrl: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // Store user message
        let conversationId = input.conversationId;
        
        if (!conversationId && ctx.user) {
          // Create new conversation if needed
          conversationId = await createConversation({
            userId: ctx.user.id,
            title: input.message.substring(0, 50),
          });
        }

        if (conversationId) {
          await addMessage({
            conversationId,
            role: "user",
            content: input.message,
            audioUrl: input.audioUrl,
          });
        }

        // Get conversation history if available
        let history: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
        if (conversationId) {
          const messages = await getConversationMessages(conversationId);
          history = messages.slice(-6).map(m => ({ 
            role: m.role as "user" | "assistant" | "system", 
            content: m.content 
          }));
        }

        // Check if user is asking about specific cocktails
        const allCocktails = await getAllCocktails();
        const mentionedCocktails = allCocktails.filter(cocktail => 
          input.message.toLowerCase().includes(cocktail.name.toLowerCase()) ||
          (cocktail.nameEnglish && input.message.toLowerCase().includes(cocktail.nameEnglish.toLowerCase()))
        );

        // Build context with cocktail information if mentioned
        let contextInfo = "";
        if (mentionedCocktails.length > 0) {
          contextInfo = "\n\nRelevant cocktail information:\n";
          for (const cocktail of mentionedCocktails) {
            const ingredients = await getCocktailIngredients(cocktail.id);
            const ingredientsList = ingredients
              .filter(i => i.withAlcohol)
              .map(i => `${i.amount} ${i.unit} ${i.ingredient}`)
              .join(", ");
            
            contextInfo += `\n**${cocktail.nameEnglish || cocktail.name}**\n`;
            contextInfo += `Description: ${cocktail.descriptionEnglish || 'N/A'}\n`;
            contextInfo += `Ingredients: ${ingredientsList}\n`;
            contextInfo += `Method: ${cocktail.method}\n`;
            if (cocktail.funFacts) {
              contextInfo += `Fun Facts: ${cocktail.funFacts}\n`;
            }
          }
        }

        // Generate AI response using LLM
        const systemPrompt = `You are a knowledgeable bar training assistant for Mtl Craft Cocktails. You help bartenders and staff with:
- Cocktail recipes and preparation methods
- Workshop packing checklists
- Bar service planning and calculations
- Ingredient information and substitutions

Be friendly, professional, and concise. Provide helpful guidance based on your knowledge of bartending and bar service.${contextInfo}`;

        const response = await invokeLLM({
          messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: input.message },
          ],
        });

        const messageContent = response.choices[0].message.content;
        const assistantMessage = typeof messageContent === 'string' 
          ? messageContent 
          : "I'm sorry, I couldn't generate a response.";

        // Store assistant message
        if (conversationId) {
          await addMessage({
            conversationId,
            role: "assistant",
            content: assistantMessage,
          });
        }

        // Return response with recipe data if cocktails were mentioned
        return {
          conversationId,
          message: assistantMessage,
          recipes: mentionedCocktails.length > 0 ? await Promise.all(
            mentionedCocktails.map(async (cocktail) => {
              const ingredients = await getCocktailIngredients(cocktail.id);
              return {
                id: cocktail.id,
                name: cocktail.nameEnglish || cocktail.name,
                description: cocktail.descriptionEnglish || '',
                method: cocktail.method,
                glassType: cocktail.glassType,
                funFacts: cocktail.funFacts,
                ingredients: ingredients
                  .filter(i => i.withAlcohol)
                  .map(i => ({
                    amount: i.amount,
                    unit: i.unit,
                    ingredient: i.ingredient,
                  })),
              };
            })
          ) : undefined,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
