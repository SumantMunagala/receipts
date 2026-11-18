import { z } from "zod";
import { NonEmptySchema, UnavailableSchema, UrlSchema, tag } from "./common";

export const ReviewSentimentSchema = z.enum(["positive", "mixed", "negative", "insufficient"]);
export type ReviewSentiment = z.infer<typeof ReviewSentimentSchema>;

export const ReviewSourceSchema = z.object({
  url: UrlSchema,
  title: NonEmptySchema,
});

/** Any sentiment other than "insufficient" must cite at least one source. */
export const ReviewSummaryOkSchema = z
  .object({
    status: tag("ok"),
    pros: z.array(NonEmptySchema),
    cons: z.array(NonEmptySchema),
    sentiment: ReviewSentimentSchema,
    sources: z.array(ReviewSourceSchema),
  })
  .refine((r) => r.sentiment === "insufficient" || r.sources.length > 0, {
    message: "a sentiment verdict needs at least one source",
    path: ["sources"],
  });

export const ReviewSummarySchema = z.discriminatedUnion("status", [ReviewSummaryOkSchema, UnavailableSchema]);
export type ReviewSummary = z.infer<typeof ReviewSummarySchema>;
