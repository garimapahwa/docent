import { unstable_cache } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { TxFetchError, fetchParsedTransaction } from "@/lib/solana/rpc";
import { isValidSignature } from "@/lib/solana/signature";
import type { ApiError } from "@/lib/tx/model";
import { normalizeTransaction } from "@/lib/tx/normalize";
import { checkTrade, type TradeCheck } from "@/lib/tx/trade-check";

export const runtime = "nodejs";

/** Past prices never change, so each answer is computed once. Missing prices are retried next time. */
const cachedCheck = unstable_cache(
  async (sig: string) => {
    const result = await checkTrade(normalizeTransaction(sig, await fetchParsedTransaction(sig)));
    if (result.status === "unpriced") throw new Uncached(result);
    return result;
  },
  ["docent-trade-check-v1"],
  { revalidate: false },
);

class Uncached extends Error {
  constructor(public result: TradeCheck) {
    super("not cached");
  }
}

/** GET /api/trade-check?sig=... → how a swap's price compared with the market at that minute. */
export async function GET(req: NextRequest) {
  const sig = req.nextUrl.searchParams.get("sig")?.trim() ?? "";
  if (!isValidSignature(sig)) {
    return NextResponse.json<ApiError>(
      { error: { code: "invalid_signature", message: "That doesn't look like a transaction signature." } },
      { status: 400 },
    );
  }
  try {
    return NextResponse.json<TradeCheck>(await cachedCheck(sig));
  } catch (err) {
    if (err instanceof Uncached) return NextResponse.json<TradeCheck>(err.result);
    if (err instanceof TxFetchError) {
      return NextResponse.json<ApiError>({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    console.error("[/api/trade-check]", err);
    return NextResponse.json<TradeCheck>({ status: "unpriced", reason: "Couldn't check prices right now." });
  }
}
