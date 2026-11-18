import { z } from "zod";
import { NonEmptySchema, UnavailableSchema, UrlSchema, tag } from "./common";

export const HypeExampleSchema = z.object({
  url: UrlSchema,
  platform: z.enum(["tiktok", "youtube"]),
  classification: z.enum(["paid", "organic", "unclear"]),
  signal: NonEmptySchema.optional().describe("The paid signal found, e.g. #ad or an affiliate link"),
});
export type HypeExample = z.infer<typeof HypeExampleSchema>;

// Counts describe a sample ("of N public posts we found"), never all of TikTok.
const sample = {
  sampleSize: z.int().nonnegative(),
  paidCount: z.int().nonnegative(),
  organicDiscussionCount: z.int().nonnegative(),
  examples: z.array(HypeExampleSchema),
};

const countsFitSample = (h: { sampleSize: number; paidCount: number; organicDiscussionCount: number }) =>
  h.paidCount <= h.sampleSize && h.organicDiscussionCount <= h.sampleSize;
const countsMessage = { message: "paidCount and organicDiscussionCount cannot exceed sampleSize" };

export const HypeOkSchema = z
  .object({
    status: tag("ok"),
    level: z.enum(["mostly_paid", "mixed", "mostly_organic"]),
    ...sample,
  })
  .refine(countsFitSample, countsMessage);

/** Too few posts to call it, but the counts still show what was found. */
export const HypeNotEnoughDataSchema = z
  .object({
    status: tag("not_enough_data"),
    level: tag("not_enough_data"),
    ...sample,
  })
  .refine(countsFitSample, countsMessage);

export const HypeMeterSchema = z.discriminatedUnion("status", [
  HypeOkSchema,
  HypeNotEnoughDataSchema,
  UnavailableSchema,
]);
export type HypeMeter = z.infer<typeof HypeMeterSchema>;
export type HypeLevel = z.infer<typeof HypeOkSchema>["level"] | "not_enough_data";
