/**
 * Cross-checks Docent's numbers for real transactions against two independent sources:
 *  1. Solana's own before/after balance snapshots (a different data path from the transfers
 *     Docent adds up for its summaries).
 *  2. Helius' Enhanced Transactions API, a third-party decoder of the same transaction.
 *
 * Usage: npm run verify -- [signature ...]   (defaults to every fixture)
 * Needs SOLANA_RPC_URL to be a Helius URL (the api-key is reused for check 2).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { formatUnits, shortAddress } from "@/lib/format";
import { fetchParsedTransactions } from "@/lib/solana/rpc";
import { headline, walletFlows } from "@/lib/tx/explain";
import { normalizeTransaction } from "@/lib/tx/normalize";
import type { TxModel } from "@/lib/tx/model";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** Allowed difference when comparing against Helius' floating-point amounts. */
const EPSILON = 1e-9;

type HeliusTx = {
  signature: string;
  fee: number;
  tokenTransfers: { fromUserAccount: string; toUserAccount: string; tokenAmount: number; mint: string }[];
};

async function signatures(): Promise<string[]> {
  const args = process.argv.slice(2);
  if (args.length > 0) return args;
  const dir = path.join(process.cwd(), "fixtures");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const sigs = await Promise.all(
    files.map(async (f) => (JSON.parse(await readFile(path.join(dir, f), "utf8")) as TxModel).signature),
  );
  return [...new Set(sigs)];
}

async function helius(sigs: string[]): Promise<Map<string, HeliusTx>> {
  const key = new URL(process.env.SOLANA_RPC_URL ?? "https://x").searchParams.get("api-key");
  if (!key) return new Map();
  const res = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: sigs }),
  });
  if (!res.ok) throw new Error(`Helius returned ${res.status}: ${await res.text()}`);
  const list = (await res.json()) as HeliusTx[];
  return new Map(list.map((t) => [t.signature, t]));
}

/** Docent's per-mint net flow for the wallet, from the transfers it adds up. Wrapped SOL excluded. */
function docentNet(tx: TxModel): Map<string, { net: bigint; decimals: number; symbol: string }> {
  const out = new Map<string, { net: bigint; decimals: number; symbol: string }>();
  for (const f of walletFlows(tx)) {
    if (!f.mint || f.mint === WRAPPED_SOL || f.decimals === null) continue;
    out.set(f.mint, { net: f.received - f.sent, decimals: f.decimals, symbol: f.symbol });
  }
  return out;
}

/** Check 1: net flows vs. Solana's balance snapshots for the wallet's token accounts. */
function checkBalances(tx: TxModel): string[] {
  if (!tx.success) return []; // failed transactions change no token balances
  const problems: string[] = [];
  const snapshot = new Map<string, bigint>();
  for (const c of tx.tokenChanges.filter((c) => c.ownedByFeePayer && c.mint !== WRAPPED_SOL)) {
    const delta = BigInt(c.delta.replace(".", "").replace(/^(-?)0+(?=\d)/, "$1")) * 10n ** BigInt(c.decimals - (c.delta.split(".")[1]?.length ?? 0));
    snapshot.set(c.mint, (snapshot.get(c.mint) ?? 0n) + delta);
  }
  const flows = docentNet(tx);
  for (const mint of new Set([...snapshot.keys(), ...flows.keys()])) {
    const a = flows.get(mint)?.net ?? 0n;
    const b = snapshot.get(mint) ?? 0n;
    if (a !== b) {
      const d = flows.get(mint)?.decimals ?? 0;
      problems.push(`${shortAddress(mint)}: transfers say ${formatUnits(a, d)}, balances say ${formatUnits(b, d)}`);
    }
  }
  return problems;
}

/** Check 2: fee and per-mint net flows vs. Helius. */
function checkHelius(tx: TxModel, h: HeliusTx): string[] {
  const problems: string[] = [];
  if (h.fee !== tx.feeLamports) problems.push(`fee: Docent ${tx.feeLamports} lamports, Helius ${h.fee}`);
  if (!tx.success) return problems;

  const theirs = new Map<string, number>();
  for (const t of h.tokenTransfers) {
    if (t.mint === WRAPPED_SOL) continue;
    const sign = t.toUserAccount === tx.feePayer ? 1 : t.fromUserAccount === tx.feePayer ? -1 : 0;
    if (sign === 0 || t.toUserAccount === t.fromUserAccount) continue;
    theirs.set(t.mint, (theirs.get(t.mint) ?? 0) + sign * t.tokenAmount);
  }
  const ours = docentNet(tx);
  for (const mint of new Set([...theirs.keys(), ...ours.keys()])) {
    const o = ours.get(mint);
    const a = o ? Number(formatUnits(o.net, o.decimals)) : 0;
    const b = theirs.get(mint) ?? 0;
    if (Math.abs(a - b) > EPSILON * Math.max(1, Math.abs(b))) {
      problems.push(`${o?.symbol ?? shortAddress(mint)}: Docent ${a}, Helius ${b}`);
    }
  }
  return problems;
}

async function main() {
  const sigs = await signatures();
  const [raws, heliusTxs] = await Promise.all([fetchParsedTransactions(sigs), helius(sigs)]);
  let failures = 0;
  let skipped = 0;

  sigs.forEach((sig, i) => {
    const raw = raws[i];
    if (!raw) {
      skipped++;
      console.log(`?  ${shortAddress(sig)}  could not fetch (skipped, not counted as passed)`);
      return;
    }
    const tx = normalizeTransaction(sig, raw);
    const h = heliusTxs.get(sig);
    const balance = checkBalances(tx);
    const outside = h ? checkHelius(tx, h) : null;
    const ok = balance.length === 0 && (outside === null || outside.length === 0);
    if (!ok) failures++;

    console.log(`${ok ? "✓" : "✗"}  ${shortAddress(sig)}  ${headline(tx)}`);
    console.log(`     balances: ${tx.success ? (balance.length ? "MISMATCH" : "match") : "n/a (failed tx)"}` +
      `   helius: ${outside === null ? "not checked" : outside.length ? "MISMATCH" : "match"}`);
    [...balance, ...(outside ?? [])].forEach((p) => console.log(`       - ${p}`));
  });

  const checked = sigs.length - skipped;
  console.log(`\n${checked - failures}/${checked} checked transactions passed${skipped ? `, ${skipped} skipped` : ""}`);
  process.exit(failures || skipped ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
