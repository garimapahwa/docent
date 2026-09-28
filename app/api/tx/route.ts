import { NextResponse, type NextRequest } from "next/server";
import { TxFetchError, fetchParsedTransaction } from "@/lib/solana/rpc";
import { isValidSignature } from "@/lib/solana/signature";
import { normalizeTransaction } from "@/lib/tx/normalize";
import { TxModelSchema, type ApiError, type ApiErrorCode } from "@/lib/tx/model";
import type { TxResponse } from "@/lib/api";
import { deterministicStoryboard } from "@/lib/storyboard/deterministic";
import { voiceUrl } from "@/lib/voice/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(code: ApiErrorCode, message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get("sig")?.trim() ?? "";
  if (!isValidSignature(sig)) {
    return errorResponse(
      "invalid_signature",
      "That doesn't look like a Solana transaction signature or wallet address. Check that you copied the whole thing.",
      400,
    );
  }

  try {
    const tx = await fetchParsedTransaction(sig);
    const model = TxModelSchema.parse(normalizeTransaction(sig, tx));
    const storyboard = deterministicStoryboard(model);
    const urls = storyboard.scenes.map((s) => voiceUrl(s.caption));
    const voice = urls.every((u): u is string => u !== null) ? urls : null;
    return NextResponse.json<TxResponse>({ tx: model, storyboard, voice });
  } catch (err) {
    if (err instanceof TxFetchError) return errorResponse(err.code, err.message, err.status);
    console.error("[/api/tx]", err);
    return errorResponse("internal_error", "Something went wrong while reading this transaction.", 500);
  }
}
