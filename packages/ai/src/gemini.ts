import { GoogleGenAI } from "@google/genai";
import { env } from "@core/shared";
import { normalizeL2 } from "./normalize.js";
import type { AIProvider } from "./types.js";

const MODEL_NAME = "gemini-embedding-001";
const TARGET_DIMENSION = 768;

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;

  constructor(client?: GoogleGenAI) {
    if (client) {
      this.ai = client;
    } else {
      if (!env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is not configured.");
      }
      this.ai = new GoogleGenAI({
        apiKey: env.GEMINI_API_KEY,
      });
    }
  }

  async embed(text: string): Promise<number[]> {
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("Cannot embed an empty or whitespace-only string.");
    }

    try {
      const response = await this.ai.models.embedContent({
        model: MODEL_NAME,
        contents: trimmed,
        config: {
          outputDimensionality: TARGET_DIMENSION,
        },
      });

      if (!response.embeddings || response.embeddings.length === 0) {
        throw new Error("Invalid response from Gemini API: Missing embeddings.");
      }

      const values = response.embeddings[0].values;
      
      if (!values || !Array.isArray(values)) {
         throw new Error("Invalid response from Gemini API: Embedding values missing or not an array.");
      }

      if (values.length !== TARGET_DIMENSION) {
        throw new Error(`Invalid dimensionality: expected ${TARGET_DIMENSION}, got ${values.length}`);
      }

      return normalizeL2(values);
    } catch (error) {
      // Re-throw known validation errors
      if (error instanceof Error && error.message.includes("Invalid")) {
         throw error;
      }
      if (error instanceof Error && error.message.includes("Vector contains")) {
         throw error;
      }
      
      // Wrap unexpected / network / Google API errors
      throw new Error(`Gemini API failure: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async chat(input: import("./types.js").ChatInput): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
        model: env.GEMINI_CHAT_MODEL,
        contents: input.userPrompt,
        config: {
          systemInstruction: input.systemPrompt,
        },
      });

      const text = response.text;
      if (!text || text.trim() === "") {
        throw new Error("Invalid response from Gemini API: Missing text.");
      }

      return text;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid")) {
        throw error;
      }
      throw new Error(`Gemini API chat failure: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async *chatStream(input: import("./types.js").ChatInput): AsyncIterable<string> {
    try {
      const responseStream = await this.ai.models.generateContentStream({
        model: env.GEMINI_CHAT_MODEL,
        contents: input.userPrompt,
        config: {
          systemInstruction: input.systemPrompt,
        },
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("Invalid")) {
        throw error;
      }
      throw new Error(`Gemini API chat failure: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
