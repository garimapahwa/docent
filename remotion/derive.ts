/**
 * Turns a TxModel into what each scene draws. Pure functions, no invented data:
 * everything here is selected, grouped or formatted from the model.
 */
import { shortAddress } from "@/lib/format";
import { COMPUTE_BUDGET_PROGRAM_ID } from "@/lib/solana/known";
import { displayAmount } from "@/lib/tx/explain";
import type { Instruction, TopLevelInstruction, Transfer, TxModel } from "@/lib/tx/model";

const ACTION_LABELS: Record<string, string> = {
  advanceNonce: "Use durable nonce",
  setComputeUnitLimit: "Set compute limit",
  setComputeUnitPrice: "Set priority fee",
  createIdempotent: "Create token account",
  create: "Create token account",
  createAccount: "Create account",
  closeAccount: "Close account",
  transfer: "Transfer",
  transferChecked: "Transfer",
  syncNative: "Sync wrapped SOL",
  initializeAccount3: "Set up token account",
  RouteV2: "Route a swap",
  Route: "Route a swap",
  SharedAccountsRoute: "Route a swap",
  ExactOutRoute: "Route a swap",
  Swap: "Swap",
  SwapV2: "Swap",
  memo: "Attach a note",
};

export function actionLabel(ix: Pick<Instruction, "type">): string {
  if (!ix.type) return "Run program";
  if (ACTION_LABELS[ix.type]) return ACTION_LABELS[ix.type];
  const words = ix.type.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// ---------- programs scene ----------

export type ProgramCard = {
  key: string;
  step: string;
  name: string;
  action: string;
  highlight: "failure" | "accent" | null;
  inner: { name: string; action: string; transfers: number }[];
  moreInner: number;
};

const MAX_INNER = 4;

export function programCards(tx: TxModel): ProgramCard[] {
  const failedIndex = tx.failure?.instructionIndex ?? null;
  const cards: ProgramCard[] = [];
  const budget = tx.instructions.filter((ix) => ix.programId === COMPUTE_BUDGET_PROGRAM_ID);

  // The instruction with the most inner calls is usually the one that matters.
  const main = [...tx.instructions].sort((a, b) => b.inner.length - a.inner.length)[0];

  for (const ix of tx.instructions) {
    if (ix.programId === COMPUTE_BUDGET_PROGRAM_ID) {
      if (ix !== budget[0]) continue;
      cards.push({
        key: `ix-${ix.index}`,
        step: budget.length > 1 ? `Steps ${ix.index + 1}–${budget[budget.length - 1].index + 1}` : `Step ${ix.index + 1}`,
        name: "Compute Budget",
        action: budget.length > 1 ? "Set compute budget" : actionLabel(ix),
        highlight: null,
        inner: [],
        moreInner: 0,
      });
      continue;
    }
    const inner = directInner(ix);
    cards.push({
      key: `ix-${ix.index}`,
      step: `Step ${ix.index + 1}`,
      name: ix.programName,
      action: actionLabel(ix),
      highlight:
        ix.index === failedIndex ? "failure" : failedIndex === null && ix === main && ix.inner.length > 0 ? "accent" : null,
      inner: inner.slice(0, MAX_INNER),
      moreInner: Math.max(0, inner.length - MAX_INNER),
    });
  }
  return cards;
}

/** Calls made directly by a top-level instruction, skipping self-calls (event logging). */
function directInner(ix: TopLevelInstruction): ProgramCard["inner"] {
  const result: ProgramCard["inner"] = [];
  let current: ProgramCard["inner"][number] | null = null;
  for (const child of ix.inner) {
    const depth = child.stackHeight ?? 2;
    if (depth === 2) {
      current = null;
      if (child.programId === ix.programId) continue;
      current = { name: child.programName, action: actionLabel(child), transfers: 0 };
      result.push(current);
    } else if (current && (child.type === "transfer" || child.type === "transferChecked")) {
      current.transfers++;
    }
  }
  return result;
}

// ---------- token flow scene ----------

export type FlowNode = { key: string; label: string; sub: string; isWallet: boolean };
export type FlowEdge = { from: string; to: string; amount: string; symbol: string };

const MAX_EDGES = 8;
const MAX_VENUES = 4;

/**
 * Nodes are the wallet plus one node per program. Each token account owner is assigned to the
 * program that first moved its tokens, so a pool's two vaults (or a router's accounts) become one node.
 */
export function tokenFlow(tx: TxModel): { nodes: FlowNode[]; edges: FlowEdge[]; truncated: number } {
  const wallet = tx.feePayer;
  const nodes = new Map<string, FlowNode>();
  nodes.set(wallet, { key: wallet, label: "Wallet", sub: shortAddress(wallet), isWallet: true });
  const ownerNode = new Map<string, string>([[wallet, wallet]]);

  /** Node key for one side of a transfer, without creating anything. */
  const nodeKey = (owner: string | null, account: string, t: Transfer) => {
    const ownerKey = owner ?? account;
    return ownerNode.get(ownerKey) ?? t.viaProgramId ?? ownerKey;
  };
  const claim = (owner: string | null, account: string, key: string, t: Transfer) => {
    const ownerKey = owner ?? account;
    if (!ownerNode.has(ownerKey)) ownerNode.set(ownerKey, key);
    if (nodes.has(key)) return;
    const isProgram = t.viaProgramId === key;
    const named = isProgram && t.viaProgramName && t.viaProgramName !== shortAddress(key);
    nodes.set(key, {
      key,
      label: named ? t.viaProgramName! : isProgram ? "Unnamed program" : "Other wallet",
      sub: shortAddress(key),
      isWallet: false,
    });
  };

  const edges: FlowEdge[] = [];
  let skipped = 0;
  for (const t of tx.transfers) {
    const from = nodeKey(t.fromOwner, t.from, t);
    const to = nodeKey(t.toOwner, t.to, t);
    if (from === to) continue;
    const venuesAfter = new Set([...nodes.keys(), from, to]).size - 1;
    if (edges.length >= MAX_EDGES || venuesAfter > MAX_VENUES) {
      skipped++;
      continue;
    }
    claim(t.fromOwner, t.from, from, t);
    claim(t.toOwner, t.to, to, t);
    edges.push({ from, to, amount: displayAmount(t.amount), symbol: t.symbol });
  }
  return { nodes: [...nodes.values()], edges, truncated: skipped };
}

// ---------- balances scene ----------

export type BalanceRow = { symbol: string; before: string; after: string; delta: string; sign: 1 | -1 | 0 };

function sign(delta: string): 1 | -1 | 0 {
  if (/^-/.test(delta)) return -1;
  return /[1-9]/.test(delta) ? 1 : 0;
}

/** Rounded before/after, unless rounding would hide the change; then the exact values. */
function row(symbol: string, c: { pre: string; post: string; delta: string }): BalanceRow {
  const before = displayAmount(c.pre);
  const after = displayAmount(c.post);
  const hidden = before === after;
  return {
    symbol,
    before: hidden ? c.pre : before,
    after: hidden ? c.post : after,
    delta: displayAmount(c.delta),
    sign: sign(c.delta),
  };
}

export function balanceRows(tx: TxModel): BalanceRow[] {
  const rows: BalanceRow[] = [];
  const sol = tx.solChanges.find((c) => c.isFeePayer);
  if (sol) rows.push(row("SOL", sol));
  for (const c of tx.tokenChanges.filter((c) => c.ownedByFeePayer)) rows.push(row(c.symbol, c));
  return rows.slice(0, 5);
}
