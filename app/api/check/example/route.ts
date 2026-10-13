import { NextResponse, type NextRequest } from "next/server";
import { exampleTransaction, type ExampleKind } from "@/lib/solana/examples";
import { TxFetchError } from "@/lib/solana/rpc";
import type { ApiError } from "@/lib/tx/model";
import { demoTag } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/check/example?kind=swap|drainer → an unsigned example transaction (base64) to try checking. */
export async function GET(req: NextRequest) {
  const kind: ExampleKind = req.nextUrl.searchParams.get("kind") === "drainer" ? "drainer" : "swap";
  try {
    const transaction = await exampleTransaction(kind);
    // Tagged so checking a demo never uses a free check.
    return NextResponse.json({ transaction, demo: demoTag(transaction) });
  } catch (err) {
    const message = err instanceof TxFetchError ? err.message : "Couldn't build the example. Try again in a moment.";
    if (!(err instanceof TxFetchError)) console.error("[/api/check/example]", err);
    return NextResponse.json<ApiError>({ error: { code: "rpc_error", message } }, { status: 502 });
  }
}
