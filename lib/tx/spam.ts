import { walletFlows } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";

/** Below this, SOL sent to a wallet by someone else is treated as dust (0.001 SOL). */
const DUST_LAMPORTS = 1_000_000n;
/** Below this many whole units, a known token (e.g. 0.0001 USDT) is also dust. */
const DUST_TOKEN_UNITS = 0.01;

function tokenAmount(raw: bigint, decimals: number | null): number {
  return decimals === null ? Number(raw) : Number(raw) / 10 ** decimals;
}

/**
 * Whether a transaction is likely spam from `wallet`'s point of view, with a plain reason.
 * Rules, in order:
 *  - The wallet signed it: its own action, never spam.
 *  - Someone else sent it and the wallet received nothing of value: tiny SOL or token
 *    amounts ("dust", used for address poisoning), zero-amount transfers, or tokens Docent
 *    doesn't recognise.
 * Real payments from others (SOL ≥ 0.001, known tokens ≥ 0.01) are kept.
 */
export function spamReason(tx: TxModel, wallet: string): string | null {
  const signed = tx.accounts.some((a) => a.address === wallet && a.signer);
  if (signed) return null;

  const incoming = walletFlows(tx, wallet).filter((f) => f.received > f.sent);
  if (incoming.length === 0) return "The wallet was only mentioned; nothing reached it";

  const valuable = incoming.some((f) => {
    if (f.received === 0n) return false;
    if (f.mint === null) return f.received >= DUST_LAMPORTS; // native SOL
    return f.symbolKnown && tokenAmount(f.received, f.decimals) >= DUST_TOKEN_UNITS;
  });
  if (valuable) return null;

  if (incoming.every((f) => f.mint === null)) return "A tiny amount of SOL sent by someone else (dust)";
  if (incoming.every((f) => f.symbolKnown)) return "A tiny token amount sent by someone else (dust)";
  return "An unknown token sent by someone else";
}
