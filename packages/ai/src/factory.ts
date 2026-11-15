import { env } from "@core/shared";
import { GeminiProvider } from "./gemini.js";
import { MistralProvider, type MistralProviderConfig } from "./mistral.js";
import { FallbackAIProvider } from "./fallback.js";
import type { AIProvider } from "./types.js";

export interface DefaultAIProviderOptions {
  geminiClient?: any;
  mistralConfig?: MistralProviderConfig;
}

/**
 * Creates the default AI provider for the application.
 *
 * If both GEMINI_API_KEY and MISTRAL_API_KEY are configured, returns a FallbackAIProvider
 * where Gemini serves as the primary model and Mistral serves as the automatic fallback
 * whenever Gemini encounters rate limits (429), server errors (503/heavy traffic), or failures.
 *
 * If only one provider is configured, returns that provider directly.
 */
export function createDefaultAIProvider(options?: DefaultAIProviderOptions): AIProvider {
  const hasGeminiKey = !!(env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || options?.geminiClient);
  const hasMistralKey = !!(env.MISTRAL_API_KEY || process.env.MISTRAL_API_KEY || options?.mistralConfig?.apiKey);

  let gemini: GeminiProvider | undefined;
  if (hasGeminiKey) {
    try {
      gemini = new GeminiProvider(options?.geminiClient);
    } catch (err) {
      console.warn("[createDefaultAIProvider] Failed to initialize GeminiProvider:", err);
    }
  }

  let mistral: MistralProvider | undefined;
  if (hasMistralKey) {
    try {
      mistral = new MistralProvider(options?.mistralConfig);
    } catch (err) {
      console.warn("[createDefaultAIProvider] Failed to initialize MistralProvider:", err);
    }
  }

  if (gemini && mistral) {
    return new FallbackAIProvider(gemini, mistral);
  }

  if (gemini) {
    return gemini;
  }

  if (mistral) {
    return mistral;
  }

  throw new Error(
    "No AI provider configured. Please provide GEMINI_API_KEY or MISTRAL_API_KEY in your environment (.env)."
  );
}
