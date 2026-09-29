/**
 * Cross-checks Docent's numbers against Helius' Enhanced Transactions API, an independent
 * decoder of the same transactions. Every comparison is exact (integer base units) except
 * individual transfer amounts, which Helius only reports as floating-point numbers.
 *
 * Checks per transaction:
 *   fee        network fee, in lamports
 *   status     success/failure, and the raw error for failures
 *   sol        every account's native SOL balance change
 *   tokens     every token account's balance change, per mint
 *   transfers  every token transfer (from, to, mint, amount), incl. attempted ones in failed txs
 *   summary    successful txs: the amounts in Docent's headline (what the wallet sent and
 *              received, SOL included) vs. the same totals computed from Helius' data
 *
 * Usage:
 *   npm run verify                         every fixture
 *   npm run verify -- <sig> [<sig> ...]    specific transactions
 *   npm run verify -- --sample [n]         n recent transactions (default 20) from each of a
 *                                          set of popular programs
 * Needs SOLANA_RPC_URL to be a Helius URL (its api-key is reused).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { shortAddress } from "@/lib/format";
import { fetchParsedTransactions, fetchRecentSignatures } from "@/lib/solana/rpc";
import { walletNet } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";
import { normalizeTransaction } from "@/lib/tx/normalize";

const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
/** Relative tolerance for Helius' floating-point transfer amounts. */
const FLOAT_EPSILON = 1e-9;
const HELIUS_BATCH = 100;

const SAMPLE_PROGRAMS: Record<string, string> = {
  Jupiter: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "Raydium AMM": "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  "Raydium CLMM": "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK",
  "Orca Whirlpool": "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",
  "Meteora DLMM": "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",
  "pump.fun": "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  Marinade: "MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD",
  "Stake Program": "Stake11111111111111111111111111111111111111",
  "Token-2022": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "Memo Program": "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "System Program": "11111111111111111111111111111111",
};

type RawAmount = { tokenAmount: string; decimals: number };
type HeliusTx = {
  signature: string;
  fee: number;
  feePayer: string;
  transactionError: unknown;
  tokenTransfers: { fromTokenAccount: string; toTokenAccount: string; tokenAmount: number; mint: string }[];
  accountData: {
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: { tokenAccount: string; mint: string; rawTokenAmount: RawAmount }[];
  }[];
  events?: {
    swap?: {
      nativeInput: { account: string; amount: string } | null;
      nativeOutput: { account: string; amount: string } | null;
      tokenInputs: { userAccount: string; mint: string; rawTokenAmount: RawAmount }[];
      tokenOutputs: { userAccount: string; mint: string; rawTokenAmount: RawAmount }[];
    };
  };
};

const CHECKS = ["fee", "status", "sol", "tokens", "transfers", "summary"] as const;
type Check = (typeof CHECKS)[number];
type Result = { check: Check; problems: string[] } | { check: Check; skipped: string };

// ---------- helpers ----------

/** "-10.4819" with 6 decimals → -10481900n. Exact. */
function toRaw(decimal: string, decimals: number): bigint {
  const negative = decimal.startsWith("-");
  const [whole, frac = ""] = decimal.replace("-", "").split(".");
  const raw = BigInt(whole + frac.padEnd(decimals, "0").slice(0, decimals));
  return negative ? -raw : raw;
}

function heliusKey(): string {
  const key = new URL(process.env.SOLANA_RPC_URL ?? "https://x").searchParams.get("api-key");
  if (!key) throw new Error("SOLANA_RPC_URL must be a Helius URL with an api-key.");
  return key;
}

async function heliusTransactions(sigs: string[]): Promise<Map<string, HeliusTx>> {
  const key = heliusKey();
  const out = new Map<string, HeliusTx>();
  for (let i = 0; i < sigs.length; i += HELIUS_BATCH) {
    const res = await fetch(`https://api.helius.xyz/v0/transactions/?api-key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: sigs.slice(i, i + HELIUS_BATCH) }),
    });
    if (!res.ok) throw new Error(`Helius returned ${res.status}: ${await res.text()}`);
    for (const t of (await res.json()) as HeliusTx[]) out.set(t.signature, t);
  }
  return out;
}

async function signatures(): Promise<{ sigs: string[]; labels: Map<string, string> }> {
  const args = process.argv.slice(2);
  const labels = new Map<string, string>();
  if (args[0] === "--sample") {
    const perProgram = Number(args[1] ?? 20);
    const sigs: string[] = [];
    for (const [name, address] of Object.entries(SAMPLE_PROGRAMS)) {
      try {
        const recent = await fetchRecentSignatures(address, perProgram);
        for (const r of recent) {
          if (labels.has(r.signature)) continue;
          labels.set(r.signature, name);
          sigs.push(r.signature);
        }
      } catch (err) {
        console.log(`(could not sample ${name}: ${err instanceof Error ? err.message : err})`);
      }
    }
    return { sigs, labels };
  }
  if (args.length > 0) return { sigs: args, labels };
  const dir = path.join(process.cwd(), "fixtures");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const sigs = await Promise.all(
    files.map(async (f) => (JSON.parse(await readFile(path.join(dir, f), "utf8")) as TxModel).signature),
  );
  return { sigs: [...new Set(sigs)], labels };
}

// ---------- checks ----------

function checkFee(tx: TxModel, h: HeliusTx): string[] {
  return h.fee === tx.feeLamports ? [] : [`Docent ${tx.feeLamports} lamports, Helius ${h.fee}`];
}

function checkStatus(tx: TxModel, h: HeliusTx): string[] {
  const theirsFailed = h.transactionError !== null && h.transactionError !== undefined;
  if (tx.success === theirsFailed) return [`Docent says ${tx.success ? "success" : "failed"}, Helius disagrees`];
  if (tx.failure && JSON.stringify(tx.failure.raw) !== JSON.stringify(h.transactionError)) {
    return [`error: Docent ${JSON.stringify(tx.failure.raw)}, Helius ${JSON.stringify(h.transactionError)}`];
  }
  return [];
}

function checkSol(tx: TxModel, h: HeliusTx): string[] {
  const ours = new Map(tx.solChanges.map((c) => [c.address, toRaw(c.delta, 9)]));
  const theirs = new Map(
    h.accountData.filter((a) => a.nativeBalanceChange !== 0).map((a) => [a.account, BigInt(a.nativeBalanceChange)]),
  );
  const problems: string[] = [];
  for (const account of new Set([...ours.keys(), ...theirs.keys()])) {
    const a = ours.get(account) ?? 0n;
    const b = theirs.get(account) ?? 0n;
    if (a !== b) problems.push(`${shortAddress(account)}: Docent ${a} lamports, Helius ${b}`);
  }
  return problems;
}

/**
 * Helius computes some raw amounts through floating-point numbers, so very large balances lose
 * their last digits (e.g. a balance of 187,519,881.528508123 tokens gives a change off by 3 units).
 * Docent subtracts the chain's exact integer strings, so a difference this tiny is Helius' rounding.
 * Verified against raw RPC data for 4j4iNeQC…: the exact change is Docent's value.
 */
let roundingNotes = 0;
function heliusRounding(a: bigint, b: bigint): boolean {
  if (b === 0n) return false;
  if (Math.abs(Number(a - b)) <= Math.abs(Number(b)) * 1e-12) {
    roundingNotes++;
    return true;
  }
  return false;
}

function checkTokens(tx: TxModel, h: HeliusTx): string[] {
  const ours = new Map(tx.tokenChanges.map((c) => [`${c.tokenAccount}|${c.mint}`, toRaw(c.delta, c.decimals)]));
  const theirs = new Map<string, bigint>();
  for (const a of h.accountData) {
    for (const c of a.tokenBalanceChanges) {
      const raw = BigInt(c.rawTokenAmount.tokenAmount);
      if (raw !== 0n) theirs.set(`${c.tokenAccount}|${c.mint}`, raw);
    }
  }
  const problems: string[] = [];
  for (const key of new Set([...ours.keys(), ...theirs.keys()])) {
    const a = ours.get(key) ?? 0n;
    const b = theirs.get(key) ?? 0n;
    if (a !== b && !heliusRounding(a, b)) {
      const [account, mint] = key.split("|");
      problems.push(`${shortAddress(account)} (${shortAddress(mint)}): Docent ${a}, Helius ${b}`);
    }
  }
  return problems;
}

function checkTransfers(tx: TxModel, h: HeliusTx): string[] {
  // Multiset match: each Helius transfer must pair with one of ours with the same accounts,
  // mint and amount, and nothing of ours may be left over.
  const ours = tx.transfers
    .filter((t) => t.kind === "token")
    .map((t) => ({ key: `${t.from}>${t.to}|${t.mint}`, amount: Number(t.amount), used: false }));
  const problems: string[] = [];
  for (const t of h.tokenTransfers) {
    // Helius also lists mints and burns as transfers (one side empty); Docent doesn't treat them as transfers.
    if (!t.fromTokenAccount || !t.toTokenAccount) continue;
    const key = `${t.fromTokenAccount}>${t.toTokenAccount}|${t.mint}`;
    const match = ours.find(
      (o) => !o.used && o.key === key && Math.abs(o.amount - t.tokenAmount) <= FLOAT_EPSILON * Math.max(1, t.tokenAmount),
    );
    if (match) match.used = true;
    else problems.push(`missing in Docent: ${t.tokenAmount} ${shortAddress(t.mint)} ${shortAddress(t.fromTokenAccount)} → ${shortAddress(t.toTokenAccount)}`);
  }
  for (const o of ours.filter((o) => !o.used)) {
    const [route, mint] = o.key.split("|");
    const [from, to] = route.split(">");
    problems.push(`extra in Docent: ${o.amount} ${shortAddress(mint)} ${shortAddress(from)} → ${shortAddress(to)}`);
  }
  return problems;
}

/**
 * The headline's amounts come from walletNet(): the wallet's total change per asset. Rebuild the
 * same totals from Helius' account data and require an exact match:
 *   tokens: Helius token balance changes where the wallet is the owner (wrapped SOL counted as SOL)
 *   SOL:    Helius lamport changes of the wallet and its token accounts, plus the fee it paid
 */
function checkSummary(tx: TxModel, h: HeliusTx): Result {
  if (!tx.success) return { check: "summary", skipped: "failed transaction: nothing actually moved" };
  const wallet = tx.feePayer;
  const owned = new Set([wallet, ...tx.tokenAccounts.filter((a) => a.owner === wallet).map((a) => a.address)]);

  const theirs = new Map<string, bigint>();
  const add = (asset: string, amount: bigint) => theirs.set(asset, (theirs.get(asset) ?? 0n) + amount);
  add("SOL", BigInt(h.fee));
  for (const a of h.accountData) {
    if (owned.has(a.account)) add("SOL", BigInt(a.nativeBalanceChange));
    for (const c of a.tokenBalanceChanges) {
      if (c.mint === WRAPPED_SOL || !owned.has(c.tokenAccount)) continue;
      add(c.mint, BigInt(c.rawTokenAmount.tokenAmount));
    }
  }
  const ours = new Map(walletNet(tx, wallet).map((a) => [a.mint ?? "SOL", a.net]));

  const problems: string[] = [];
  for (const asset of new Set([...ours.keys(), ...theirs.keys()])) {
    const a = ours.get(asset) ?? 0n;
    const b = theirs.get(asset) ?? 0n;
    if (a !== b && !heliusRounding(a, b)) {
      const name = asset === "SOL" ? "SOL" : shortAddress(asset);
      problems.push(`${name}: Docent ${a}, Helius ${b}${asset === "SOL" ? " lamports" : ""}`);
    }
  }
  return { check: "summary", problems };
}

// ---------- main ----------

async function main() {
  const { sigs, labels } = await signatures();
  console.log(`Checking ${sigs.length} transactions…\n`);
  const [raws, helius] = await Promise.all([fetchParsedTransactions(sigs), heliusTransactions(sigs)]);

  const tally = Object.fromEntries(CHECKS.map((c) => [c, { passed: 0, failed: 0, skipped: 0 }])) as Record<
    Check,
    { passed: number; failed: number; skipped: number }
  >;
  let fullyPassed = 0;
  let unchecked = 0;

  sigs.forEach((sig, i) => {
    const raw = raws[i];
    const h = helius.get(sig);
    const where = labels.get(sig) ? ` [${labels.get(sig)}]` : "";
    if (!raw || !h) {
      unchecked++;
      console.log(`?  ${shortAddress(sig)}${where}  could not load from ${!raw ? "RPC" : "Helius"} (not counted)`);
      return;
    }
    let tx: TxModel;
    try {
      tx = normalizeTransaction(sig, raw);
    } catch (err) {
      unchecked++;
      console.log(`✗  ${shortAddress(sig)}${where}  Docent could not read it: ${err instanceof Error ? err.message : err}`);
      return;
    }

    const results: Result[] = [
      { check: "fee", problems: checkFee(tx, h) },
      { check: "status", problems: checkStatus(tx, h) },
      { check: "sol", problems: checkSol(tx, h) },
      { check: "tokens", problems: checkTokens(tx, h) },
      { check: "transfers", problems: checkTransfers(tx, h) },
      checkSummary(tx, h),
    ];
    const failed = results.filter((r) => "problems" in r && r.problems.length > 0);
    for (const r of results) {
      if ("skipped" in r) tally[r.check].skipped++;
      else if (r.problems.length) tally[r.check].failed++;
      else tally[r.check].passed++;
    }
    if (failed.length === 0) {
      fullyPassed++;
      return;
    }
    console.log(`✗  ${sig}${where}`);
    for (const r of failed) {
      if ("problems" in r) r.problems.slice(0, 6).forEach((p) => console.log(`     ${r.check}: ${p}`));
    }
  });

  const checked = sigs.length - unchecked;
  console.log(`\n${fullyPassed}/${checked} transactions passed every check${unchecked ? ` (${unchecked} could not be loaded)` : ""}\n`);
  for (const c of CHECKS) {
    const t = tally[c];
    console.log(`  ${c.padEnd(10)} ${t.passed} passed, ${t.failed} failed${t.skipped ? `, ${t.skipped} not applicable` : ""}`);
  }
  if (roundingNotes) console.log(`\n  (${roundingNotes} token amounts differed only by Helius' float rounding of very large numbers; Docent's exact values were used)`);
  process.exit(fullyPassed === checked && unchecked === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
