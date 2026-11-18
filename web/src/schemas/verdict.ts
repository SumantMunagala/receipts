import { z } from "zod";
import { NonEmptySchema } from "./common";
import { DealComparisonSchema } from "./deal";
import { DisclosureResultSchema } from "./disclosure";
import { HypeMeterSchema } from "./hype";
import { ReviewSentimentSchema, ReviewSummarySchema } from "./reviews";
import { RiskResultSchema } from "./risk";

/** Hype x quality quadrant. Computed in code from the table in CLAUDE.md, never by the LLM. */
export const QuadrantSchema = z.enum([
  "genuinely_loved",
  "paid_but_good",
  "hyped_but_disappointing",
  "overhyped_likely_slop",
  "mixed_signals",
  "not_enough_evidence",
]);
export type Quadrant = z.infer<typeof QuadrantSchema>;

/** e.g. 4.8 stars on TikTok Shop while outside reviews are negative. */
export const RatingsGapSchema = z.object({
  tiktokRating: z.number().min(0).max(5),
  outsideSentiment: ReviewSentimentSchema,
  note: NonEmptySchema,
});

export const VerdictSchema = z.object({
  quadrant: QuadrantSchema,
  bottomLine: z.string().min(1).max(200),
  disclosure: DisclosureResultSchema,
  hype: HypeMeterSchema,
  reviews: ReviewSummarySchema,
  risk: RiskResultSchema,
  deal: DealComparisonSchema,
  ratingsGap: RatingsGapSchema.optional(),
  caveats: z.array(NonEmptySchema),
});
export type Verdict = z.infer<typeof VerdictSchema>;
