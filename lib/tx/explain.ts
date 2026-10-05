import { formatUnits, parseUnits, shortAddress } from "@/lib/format";
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, isTokenProgram, tokenLabel } from "@/lib/solana/known";
import type { Instruction, TopLevelInstruction, Transfer, TxModel } from "@/lib/tx/model";

/**
 * Plain-English explanation of a TxModel, built only from facts in the model.
 * Deterministic: the same transaction always gives the same text.
 */
export type ExplainedStep = {
  text: string;
  /** Sub-steps, e.g. the individual swaps inside a Jupiter route. */
  details: string[];
  failed: boolean;
};

export type Explanation = {
  headline: string;
  steps: ExplainedStep[];
  outcome: string;
};

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

const PROGRAM_BLURBS: Record<string, string> = {
  Jupiter: "a trading router that finds the best price across exchanges",
  "Orca Whirlpool": "an exchange",
  "Raydium AMM": "an exchange",
  "Raydium CLMM": "an exchange",
};

/** Readable amount: keeps up to 4 decimals (6 significant digits below 1). Display only. */
export function displayAmount(amount: string): string {
  const n = Math.abs(Number(amount));
  if (!Number.isFinite(n)) return amount;
  const opts: Intl.NumberFormatOptions =
    n >= 1 ? { maximumFractionDigits: 4 } : { maximumSignificantDigits: 6 };
  return n.toLocaleString("en-US", opts);
}

const money = (t: Pick<Transfer, "amount" | "symbol">) => `${displayAmount(t.amount)} ${t.symbol}`;

function venueName(name: string | null, id: string | null): string {
  if (!name || !id) return "an unknown program";
  return name === shortAddress(id) ? `an unlabelled exchange (${name})` : name;
}

/** Per-token totals the wallet sent to and received from others (own-account moves excluded). */
export type TokenFlow = {
  mint: string | null;
  symbol: string;
  symbolKnown: boolean;
  decimals: number | null;
  sent: bigint;
  received: bigint;
};

export function walletFlows(tx: TxModel, wallet: string = tx.feePayer): TokenFlow[] {
  const flows = new Map<string, TokenFlow>();
  for (const t of tx.transfers) {
    const out = t.fromOwner === wallet && t.toOwner !== wallet;
    const into = t.toOwner === wallet && t.fromOwner !== wallet;
    if (!out && !into) continue;
    // Native SOL and wrapped SOL are the same asset to the wallet: one "SOL" line.
    const isSol = t.mint === null || t.mint === WRAPPED_SOL_MINT;
    const key = isSol ? "SOL" : t.mint!;
    const flow = flows.get(key) ?? {
      mint: isSol ? null : t.mint,
      symbol: isSol ? "SOL" : t.symbol,
      symbolKnown: isSol ? true : t.symbolKnown,
      decimals: isSol ? 9 : t.decimals,
      sent: 0n,
      received: 0n,
    };
    if (out) flow.sent += BigInt(t.rawAmount);
    else flow.received += BigInt(t.rawAmount);
    flows.set(key, flow);
  }
  return [...flows.values()];
}

function amountOf(flow: TokenFlow, raw: bigint): string {
  const abs = raw < 0n ? -raw : raw;
  const text = flow.decimals === null ? abs.toString() : formatUnits(abs, flow.decimals);
  return `${displayAmount(text)} ${flow.symbol}`;
}

function list(parts: string[]): string {
  if (parts.length <= 2) return parts.join(" and ");
  return `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more`;
}

/** An asset's exact net change for one wallet. */
export type NetAsset = {
  mint: string | null;
  symbol: string;
  symbolKnown: boolean;
  decimals: number;
  net: bigint;
};

/**
 * What actually changed for `wallet`, from Solana's before/after balances. This catches every
 * kind of movement, including SOL paid out directly by programs (e.g. pump.fun sales) and
 * refunds from closed accounts, which never appear as transfers.
 *   tokens: balance changes of token accounts the wallet owns (wrapped SOL counted as SOL)
 *   SOL:    lamport changes of the wallet and its token accounts, so wrapping SOL or funding
 *           the wallet's own accounts cancels out; the network fee is excluded (shown separately)
 */
export function walletNet(tx: TxModel, wallet: string = tx.feePayer): NetAsset[] {
  const owned = new Set([wallet, ...tx.tokenAccounts.filter((a) => a.owner === wallet).map((a) => a.address)]);
  let sol = wallet === tx.feePayer ? BigInt(tx.feeLamports) : 0n;
  for (const c of tx.solChanges) if (owned.has(c.address)) sol += parseUnits(c.delta, 9);

  const assets = new Map<string, NetAsset>();
  if (sol !== 0n) assets.set("SOL", { mint: null, symbol: "SOL", symbolKnown: true, decimals: 9, net: sol });
  for (const c of tx.tokenChanges) {
    if (c.owner !== wallet || c.mint === WRAPPED_SOL_MINT) continue;
    const asset = assets.get(c.mint) ?? {
      mint: c.mint,
      symbol: c.symbol,
      symbolKnown: c.symbolKnown,
      decimals: c.decimals,
      net: 0n,
    };
    asset.net += parseUnits(c.delta, c.decimals);
    assets.set(c.mint, asset);
  }
  return [...assets.values()].filter((a) => a.net !== 0n);
}

/**
 * SOL changes this small are usually side costs (account deposits, tips) rather than the point
 * of the transaction, unless SOL was clearly traded via transfers. 0.01 SOL.
 */
const SOL_SIDE_COST = 10_000_000n;
const SOL_TRADED = 1_000_000n;

/** Splits the wallet's net changes into the main assets and a small SOL side cost (if any). */
export function mainAndSideCost(tx: TxModel, wallet: string = tx.feePayer): { main: NetAsset[]; solSide: bigint } {
  const net = walletNet(tx, wallet);
  const sol = net.find((a) => a.mint === null);
  const others = net.filter((a) => a.mint !== null);
  if (!sol || others.length === 0) return { main: net, solSide: 0n };
  const solFlow = walletFlows(tx, wallet).find((f) => f.mint === null);
  const tradedViaTransfers = solFlow !== undefined && (solFlow.sent >= SOL_TRADED || solFlow.received >= SOL_TRADED);
  const abs = sol.net < 0n ? -sol.net : sol.net;
  if (tradedViaTransfers || abs >= SOL_SIDE_COST) return { main: net, solSide: 0n };
  return { main: others, solSide: sol.net };
}

function netAmount(a: NetAsset): string {
  const abs = a.net < 0n ? -a.net : a.net;
  return `${displayAmount(formatUnits(abs, a.decimals))} ${a.symbol}`;
}

/** One-line summary of what the transaction did for `wallet` (default: the wallet that sent it). */
export function headline(tx: TxModel, wallet: string = tx.feePayer): string {
  if (!tx.success) return attemptedHeadline(tx, wallet);

  const { main } = mainAndSideCost(tx, wallet);
  const sent = main.filter((a) => a.net < 0n);
  const got = main.filter((a) => a.net > 0n);
  if (sent.length > 0 && got.length > 0) {
    return `Swapped ${list(sent.map(netAmount))} for ${list(got.map(netAmount))}`;
  }

  // One asset went out and came back (typical of trading bots): describe the loop using the
  // gross transfers, which is what actually happened, rather than the tiny net difference.
  const flows = walletFlows(tx, wallet);
  const loop = flows.find((f) => f.sent > 0n && f.received > 0n && f.sent !== f.received);
  if (loop && main.length <= 1 && (main.length === 0 || (main[0].mint ?? null) === loop.mint)) {
    return `Traded ${loop.symbol} in a loop: put in ${amountOf(loop, loop.sent)}, got back ${amountOf(loop, loop.received)}`;
  }

  if (sent.length > 0) return `Sent ${list(sent.map(netAmount))}`;
  if (got.length > 0) return `Received ${list(got.map(netAmount))}`;

  // Nothing moved, but permissions can matter more than movements.
  const all = tx.instructions.flatMap((ix) => [ix, ...ix.inner]);
  const approval = all.find((ix) => (ix.type === "approve" || ix.type === "approveChecked") && isTokenProgram(ix.programId));
  if (approval) return `Gave another address permission to spend ${approvalAmount(tx, approval).text}`;
  if (all.some((ix) => ix.type === "setAuthority" && isTokenProgram(ix.programId))) return "Handed over control of a token account";
  return "Ran programs without moving any tokens";
}

/**
 * Failed transactions change nothing, so describe what they tried to do from the transfers
 * they attempted (net totals, so split routes add up).
 */
function attemptedHeadline(tx: TxModel, wallet: string): string {
  const flows = walletFlows(tx, wallet);
  const sent = flows.filter((f) => f.received < f.sent);
  const got = flows.filter((f) => f.received > f.sent);

  if (sent.length > 0 && got.length > 0) {
    const s = list(sent.map((f) => amountOf(f, f.sent - f.received)));
    const g = list(got.map((f) => amountOf(f, f.received - f.sent)));
    return `Tried to swap ${s} for ${g}, but it was cancelled`;
  }
  const loop = flows.find((f) => f.sent > 0n && f.received > 0n && f.sent !== f.received);
  if (loop) return `Tried to trade ${amountOf(loop, loop.sent)} in a loop back to ${loop.symbol}, but it was cancelled`;
  if (sent.length > 0) return `Tried to send ${list(sent.map((f) => amountOf(f, f.sent - f.received)))}`;
  if (got.length > 0) return `Tried to receive ${list(got.map((f) => amountOf(f, f.received - f.sent)))}`;
  return "A transaction that failed";
}

/** Swaps inside a router instruction: transfers grouped by the exchange that made them. */
function venueSwaps(ix: TopLevelInstruction, transfers: Transfer[], payer: string): string[] {
  const groups = new Map<string, Transfer[]>();
  for (const t of transfers) {
    if (t.index !== ix.index || !t.viaProgramId || t.viaProgramId === ix.programId) continue;
    const list = groups.get(t.viaProgramId) ?? [];
    list.push(t);
    groups.set(t.viaProgramId, list);
  }
  const lines: string[] = [];
  for (const list of groups.values()) {
    // Some exchanges pay out before collecting, so prefer ownership over order:
    // what the wallet sent is the input, what it received is the output.
    const first = list.find((t) => t.fromOwner === payer) ?? list[0];
    const last = list.find((t) => t.toOwner === payer && t !== first) ?? list[list.length - 1];
    const venue = venueName(first.viaProgramName, first.viaProgramId);
    lines.push(
      list.length >= 2 && first.symbol !== last.symbol
        ? `Swapped ${money(first)} for ${money(last)} on ${venue}`
        : `Moved ${money(first)} through ${venue}`,
    );
  }
  return lines;
}

/** The largest possible token amount: approving this means "unlimited". */
const U64_MAX = "18446744073709551615";

/** Symbol and decimals of the token held in `tokenAccount`, if the transaction shows it. */
export function tokenIn(tx: TxModel, tokenAccount: unknown): { symbol: string; decimals: number | null } {
  const mint = tx.tokenAccounts.find((a) => a.address === tokenAccount)?.mint;
  if (!mint) return { symbol: "tokens", decimals: null };
  return { symbol: tokenLabel(mint).symbol, decimals: tx.tokenChanges.find((c) => c.mint === mint)?.decimals ?? null };
}

/** How much an approve/approveChecked instruction lets the delegate spend, e.g. "an unlimited amount of USDC". */
export function approvalAmount(tx: TxModel, ix: Instruction): { symbol: string; text: string } {
  const info = ix.info ?? {};
  const token = tokenIn(tx, info.source);
  const checked = info.tokenAmount as { amount?: string; decimals?: number } | undefined;
  const raw = ix.type === "approve" ? info.amount : checked?.amount;
  const decimals = typeof checked?.decimals === "number" ? checked.decimals : token.decimals;
  const text =
    raw === U64_MAX
      ? `an unlimited amount of ${token.symbol}`
      : typeof raw === "string" && decimals !== null
        ? `up to ${displayAmount(formatUnits(BigInt(raw), decimals))} ${token.symbol}`
        : `the wallet's ${token.symbol}`;
  return { symbol: token.symbol, text };
}

function describe(ix: TopLevelInstruction, tx: TxModel): Omit<ExplainedStep, "failed"> {
  const info = ix.info ?? {};
  const str = (k: string) => (typeof info[k] === "string" ? (info[k] as string) : null);

  if (ix.programId === SYSTEM_PROGRAM_ID) {
    if (ix.type === "advanceNonce")
      return { text: "Used a durable nonce, a pre-signed ticket that lets a transaction be sent later", details: [] };
    if (ix.type === "transfer") {
      const t = tx.transfers.find((x) => x.index === ix.index && x.innerIndex === null);
      const wrapping = t && tx.tokenAccounts.some((a) => a.address === t.to && a.mint === WRAPPED_SOL_MINT && a.owner === t.fromOwner);
      if (t && wrapping) return { text: `Put ${money(t)} into the wallet's wrapped SOL account, so it can be traded like a token`, details: [] };
      if (t) return { text: `Sent ${money(t)} to ${shortAddress(t.to)}`, details: [] };
    }
    if (ix.type === "assign") return { text: `Handed control of an account to the program ${shortAddress(str("owner") ?? "")}`, details: [] };
    if (ix.type === "createAccount") return { text: "Created a new account", details: [] };
  }

  if (ix.programId === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL") {
    const mint = str("mint");
    const symbol =
      mint === WRAPPED_SOL_MINT ? "wrapped SOL (SOL in token form)" : mint ? tokenLabel(mint).symbol : "token";
    return {
      text: `Made sure the wallet has a ${symbol} account, a separate balance it needs for each token`,
      details: [],
    };
  }

  if (isTokenProgram(ix.programId)) {
    if (ix.type === "closeAccount")
      return { text: "Closed a temporary token account and got its small SOL deposit back", details: [] };
    if (ix.type === "syncNative") return { text: "Updated the wallet's wrapped SOL balance", details: [] };
    if (ix.type === "approve" || ix.type === "approveChecked") {
      return {
        text: `Gave ${shortAddress(str("delegate") ?? "another address")} permission to spend ${approvalAmount(tx, ix).text}`,
        details: [],
      };
    }
    if (ix.type === "revoke") return { text: "Took back a permission it had given another address to spend its tokens", details: [] };
    if (ix.type === "setAuthority") {
      const token = tokenIn(tx, str("account"));
      const to = str("newAuthority");
      const role = str("authorityType") === "accountOwner" ? "ownership" : "control";
      return { text: `Handed ${role} of a ${token.symbol} account to ${to ? shortAddress(to) : "nobody"}`, details: [] };
    }
    const t = tx.transfers.find((x) => x.index === ix.index && x.innerIndex === null);
    if (t) {
      const internal = t.fromOwner === t.toOwner && t.fromOwner !== null;
      return {
        text: internal
          ? `Moved ${money(t)} between two of the wallet's own accounts`
          : `Sent ${money(t)} to ${shortAddress(t.toOwner ?? t.to)}`,
        details: [],
      };
    }
  }

  if (ix.programId === "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" && str("memo")) {
    return { text: `Attached a note: “${str("memo")}”`, details: [] };
  }

  const swaps = venueSwaps(ix, tx.transfers, tx.feePayer);
  const blurb = PROGRAM_BLURBS[ix.programName];
  const who = blurb ? `${ix.programName} (${blurb})` : ix.programName;
  if (swaps.length > 0) {
    return { text: `Asked ${who} to make a trade${swaps.length > 1 ? ` using ${swaps.length} swaps` : ""}`, details: swaps };
  }
  return { text: `Ran ${who}${ix.programKnown ? "" : ", a program without a known name"}`, details: [] };
}

export function explainTransaction(tx: TxModel): Explanation {
  const steps: ExplainedStep[] = [];
  const failedIndex = tx.failure?.instructionIndex ?? null;

  // Compute Budget instructions are bookkeeping; fold them into one line.
  const budget = tx.instructions.filter((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM_ID);
  if (budget.length > 0) {
    const limit = budget.find((ix) => ix.type === "setComputeUnitLimit")?.info?.units;
    const tip = budget.some((ix) => ix.type === "setComputeUnitPrice");
    const parts = [
      typeof limit === "number" ? `set a computing budget of ${limit.toLocaleString("en-US")} units` : "set its computing budget",
      tip ? "added a priority tip so it gets processed sooner" : null,
    ].filter(Boolean);
    const text = parts.join(" and ");
    steps.push({ text: text.charAt(0).toUpperCase() + text.slice(1), details: [], failed: false });
  }

  for (const ix of tx.instructions) {
    if (ix.programId === COMPUTE_BUDGET_PROGRAM_ID) continue;
    if (failedIndex !== null && ix.index > failedIndex) break;
    steps.push({ ...describe(ix, tx), failed: ix.index === failedIndex });
  }

  const reason =
    tx.failure?.errorName === "SlippageToleranceExceeded"
      ? "prices moved, so the trade would have returned less than the minimum the wallet agreed to accept."
      : (tx.failure?.description ?? "an error occurred.");
  const { solSide } = tx.success ? mainAndSideCost(tx) : { solSide: 0n };
  const side =
    solSide < 0n
      ? ` It also spent ${displayAmount(formatUnits(-solSide, 9))} SOL on small extras like account deposits and tips.`
      : solSide > 0n
        ? ` It also got back ${displayAmount(formatUnits(solSide, 9))} SOL, such as refunded account deposits.`
        : "";
  const outcome = tx.success
    ? `Everything worked. The wallet paid a network fee of ${tx.feeSol} SOL.${side}`
    : `Then it stopped: ${reason} Solana undid every step, so nothing moved except the ${tx.feeSol} SOL fee.`;

  return { headline: headline(tx), steps, outcome };
}
