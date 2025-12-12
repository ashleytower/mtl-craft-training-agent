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
} from "./db";
import { 
  getCocktails,
  getIngredients,
  getPreparationSteps,
  searchCocktailsByName
} from "./googleSheets";
import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import { storagePut } from "./storage";
import { textToSpeech } from "./elevenLabs";
import fs from "fs/promises";
import path from "path";

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
  }),  // Voice transcription and TTS
  voice: router({
    transcribe: publicProcedure
      .input(z.object({
        audioUrl: z.string(),
        language: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          console.log('[Transcription] Starting transcription for:', input.audioUrl);
          
          const result = await transcribeAudio({
            audioUrl: input.audioUrl,
            language: input.language,
          });
          
          console.log('[Transcription] Result:', JSON.stringify(result).substring(0, 200));
          
          // Check if result has error
          if (!result || typeof result !== 'object') {
            console.error('[Transcription] Invalid result type:', typeof result);
            throw new Error('Invalid transcription response');
          }
          
          if ('error' in result) {
            console.error('[Transcription] Error in result:', result.error, result.code, result.details);
            throw new Error(`${result.error}${result.details ? ': ' + result.details : ''}`);
          }
          
          // Check if result has text property
          if (!('text' in result) || typeof result.text !== 'string') {
            console.error('[Transcription] Missing or invalid text property');
            throw new Error('Invalid transcription response: missing text');
          }
          
          console.log('[Transcription] Success! Text length:', result.text.length);
          return { text: result.text };
        } catch (error) {
          console.error('[Transcription Error]', error);
          throw new Error(`Transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }),
    
    // Generate speech from text using ElevenLabs
    generateSpeech: publicProcedure
      .input(z.object({
        text: z.string(),
        language: z.enum(['en', 'fr']).optional(),
      }))
      .mutation(async ({ input }) => {
        const audioBuffer = await textToSpeech({
          text: input.text,
          language: input.language || 'en',
        });
        
        // Upload to storage and return URL
        const timestamp = Date.now();
        const audioKey = `tts-audio/speech-${timestamp}.mp3`;
        
        const { url } = await storagePut(
          audioKey,
          audioBuffer,
          'audio/mpeg'
        );
        
        return { audioUrl: url };
      }),
  }),

  // Cocktail knowledge base (Google Sheets)
  cocktails: router({
    search: publicProcedure
      .input(z.object({ query: z.string() }))
      .query(async ({ input }) => {
        return searchCocktailsByName(input.query);
      }),
    
    getById: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const allCocktails = await getCocktails();
        const cocktail = allCocktails.find(c => c.id === input.id);
        if (!cocktail) return null;
        
        const ingredientsList = await getIngredients(cocktail.name);
        const preparationSteps = await getPreparationSteps(cocktail.name, 'en');
        return { ...cocktail, ingredients: ingredientsList, preparation: preparationSteps };
      }),
    
    getAll: publicProcedure.query(async () => {
      return getCocktails();
    }),
  }),

  // SOPs
  sops: router({
    get: publicProcedure.query(async () => {
      try {
        const sopPath = path.join(process.cwd(), "knowledge-base-sop.md");
        const content = await fs.readFile(sopPath, "utf-8");
        return { content };
      } catch (error) {
        console.error("Error reading SOP file:", error);
        throw new Error("Failed to load SOPs");
      }
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
        language: z.enum(['en', 'fr']).optional(),
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

        // Check if user is asking about specific cocktails from Google Sheets
        const allCocktails = await getCocktails();
        const mentionedCocktails = allCocktails.filter(cocktail => 
          input.message.toLowerCase().includes(cocktail.name.toLowerCase()) ||
          input.message.toLowerCase().includes(cocktail.nom.toLowerCase())
        );

        // Build context with cocktail information if mentioned
        let contextInfo = "";
        if (mentionedCocktails.length > 0) {
          contextInfo = "\n\nRelevant cocktail information:\n";
          for (const cocktail of mentionedCocktails) {
            const ingredients = await getIngredients(cocktail.name);
            const useLanguage = input.language || 'en';
            const preparationText = await getPreparationSteps(cocktail.name, useLanguage);
            
            const ingredientsList = ingredients
              .map(i => `${i.amount || ''} ${i.unit || ''} ${i.ingredient}`.trim())
              .join(", ");
            
            const displayName = useLanguage === 'fr' ? cocktail.nom : cocktail.name;
            const displayDescription = useLanguage === 'fr' ? cocktail.descriptionFR : cocktail.descriptionEN;
            
            contextInfo += `\n**${displayName}**\n`;
            contextInfo += `Description: ${displayDescription || 'N/A'}\n`;
            contextInfo += `Ingredients: ${ingredientsList}\n`;
            contextInfo += `Preparation: ${preparationText}\n`;
            if (cocktail.funFacts) {
              contextInfo += `Fun Facts: ${cocktail.funFacts}\n`;
            }
          }
        }

        // Determine response language
        const userLanguage = input.language || 'en';
        const languageInstruction = userLanguage === 'fr' 
          ? 'IMPORTANT: Respond in French (français). Use French terminology and expressions.'
          : 'IMPORTANT: Respond in English.';

        // Generate AI response using LLM
        const systemPrompt = `<role>
You are a knowledgeable cocktail training assistant for Le Fou Fou by Mtl Craft Cocktails. 
You help bartenders and staff master mixology through clear, friendly guidance.
</role>

<training_philosophy>
KEY TRAINING PRINCIPLES:
- Always start with least expensive ingredients first, add alcohol last
- Use fresh citrus juice and house-made syrups
- Shake cocktails like a drum solo (not a lullaby) - ice should slam top and bottom
- Every cocktail needs at least 1 oz of water from dilution
- For egg whites: always dry shake first (hold tight, no ice)
- Muddle mint gently - bruised mint tastes like rusty spoon
- Boston shaker is preferred (two pieces, no leaks)
- Use jigger for measurements: 2oz/1oz with 0.5oz, 0.75oz, 1.5oz markings
</training_philosophy>

<expertise_areas>
- Cocktail recipes and preparation methods
- Pro tips and techniques
- House-made syrups and ingredients
- Bar tools and equipment guidance
</expertise_areas>

<house_syrups_reference>
Cold process (to preserve brightness):
Espresso, Grapefruit Cordial, Toasted Almond Orgeat, Butterfly Pea, Ginger, Hibiscus, 
Passion Fruit, Grilled Pineapple, Spiced Cranberry, Strawberry/Raspberry, Mango, Spiced Pear, 
Jalapeño (simmered, blended, strained through cheesecloth)
</house_syrups_reference>

<tone>
- Friendly and approachable
- Professional and knowledgeable
- Enthusiastic about bartending
- Concise (no unnecessary elaboration)
- Include personality—use metaphors and relatable explanations
</tone>

<language>
${languageInstruction}
Maintain the same expertise and tone regardless of language.
</language>

<response_guidelines>
When answering questions:
1. Think step by step through the bartending technique or recipe
2. Reference house recipes/syrups when relevant
3. Tie back to KEY TRAINING PRINCIPLES when applicable
4. Provide actionable next steps or pro tips
5. Keep responses concise but complete
</response_guidelines>${contextInfo}`;

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
        const useLanguage = input.language || 'en';
        return {
          conversationId,
          message: assistantMessage,
          recipes: mentionedCocktails.length > 0 ? await Promise.all(
            mentionedCocktails.map(async (cocktail) => {
              const ingredients = await getIngredients(cocktail.id);
              const preparationText = await getPreparationSteps(cocktail.name, useLanguage);
              
              const displayName = useLanguage === 'fr' ? cocktail.nom : cocktail.name;
              const displayDescription = useLanguage === 'fr' ? cocktail.descriptionFR : cocktail.descriptionEN;
              
              return {
                id: cocktail.id,
                name: displayName,
                description: displayDescription,
                method: preparationText,
                glassType: cocktail.glassware,
                funFacts: cocktail.funFacts,
                ingredients: ingredients
                  .filter((i: any) => i.type === 'Alcohol')
                  .map((i: any) => ({
                    amount: i.quantity,
                    unit: i.unit,
                    ingredient: i.ingredientName,
                  })),
              };
            })
          ) : undefined,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
