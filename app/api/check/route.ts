import { NextResponse, type NextRequest } from "next/server";
import type { CheckResponse } from "@/lib/api";
import { TxFetchError } from "@/lib/solana/rpc";
import { simulateTransaction } from "@/lib/solana/simulate";
import { TxModelSchema, type ApiError } from "@/lib/tx/model";
import { riskWarnings } from "@/lib/tx/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/check { transaction } → what an unsigned transaction would do if signed now,
 * plus safety warnings. It's only simulated: nothing is signed or sent.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { transaction?: unknown } | null;
  const input = typeof body?.transaction === "string" ? body.transaction : "";
  if (!input.trim()) {
    return NextResponse.json<ApiError>(
      { error: { code: "invalid_transaction", message: "Paste a transaction to check." } },
      { status: 400 },
    );
  }
  try {
    const { tx, slot } = await simulateTransaction(input);
    const model = TxModelSchema.parse(tx);
    return NextResponse.json<CheckResponse>({ tx: model, slot, warnings: riskWarnings(model, { preview: true }) });
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
