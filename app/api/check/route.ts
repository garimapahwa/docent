import { NextResponse, type NextRequest } from "next/server";
import type { CheckResponse } from "@/lib/api";
import { TxFetchError } from "@/lib/solana/rpc";
import { simulateTransaction } from "@/lib/solana/simulate";
import { TxModelSchema, type ApiError } from "@/lib/tx/model";
import { riskWarnings } from "@/lib/tx/risk";
import { blocked, checkKey, decide, readAccess, recordUse, validDemoTag } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/check { transaction } → what an unsigned transaction would do if signed now,
 * plus safety warnings. It's only simulated: nothing is signed or sent.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { transaction?: unknown; demo?: unknown } | null;
  const input = typeof body?.transaction === "string" ? body.transaction.trim() : "";
  if (!input) {
    return NextResponse.json<ApiError>(
      { error: { code: "invalid_transaction", message: "Paste a transaction to check." } },
      { status: 400 },
    );
  }
  // Free checks: Docent's own demo transactions carry a tag and never count.
  const access = await readAccess();
  const decision = decide(access, checkKey(input), validDemoTag(input, typeof body?.demo === "string" ? body.demo : null));
  if (!decision.allowed) return blocked(decision.reason);

  try {
    const { tx, slot } = await simulateTransaction(input);
    const model = TxModelSchema.parse(tx);
    const res = NextResponse.json<CheckResponse>({ tx: model, slot, warnings: riskWarnings(model, { preview: true }) });
    if (decision.record) await recordUse(access, decision.record);
    return res;
  } catch (err) {
    if (err instanceof TxFetchError) {
      return NextResponse.json<ApiError>({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    console.error("[/api/check]", err);
    return NextResponse.json<ApiError>(
      { error: { code: "internal_error", message: "Something went wrong while checking this transaction." } },
      { status: 500 },
    );
  }
}
