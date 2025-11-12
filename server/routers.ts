import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { 
  createConversation,
  getUserConversations,
  getConversationMessages,
  addMessage
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

    // Send a message and get AI response
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

        // Generate AI response using LLM
        const systemPrompt = `You are a knowledgeable bar training assistant for Mtl Craft Cocktails. You help bartenders and staff with:
- Cocktail recipes and preparation methods
- Workshop packing checklists
- Bar service planning and calculations
- Ingredient information and substitutions

Be friendly, professional, and concise. Provide helpful guidance based on your knowledge of bartending and bar service.`;

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

        return {
          conversationId,
          message: assistantMessage,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;
