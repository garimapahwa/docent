import { NextResponse, type NextRequest } from "next/server";
import { TxFetchError, fetchParsedTransactions, fetchRecentSignatures } from "@/lib/solana/rpc";
import { isValidAddress } from "@/lib/solana/signature";
import { headline } from "@/lib/tx/explain";
import type { RecentResponse, WalletTx } from "@/lib/api";
import type { ApiError } from "@/lib/tx/model";
import { normalizeTransaction } from "@/lib/tx/normalize";
import { spamReason } from "@/lib/tx/spam";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many recent transactions to look at. Spam is filtered out of these. */
const LOOKBACK = 20;


/** GET /api/recent?address=... → the address's latest transactions with summaries, newest first. */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim() ?? "";
  if (!isValidAddress(address)) {
    return NextResponse.json<ApiError>(
      { error: { code: "invalid_signature", message: "That isn't a valid Solana address." } },
      { status: 400 },
    );
  }
  try {
    const recent = await fetchRecentSignatures(address, LOOKBACK);
    // Summaries are a bonus: if the batch fetch fails, still return the plain list.
    const parsed = await fetchParsedTransactions(recent.map((r) => r.signature)).catch(() => recent.map(() => null));

    const transactions: WalletTx[] = recent.map((r, i) => {
      const raw = parsed[i];
      if (!raw) return { ...r, summary: null, spam: null };
      try {
        const tx = normalizeTransaction(r.signature, raw);
        return { ...r, summary: headline(tx, address), spam: spamReason(tx, address) };
      } catch {
        return { ...r, summary: null, spam: null };
      }
    });
    return NextResponse.json<RecentResponse>({ address, transactions });
  } catch (err) {
    if (err instanceof TxFetchError) {
      return NextResponse.json<ApiError>({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    console.error("[/api/recent]", err);
    return NextResponse.json<ApiError>(
      { error: { code: "internal_error", message: "Something went wrong while loading this wallet." } },
      { status: 500 },
    );
  }
}
