import type { BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { env } from "../env";
import type { StructuredOutput, StructuredRunnableFactory } from "./gemini.types";

// Live Gemini through LangChain. The only module that imports the SDK; llm.ts
// loads it lazily, so mock mode never does.

export const TEMPERATURE = 0.2;

export const structuredRunnable: StructuredRunnableFactory = (model, { json }) => {
  const { GOOGLE_API_KEY } = env.llm();
  const chat = new ChatGoogleGenerativeAI({
    model,
    apiKey: GOOGLE_API_KEY,
    temperature: TEMPERATURE,
    // llm.ts owns retries (one 429 retry, then fallback); LangChain's default
    // of 6 exponential-backoff retries would hide that policy.
    maxRetries: 0,
  });
  // A JSON Schema (not the Zod schema) so llm.ts controls the conversion; see
  // toGeminiSchema(). LangChain doesn't validate JSON Schema output, llm.ts does.
  return chat.withStructuredOutput(json, { method: "jsonSchema", includeRaw: true }) as unknown as Runnable<
    BaseMessage[],
    StructuredOutput
  >;
};
