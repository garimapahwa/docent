import { walletFlows } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";

/** Below this, SOL sent to a wallet by someone else is treated as dust (0.001 SOL). */
const DUST_LAMPORTS = 1_000_000n;
/** Below this many whole units, a known token (e.g. 0.0001 USDT) is also dust. */
const DUST_TOKEN_UNITS = 0.01;

/** Below one whole token, an unknown token is dust. */
const DUST_UNKNOWN_UNITS = 1;
/** Dropping the same token on this many wallets in one transaction is a mass airdrop. */
const AIRDROP_RECIPIENTS = 3;

function tokenAmount(raw: bigint, decimals: number | null): number {
  return decimals === null ? Number(raw) : Number(raw) / 10 ** decimals;
}

/** Most wallets the sender dropped `mint` on in this transaction (besides itself). */
function airdropSize(tx: TxModel, mint: string | null): number {
  const bySender = new Map<string | null, Set<string | null>>();
  for (const t of tx.transfers) {
    if (t.mint !== mint || t.toOwner === t.fromOwner) continue;
    const recipients = bySender.get(t.fromOwner) ?? new Set();
    recipients.add(t.toOwner);
    bySender.set(t.fromOwner, recipients);
  }
  return Math.max(0, ...[...bySender.values()].map((r) => r.size));
}

/**
 * Whether a transaction is likely spam from `wallet`'s point of view, with a plain reason.
 * Rules, in order:
 *  - The wallet signed it: its own action, never spam.
 *  - Someone else sent it and the wallet received nothing of value: tiny SOL or token
 *    amounts ("dust", used for address poisoning) or zero-amount transfers.
 *  - Unknown tokens are spam only as dust (under one token) or when dropped on many wallets
 *    at once. A direct transfer of a real amount is kept: Docent can't price every token,
 *    and hiding a real transfer is worse than showing an airdrop.
 * Real payments from others (SOL ≥ 0.001, known tokens ≥ 0.01) are kept.
 */
export function spamReason(tx: TxModel, wallet: string): string | null {
  const signed = tx.accounts.some((a) => a.address === wallet && a.signer);
  if (signed) return null;

  const incoming = walletFlows(tx, wallet).filter((f) => f.received > f.sent);
  if (incoming.length === 0) return "The wallet was only mentioned; nothing reached it";

  const airdropped = incoming.find((f) => airdropSize(tx, f.mint) >= AIRDROP_RECIPIENTS);
  if (airdropped) {
    return `${airdropped.symbolKnown ? airdropped.symbol : "A token"} dropped on ${airdropSize(tx, airdropped.mint)} wallets at once (an airdrop)`;
  }

  const valuable = incoming.some((f) => {
    if (f.received === 0n) return false;
    if (f.mint === null) return f.received >= DUST_LAMPORTS; // native SOL
    const units = tokenAmount(f.received, f.decimals);
    return units >= (f.symbolKnown ? DUST_TOKEN_UNITS : DUST_UNKNOWN_UNITS);
  });
  if (valuable) return null;

  if (incoming.every((f) => f.mint === null)) return "A tiny amount of SOL sent by someone else (dust)";
  if (incoming.every((f) => f.symbolKnown)) return "A tiny token amount sent by someone else (dust)";
  return "A tiny amount of an unknown token sent by someone else (dust)";
}
