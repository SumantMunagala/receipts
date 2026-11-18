import { z } from "zod";
import { NonEmptySchema, UnavailableSchema, tag } from "./common";

export const DisclosureSignalSchema = z.object({
  type: z.enum(["commission_label", "ad_tag", "affiliate_link", "paid_partnership_label", "other"]),
  evidence: NonEmptySchema.describe("The exact text or label seen, quoted"),
});
export type DisclosureSignal = z.infer<typeof DisclosureSignalSchema>;

/** A paid signal is only ever claimed with at least one piece of evidence. */
export const DisclosurePaidSchema = z.object({
  status: tag("paid_signal_detected"),
  signals: z.array(DisclosureSignalSchema).min(1),
  reason: z.string().optional(),
});

export const DisclosureNoneFoundSchema = z.object({
  status: tag("no_disclosure_found"),
  signals: z.array(DisclosureSignalSchema).max(0),
  reason: z.string().optional(),
});

/** Shop listings have no creator, so there is nothing to disclose. */
export const DisclosureNotApplicableSchema = z.object({
  status: tag("not_applicable"),
  reason: NonEmptySchema,
});

export const DisclosureResultSchema = z.discriminatedUnion("status", [
  DisclosurePaidSchema,
  DisclosureNoneFoundSchema,
  DisclosureNotApplicableSchema,
  UnavailableSchema,
]);
export type DisclosureResult = z.infer<typeof DisclosureResultSchema>;
