import type {
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  TokenBalance,
} from "@solana/web3.js";
import { SOL_DECIMALS, formatUnits, lamportsToSol } from "@/lib/format";
import { base58Decode } from "@/lib/solana/base58";
import { decodeFailure } from "@/lib/solana/errors";
import {
  COMPUTE_BUDGET_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  isTokenProgram,
  programLabel,
  tokenLabel,
} from "@/lib/solana/known";
import type {
  Instruction,
  SolChange,
  TokenChange,
  TopLevelInstruction,
  Transfer,
  TxModel,
} from "@/lib/tx/model";

type RawInstruction = (ParsedInstruction | PartiallyDecodedInstruction) & { stackHeight?: number | null };
type TokenAccountInfo = { mint: string; owner: string | null; decimals: number };

/** The RPC doesn't parse Compute Budget instructions, so decode the few that exist. */
function decodeComputeBudget(data: string): { type: string; info: Record<string, unknown> } | null {
  const bytes = base58Decode(data);
  if (!bytes || bytes.length === 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = () => (bytes.length >= 5 ? view.getUint32(1, true) : null);
  switch (bytes[0]) {
    case 1: {
      const n = u32();
      return n === null ? null : { type: "requestHeapFrame", info: { bytes: n } };
    }
    case 2: {
      const n = u32();
      return n === null ? null : { type: "setComputeUnitLimit", info: { units: n } };
    }
    case 3:
      return bytes.length >= 9
        ? { type: "setComputeUnitPrice", info: { microLamports: view.getBigUint64(1, true).toString() } }
        : null;
    case 4: {
      const n = u32();
      return n === null ? null : { type: "setLoadedAccountsDataSizeLimit", info: { bytes: n } };
    }
    default:
      return null;
  }
}

function toInstruction(ix: RawInstruction, index: number, innerIndex: number | null): Instruction {
  const programId = ix.programId.toBase58();
  const { name, known } = programLabel(programId);
  const common = {
    index,
    innerIndex,
    stackHeight: typeof ix.stackHeight === "number" ? ix.stackHeight : null,
    programId,
    programName: name,
    programKnown: known,
  };

  if ("parsed" in ix) {
    const parsed: unknown = ix.parsed;
    // The Memo program's parsed output is the memo string itself.
    if (typeof parsed === "string") {
      return { ...common, type: "memo", typeSource: "parsed", info: { memo: parsed }, accounts: [] };
    }
    const obj = (parsed ?? {}) as { type?: unknown; info?: unknown };
    const type = typeof obj.type === "string" ? obj.type : null;
    return {
      ...common,
      type,
      typeSource: type ? "parsed" : null,
      info: obj.info && typeof obj.info === "object" ? (obj.info as Record<string, unknown>) : null,
      accounts: [],
    };
  }

  const decoded = programId === COMPUTE_BUDGET_PROGRAM_ID ? decodeComputeBudget(ix.data) : null;
  return {
    ...common,
    type: decoded?.type ?? null,
    typeSource: decoded ? "decoded" : null,
    info: decoded?.info ?? null,
    accounts: ix.accounts.map((a) => a.toBase58()),
  };
}

const INVOKE_LINE = /^Program (\w+) invoke \[\d+\]$/;
const EXIT_LINE = /^Program (\w+) (success|failed)/;
const NAME_LINE = /^Program log: Instruction: (\w+)$/;

/**
 * Anchor programs log "Instruction: <Name>" when they start. Invocations appear in the logs in
 * execution order, so each one can be matched to an instruction. Stops at the first mismatch
 * (e.g. truncated logs) rather than guessing.
 */
function applyLogNames(executionOrder: Instruction[], logs: string[]) {
  const stack: Instruction[] = [];
  let next = 0;
  for (const line of logs) {
    const invoke = INVOKE_LINE.exec(line);
    if (invoke) {
      const ix = executionOrder[next++];
      if (!ix || ix.programId !== invoke[1]) return;
      stack.push(ix);
      continue;
    }
    if (EXIT_LINE.test(line)) {
      stack.pop();
      continue;
    }
    const name = NAME_LINE.exec(line);
    const current = stack[stack.length - 1];
    if (name && current && current.type === null) {
      current.type = name[1];
      current.typeSource = "log";
    }
  }
}

/** For each instruction, the instruction that invoked it (null for top-level ones). */
function invokers(executionOrder: Instruction[]): Map<Instruction, Instruction | null> {
  const result = new Map<Instruction, Instruction | null>();
  const latestAtDepth: Instruction[] = [];
  let topLevel: Instruction | null = null;
  for (const ix of executionOrder) {
    if (ix.innerIndex === null) {
      topLevel = ix;
      latestAtDepth.length = 0;
      latestAtDepth[1] = ix;
      result.set(ix, null);
      continue;
    }
    const depth = ix.stackHeight ?? 2;
    result.set(ix, latestAtDepth[depth - 1] ?? topLevel);
    latestAtDepth[depth] = ix;
    latestAtDepth.length = depth + 1;
  }
  return result;
}

/**
 * Token account → mint/owner/decimals. Mostly from the balance snapshots (present even for failed
 * transactions), plus accounts initialized inside the transaction, which are missing from the
 * snapshots when they're closed again or the transaction fails.
 */
function tokenAccountMap(
  addresses: string[],
  balances: TokenBalance[],
  instructions: Instruction[],
): Map<string, TokenAccountInfo> {
  const map = new Map<string, TokenAccountInfo>();
  const mintDecimals = new Map<string, number>();
  for (const b of balances) {
    mintDecimals.set(b.mint, b.uiTokenAmount.decimals);
    const address = addresses[b.accountIndex];
    if (!address || map.has(address)) continue;
    map.set(address, { mint: b.mint, owner: b.owner ?? null, decimals: b.uiTokenAmount.decimals });
  }

  for (const ix of instructions) {
    if (!ix.info || !ix.type?.startsWith("initializeAccount") || !isTokenProgram(ix.programId)) continue;
    const { account, mint, owner } = ix.info;
    if (typeof account !== "string" || typeof mint !== "string" || map.has(account)) continue;
    const decimals = mintDecimals.get(mint);
    if (decimals === undefined) continue;
    map.set(account, { mint, owner: typeof owner === "string" ? owner : null, decimals });
  }
  return map;
}

function toTransfer(
  ix: Instruction,
  via: Instruction | null,
  tokenAccounts: Map<string, TokenAccountInfo>,
  feePayer: string,
  reverted: boolean,
): Transfer | null {
  const info = ix.info;
  if (!info) return null;
  const str = (key: string) => (typeof info[key] === "string" ? (info[key] as string) : null);
  const from = str("source");
  const to = str("destination");
  if (!from || !to) return null;
  const base = {
    index: ix.index,
    innerIndex: ix.innerIndex,
    from,
    to,
    viaProgramId: via?.programId ?? null,
    viaProgramName: via?.programName ?? null,
    reverted,
  };

  if (ix.programId === SYSTEM_PROGRAM_ID && ix.type === "transfer") {
    const lamports = info.lamports;
    if (typeof lamports !== "number" && typeof lamports !== "string") return null;
    const raw = BigInt(lamports);
    return {
      ...base,
      kind: "sol",
      fromOwner: from,
      toOwner: to,
      mint: null,
      symbol: "SOL",
      symbolKnown: true,
      decimals: SOL_DECIMALS,
      amount: lamportsToSol(raw),
      rawAmount: raw.toString(),
      involvesFeePayer: from === feePayer || to === feePayer,
    };
  }

  if (isTokenProgram(ix.programId) && (ix.type === "transfer" || ix.type === "transferChecked")) {
    const checked = info.tokenAmount as { amount?: unknown; decimals?: unknown } | undefined;
    const rawStr = ix.type === "transferChecked" ? checked?.amount : info.amount;
    if (typeof rawStr !== "string") return null;
    const src = tokenAccounts.get(from);
    const dst = tokenAccounts.get(to);
    const mint = str("mint") ?? src?.mint ?? dst?.mint ?? null;
    const decimals =
      typeof checked?.decimals === "number" ? checked.decimals : (src?.decimals ?? dst?.decimals ?? null);
    const token = mint ? tokenLabel(mint) : null;
    const raw = BigInt(rawStr);
    const fromOwner = src?.owner ?? null;
    const toOwner = dst?.owner ?? null;
    return {
      ...base,
      kind: "token",
      fromOwner,
      toOwner,
      mint,
      symbol: token?.symbol ?? "unknown token",
      symbolKnown: token?.known ?? false,
      decimals,
      amount: decimals === null ? raw.toString() : formatUnits(raw, decimals),
      rawAmount: raw.toString(),
      involvesFeePayer: fromOwner === feePayer || toOwner === feePayer,
    };
  }

  return null;
}

function computeSolChanges(
  addresses: string[],
  feePayer: string,
  pre: number[],
  post: number[],
): SolChange[] {
  const changes: SolChange[] = [];
  addresses.forEach((address, i) => {
    const before = BigInt(pre[i] ?? 0);
    const after = BigInt(post[i] ?? 0);
    if (before === after) return;
    changes.push({
      address,
      isFeePayer: address === feePayer,
      pre: lamportsToSol(before),
      post: lamportsToSol(after),
      delta: lamportsToSol(after - before),
    });
  });
  return changes;
}

function computeTokenChanges(
  addresses: string[],
  feePayer: string,
  pre: TokenBalance[],
  post: TokenBalance[],
): TokenChange[] {
  // Key by token account + mint. A missing pre entry means the account was created
  // in this transaction; a missing post entry means it was closed. Both count as zero.
  type Entry = { accountIndex: number; mint: string; owner: string | null; decimals: number; pre: bigint; post: bigint };
  const entries = new Map<string, Entry>();
  const upsert = (b: TokenBalance, side: "pre" | "post") => {
    const key = `${b.accountIndex}:${b.mint}`;
    const entry = entries.get(key) ?? {
      accountIndex: b.accountIndex,
      mint: b.mint,
      owner: b.owner ?? null,
      decimals: b.uiTokenAmount.decimals,
      pre: 0n,
      post: 0n,
    };
    entry[side] = BigInt(b.uiTokenAmount.amount);
    entry.owner ??= b.owner ?? null;
    entries.set(key, entry);
  };
  pre.forEach((b) => upsert(b, "pre"));
  post.forEach((b) => upsert(b, "post"));

  const changes: TokenChange[] = [];
  for (const e of entries.values()) {
    if (e.pre === e.post) continue;
    const token = tokenLabel(e.mint);
    changes.push({
      tokenAccount: addresses[e.accountIndex] ?? `account #${e.accountIndex}`,
      owner: e.owner,
      ownedByFeePayer: e.owner === feePayer,
      mint: e.mint,
      symbol: token.symbol,
      tokenName: token.name,
      symbolKnown: token.known,
      decimals: e.decimals,
      pre: formatUnits(e.pre, e.decimals),
      post: formatUnits(e.post, e.decimals),
      delta: formatUnits(e.post - e.pre, e.decimals),
    });
  }
  return changes;
}

export function normalizeTransaction(signature: string, tx: ParsedTransactionWithMeta): TxModel {
  const meta = tx.meta;
  if (!meta) throw new Error("The RPC returned this transaction without metadata.");

  const message = tx.transaction.message;
  // For v0 transactions this list already includes addresses loaded from lookup tables,
  // in the same order the balance arrays use.
  const accounts = message.accountKeys.map((k, i) => ({
    address: k.pubkey.toBase58(),
    signer: k.signer,
    writable: k.writable,
    isFeePayer: i === 0,
  }));
  const addresses = accounts.map((a) => a.address);
  const feePayer = addresses[0];

  const innerByParent = new Map<number, Instruction[]>();
  for (const group of meta.innerInstructions ?? []) {
    innerByParent.set(
      group.index,
      group.instructions.map((ix, j) => toInstruction(ix as RawInstruction, group.index, j)),
    );
  }

  const instructions: TopLevelInstruction[] = message.instructions.map((ix, i) => ({
    ...toInstruction(ix as RawInstruction, i, null),
    inner: innerByParent.get(i) ?? [],
  }));

  const logs = meta.logMessages ?? [];
  const success = meta.err === null;
  const preTokenBalances = meta.preTokenBalances ?? [];
  const postTokenBalances = meta.postTokenBalances ?? [];

  const executionOrder = instructions.flatMap((ix) => [ix, ...ix.inner]);
  applyLogNames(executionOrder, logs);
  const invokedBy = invokers(executionOrder);
  const tokenAccounts = tokenAccountMap(addresses, [...postTokenBalances, ...preTokenBalances], executionOrder);
  const transfers = executionOrder
    .map((ix) => toTransfer(ix, invokedBy.get(ix) ?? null, tokenAccounts, feePayer, !success))
    .filter((t): t is Transfer => t !== null);

  return {
    signature,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    blockTimeIso: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    version: tx.version ?? null,
    success,
    feePayer,
    feeLamports: meta.fee,
    feeSol: lamportsToSol(meta.fee),
    computeUnitsConsumed: meta.computeUnitsConsumed ?? null,
    accounts,
    instructions,
    solChanges: computeSolChanges(addresses, feePayer, meta.preBalances, meta.postBalances),
    tokenChanges: computeTokenChanges(addresses, feePayer, preTokenBalances, postTokenBalances),
    transfers,
    logs,
    failure: success
      ? null
      : decodeFailure(meta.err, logs, instructions.map((ix) => ix.programId)),
  };
}
