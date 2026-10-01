import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { explainTransaction } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";
import { deterministicStoryboard } from "./deterministic";
import { MAX_CAPTION_WORDS, SCENE_TYPES, StoryboardSchema, wordCount, type SceneType, type Storyboard } from "./schema";

const MODEL = "claude-opus-5";

/** What Claude may return: scene types from the fixed list, and a caption per scene. */
const AiOutputSchema = z.object({
  scenes: z.array(z.object({ type: z.enum(SCENE_TYPES), caption: z.string() })),
});

export type StoryboardResult = {
  storyboard: Storyboard;
  /** "ai": Claude's storyboard; "mixed": some captions replaced by the safe version; "fallback": deterministic. */
  source: "ai" | "mixed" | "fallback";
  /** Why anything fell back, for logs and the raw-data panel. */
  notes: string[];
};

const SYSTEM = `You write the captions for a short narrated video that explains one Solana transaction to complete beginners.

You receive verified facts about the transaction. Write the storyboard: an ordered list of scenes, each with one caption that is read aloud.

Rules:
- Use only the scene types listed in allowed_scenes, in a sensible order: start with "title", end with "outro". Include "failure" only if the transaction failed.
- Every caption is one or two short sentences, at most ${MAX_CAPTION_WORDS} words, in plain, friendly English. If you use a technical word (like slippage or wrapped SOL), explain it in the same caption.
- Use only facts given to you. Never invent or change amounts, token names, program names, counts or outcomes. Copy numbers exactly as written in the facts; you may leave numbers out, but never round or alter them.
- Each caption should describe what that scene shows: title = what happened overall; programs = the steps and apps involved; tokenFlow = where the tokens went; balances = how the wallet's balances changed; failure = what went wrong and why; outro = a short closing line with the network fee.`;

/** Facts Claude may use: the deterministic explanation plus the scene list. */
function facts(tx: TxModel, fallback: Storyboard) {
  const story = explainTransaction(tx);
  return {
    succeeded: tx.success,
    headline: story.headline,
    steps: story.steps.map((s) => ({ text: s.text, details: s.details, failed: s.failed })),
    outcome: story.outcome,
    network_fee_sol: tx.feeSol,
    number_of_steps: tx.instructions.length,
    number_of_token_movements: tx.transfers.length,
    allowed_scenes: fallback.scenes.map((s) => s.type),
    example_captions: fallback.scenes,
  };
}

/**
 * Words a caption must not invent: numbers, and ticker-like capitalised words (USDC, SOL).
 * Each must appear somewhere in the facts Claude was given.
 */
function unsupportedFacts(caption: string, allowed: string): string[] {
  const haystack = allowed.replace(/,/g, "");
  const numbers = (caption.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
  const tickers = caption.match(/\b[A-Z][A-Z0-9]{1,9}\b/g) ?? [];
  return [...numbers, ...tickers].filter((token) => !haystack.includes(token));
}

/**
 * Asks Claude for a friendlier storyboard, then checks it. The scene list must match the
 * deterministic one (same scenes, same order), captions must fit the length limit, and every
 * number or token symbol must come from the facts. A caption that fails is replaced by the
 * deterministic caption for that scene; anything structurally wrong falls back entirely.
 */
export async function aiStoryboard(tx: TxModel): Promise<StoryboardResult> {
  const fallback = deterministicStoryboard(tx);
  if (!process.env.ANTHROPIC_API_KEY) {
    return { storyboard: fallback, source: "fallback", notes: ["ANTHROPIC_API_KEY is not set"] };
  }

  const input = facts(tx, fallback);
  const allowedText = JSON.stringify(input);

  let output: z.infer<typeof AiOutputSchema> | null;
  try {
    const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
    // Server-side fallbacks: if the model declines, the API reruns the request on a fallback
    // model chosen by Anthropic; if everything declines we use the deterministic storyboard.
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(AiOutputSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Facts:\n${JSON.stringify(input, null, 2)}` }],
    });
    if (response.stop_reason === "refusal") {
      return { storyboard: fallback, source: "fallback", notes: ["Claude declined the request"] };
    }
    output = response.parsed_output;
  } catch (err) {
    const reason =
      err instanceof Anthropic.RateLimitError
        ? "Claude rate limit"
        : err instanceof Anthropic.AuthenticationError
          ? "invalid ANTHROPIC_API_KEY"
          : err instanceof Anthropic.APIError
            ? `Claude API error ${err.status}`
            : "could not reach Claude";
    console.error("[storyboard] falling back:", reason, err);
    return { storyboard: fallback, source: "fallback", notes: [reason] };
  }

  if (!output) return { storyboard: fallback, source: "fallback", notes: ["Claude's reply didn't match the schema"] };

  // Same scenes, same order: the scene list is decided by the facts, not by the model.
  const expected: SceneType[] = fallback.scenes.map((s) => s.type);
  const got = output.scenes.map((s) => s.type);
  if (got.length !== expected.length || got.some((t, i) => t !== expected[i])) {
    return {
      storyboard: fallback,
      source: "fallback",
      notes: [`scene list ${got.join(",")} differs from ${expected.join(",")}`],
    };
  }

  const notes: string[] = [];
  const scenes = output.scenes.map((scene, i) => {
    const caption = scene.caption.trim();
    const invented = unsupportedFacts(caption, allowedText);
    if (!caption || wordCount(caption) > MAX_CAPTION_WORDS || invented.length > 0) {
      notes.push(
        invented.length
          ? `${scene.type}: used ${invented.join(", ")}, which isn't in the facts`
          : `${scene.type}: caption empty or too long`,
      );
      return fallback.scenes[i];
    }
    return { type: scene.type, caption };
  });

  const checked = StoryboardSchema.safeParse({ scenes });
  if (!checked.success) return { storyboard: fallback, source: "fallback", notes: ["storyboard failed validation"] };
  return { storyboard: checked.data, source: notes.length ? "mixed" : "ai", notes };
}
