import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import type { StoryboardResponse } from "@/lib/api";
import { aiStoryboard, type StoryboardResult } from "@/lib/storyboard/ai";
import { TxFetchError, fetchParsedTransaction } from "@/lib/solana/rpc";
import { isValidSignature } from "@/lib/solana/signature";
import type { ApiError } from "@/lib/tx/model";
import { normalizeTransaction } from "@/lib/tx/normalize";
import { voiceUrl } from "@/lib/voice/sign";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Transactions never change once confirmed, so each one's storyboard is written once and cached.
 * That keeps share links, captions and narration consistent, and spends Claude and voice credits once.
 */
const cachedStoryboard = unstable_cache(
  async (sig: string) => {
    const result = await aiStoryboard(normalizeTransaction(sig, await fetchParsedTransaction(sig)));
    // Throwing skips the cache, so a fallback (no key yet, Claude briefly down) is retried next time.
    if (result.source === "fallback") throw new UncachedResult(result);
    return result;
  },
  ["docent-storyboard-v1"],
  { revalidate: false },
);

class UncachedResult extends Error {
  constructor(public result: StoryboardResult) {
    super("storyboard fell back; not cached");
  }
}

async function storyboardFor(sig: string): Promise<StoryboardResult> {
  try {
    return await cachedStoryboard(sig);
  } catch (err) {
    if (err instanceof UncachedResult) return err.result;
    throw err;
  }
}

/**
 * GET /api/storyboard?sig=... → Claude's storyboard (checked against the transaction's facts,
 * falling back to the deterministic one), plus signed narration URLs for its captions.
 * The transaction is re-read on the server, so a client can't make Docent narrate made-up text.
 */
export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get("sig")?.trim() ?? "";
  if (!isValidSignature(sig)) {
    return NextResponse.json<ApiError>(
      { error: { code: "invalid_signature", message: "That doesn't look like a transaction signature." } },
      { status: 400 },
    );
  }
  try {
    const result = await storyboardFor(sig);
    const urls = result.storyboard.scenes.map((s) => voiceUrl(s.caption));
    const voice = urls.every((u): u is string => u !== null) ? urls : null;
    return NextResponse.json<StoryboardResponse>({ ...result, voice });
  } catch (err) {
    if (err instanceof TxFetchError) {
      return NextResponse.json<ApiError>({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    console.error("[/api/storyboard]", err);
    return NextResponse.json<ApiError>(
      { error: { code: "internal_error", message: "Couldn't write the storyboard." } },
      { status: 500 },
    );
  }
}
