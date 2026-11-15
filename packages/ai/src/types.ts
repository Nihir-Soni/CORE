export type ChatInput = {
  systemPrompt: string;
  userPrompt: string;
};

/**
 * Provider-agnostic AI embedding and chat interface.
 */
export interface AIProvider {
  /**
   * Generates a single embedding vector from the provided text.
   * 
   * @param text The string to embed. Must not be empty or whitespace-only.
   * @returns A promise that resolves to a normalized array of exactly 768 numbers.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Generates a chat response using the configured model.
   * 
   * @param input The system and user prompts to send.
   * @returns A promise resolving to the model's text response.
   */
  chat(input: ChatInput): Promise<string>;

  /**
   * Generates a streaming chat response yielding incremental text chunks.
   * 
   * @param input The system and user prompts to send.
   * @returns An AsyncIterable yielding text chunks as string.
   */
  chatStream?(input: ChatInput): AsyncIterable<string>;
}
