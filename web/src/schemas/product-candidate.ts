import { z } from "zod";
import { NonEmptySchema } from "./common";

/** The product the viewer confirms (or corrects) before any check runs. */
export const ProductCandidateSchema = z.object({
  brand: NonEmptySchema,
  productName: NonEmptySchema,
  category: NonEmptySchema,
  confidence: z.number().min(0).max(1),
  evidence: NonEmptySchema.describe("What in the source identified the product"),
  productKey: NonEmptySchema.describe("Normalized cache key for this product"),
});
export type ProductCandidate = z.infer<typeof ProductCandidateSchema>;
