import { Connection, PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import type { ApiErrorCode } from "@/lib/tx/model";

const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
/** Highest transaction format to accept. Asking for only version 0 makes the RPC reject version-1 transactions. */
const MAX_TX_VERSION = 1;

export class TxFetchError extends Error {
  constructor(
    public code: ApiErrorCode,
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let connection: Connection | null = null;

function getConnection(): Connection {
  connection ??= new Connection(process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL, {
    commitment: "confirmed",
    // Fail fast on 429 so the user sees a clear message instead of a long silent retry loop.
    disableRetryOnRateLimit: true,
  });
  return connection;
}

function rpcError(err: unknown): TxFetchError {
  const message = err instanceof Error ? err.message : String(err);
  if (/429|too many requests|rate limit/i.test(message)) {
    return new TxFetchError(
      "rate_limited",
      429,
      "The Solana RPC is rate limiting requests. Wait a few seconds and try again, or set SOLANA_RPC_URL to a dedicated endpoint.",
    );
  }
  return new TxFetchError("rpc_error", 502, `The Solana RPC returned an error: ${message}`);
}

/**
 * A raw JSON-RPC call, for responses web3.js can't handle (e.g. simulations with parsed
 * accounts, which its response validation rejects).
 */
export async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  let body: { result?: T; error?: { message?: string } };
  try {
    const res = await fetch(process.env.SOLANA_RPC_URL || DEFAULT_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429) throw new Error("429 Too Many Requests");
    body = await res.json();
  } catch (err) {
    throw rpcError(err);
  }
  if (body.error || body.result === undefined) throw rpcError(new Error(body.error?.message ?? "empty response"));
  return body.result;
}

export type RecentTx ={ signature: string; success: boolean; blockTime: number | null };

/** Latest transactions a wallet (or any address) took part in, newest first. */
export async function fetchRecentSignatures(address: string, limit = 8): Promise<RecentTx[]> {
  try {
    const sigs = await getConnection().getSignaturesForAddress(new PublicKey(address), { limit });
    return sigs.map((s) => ({ signature: s.signature, success: s.err === null, blockTime: s.blockTime ?? null }));
  } catch (err) {
    throw rpcError(err);
  }
}

const BATCH_SIZE = 5;
/** Pause between batches, and before each retry, to stay under the public RPC's rate limit. */
const BATCH_PAUSE_MS = 400;
const BATCH_RETRY_DELAYS_MS = [1200, 2500];

/**
 * Many transactions, fetched in small batches so the public RPC doesn't rate limit us.
 * Anything that can't be fetched (even after retries) comes back as null; this never throws.
 */
export async function fetchParsedTransactions(signatures: string[]): Promise<(ParsedTransactionWithMeta | null)[]> {
  const results: (ParsedTransactionWithMeta | null)[] = [];
  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const batch = signatures.slice(i, i + BATCH_SIZE);
    if (i > 0) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
    let fetched: (ParsedTransactionWithMeta | null)[] | null = null;
    for (const delay of [0, ...BATCH_RETRY_DELAYS_MS]) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        fetched = await getConnection().getParsedTransactions(batch, {
          maxSupportedTransactionVersion: MAX_TX_VERSION,
          commitment: "confirmed",
        });
        break;
      } catch {
        // Retry after a pause; give up on this batch after the last delay.
      }
    }
    // Batch responses can come back in any order, so match them by signature, not position.
    const bySignature = new Map(
      (fetched ?? []).filter((t): t is ParsedTransactionWithMeta => t !== null).map((t) => [t.transaction.signatures[0], t]),
    );
    results.push(...batch.map((sig) => bySignature.get(sig) ?? null));
  }
  return results;
}

export async function fetchParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta> {
  let tx: ParsedTransactionWithMeta | null;
  try {
    tx = await getConnection().getParsedTransaction(signature, {
      maxSupportedTransactionVersion: MAX_TX_VERSION,
      commitment: "confirmed",
    });
  } catch (err) {
    throw rpcError(err);
  }

  if (!tx) {
    throw new TxFetchError(
      "not_found",
      404,
      "Transaction not found on mainnet. Check the signature, or wait a moment if it was just sent. Very old transactions may not be available on every RPC.",
    );
  }
  return tx;
}
