import { z } from "zod";

export const SCENE_TYPES = ["title", "programs", "tokenFlow", "balances", "failure", "outro"] as const;

export const MAX_CAPTION_WORDS = 18;

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * A scene only says WHICH view to show and the caption under it. Every fact the scene
 * displays is read from the TxModel by the scene itself, so a storyboard can't invent data.
 */
export const SceneSchema = z.object({
  type: z.enum(SCENE_TYPES),
  caption: z
    .string()
    .min(1)
    .refine((c) => wordCount(c) <= MAX_CAPTION_WORDS, `Captions must be ${MAX_CAPTION_WORDS} words or fewer`),
});

export const StoryboardSchema = z.object({
  scenes: z.array(SceneSchema).min(2).max(8),
});

export type SceneType = (typeof SCENE_TYPES)[number];
export type Scene = z.infer<typeof SceneSchema>;
export type Storyboard = z.infer<typeof StoryboardSchema>;
