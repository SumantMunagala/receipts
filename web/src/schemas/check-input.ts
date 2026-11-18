import { z } from "zod";
import { tag } from "./common";

/** TikTok only: tiktok.com and its www/m/vm/vt subdomains (vm/vt are share short links). */
export const TikTokUrlSchema = z.url({
  protocol: /^https?$/,
  hostname: /^(?:(?:www|m|vm|vt)\.)?tiktok\.com$/,
});

// The viewer can type the TikTok Shop price when the screenshot doesn't show it.
const userTikTokPrice = z.number().positive().optional();

export const TikTokLinkInputSchema = z.object({
  kind: tag("tiktok_link"),
  url: TikTokUrlSchema,
  userTikTokPrice,
});

export const ScreenshotInputSchema = z.object({
  kind: tag("screenshot"),
  imageBase64: z.base64(),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  userTikTokPrice,
});

export const CheckInputSchema = z.discriminatedUnion("kind", [TikTokLinkInputSchema, ScreenshotInputSchema]);
export type CheckInput = z.infer<typeof CheckInputSchema>;
