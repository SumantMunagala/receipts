import type { BaseMessage } from "@langchain/core/messages";
import type { Runnable } from "@langchain/core/runnables";
import type { z } from "zod";

export type TokenUsage = { input_tokens?: number; output_tokens?: number; total_tokens?: number };

/** What both the live and mock structured runnables return (withStructuredOutput's includeRaw shape). */
export type StructuredOutput = { raw: { usage_metadata?: TokenUsage }; parsed: unknown };

export type StructuredRunnableFactory = (
  model: string,
  schema: { zod: z.ZodType; json: Record<string, unknown> },
) => Runnable<BaseMessage[], StructuredOutput>;
