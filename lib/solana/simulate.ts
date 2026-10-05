import "server-only";
import {
  PublicKey,
  VersionedMessage,
  VersionedTransaction,
  type ParsedTransactionWithMeta,
  type TokenBalance,
} from "@solana/web3.js";
import { base58Decode, base58Encode } from "@/lib/solana/base58";
import { SYSTEM_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@/lib/solana/known";
import { TxFetchError, rpcCall } from "@/lib/solana/rpc";
import type { TxModel } from "@/lib/tx/model";
import { normalizeTransaction } from "@/lib/tx/normalize";

const ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
/** Solana's packet limit is 1232 bytes; base64 of that is ~1650 characters. */
const MAX_INPUT_CHARS = 5000;
export const PREVIEW_SIGNATURE = "unsigned-preview";

function invalid(message: string): TxFetchError {
  return new TxFetchError("invalid_transaction", 400, message);
}

function decodeBytes(text: string): Uint8Array[] {
  const candidates: Uint8Array[] = [];
  if (/^[A-Za-z0-9+/]+=*$/.test(text)) candidates.push(new Uint8Array(Buffer.from(text, "base64")));
  const b58 = base58Decode(text);
  if (b58) candidates.push(b58);
  return candidates;
}

/**
 * Reads an unsigned (or signed) transaction pasted as base64 or base58. Also accepts just the
 * message, e.g. from Solana Explorer's inspector link (…/tx/inspector?message=…).
 */
export function decodeTransaction(input: string): VersionedTransaction {
  let text = input.trim();
  if (text.length > MAX_INPUT_CHARS) throw invalid("That's too long to be a single Solana transaction.");
  const fromUrl = /[?&]message=([^&\s]+)/.exec(text);
  if (fromUrl) text = decodeURIComponent(fromUrl[1]);

  for (const bytes of decodeBytes(text)) {
    try {
      return VersionedTransaction.deserialize(bytes);
    } catch {
      // Not a full transaction; try it as a bare message below.
    }
    try {
      return new VersionedTransaction(VersionedMessage.deserialize(bytes));
    } catch {
      // Try the next encoding.
    }
  }
  throw invalid(
    "That doesn't look like a Solana transaction. Paste the transaction as base64 (the long code an app asks your wallet to sign).",
  );
}

const u64 = (d: Uint8Array, at: number) =>
  d.length >= at + 8 ? new DataView(d.buffer, d.byteOffset).getBigUint64(at, true).toString() : null;
const key = (d: Uint8Array, at: number) => (d.length >= at + 32 ? base58Encode(d.slice(at, at + 32)) : null);
const AUTHORITY_TYPES = ["mintTokens", "freezeAccount", "accountOwner", "closeAccount"];

/**
 * Top-level instructions in a simulation come back undecoded, so decode the handful that
 * matter for explaining and safety checks into the same shape the RPC's parser uses.
 */
function parseInstruction(programId: string, accounts: string[], data: Uint8Array): { type: string; info: Record<string, unknown> } | null {
  const a = (i: number) => accounts[i];
  if (programId === SYSTEM_PROGRAM_ID && data.length >= 4) {
    const kind = new DataView(data.buffer, data.byteOffset).getUint32(0, true);
    if (kind === 2) return { type: "transfer", info: { source: a(0), destination: a(1), lamports: u64(data, 4) } };
    if (kind === 1) return { type: "assign", info: { account: a(0), owner: key(data, 4) } };
    if (kind === 0) return { type: "createAccount", info: { source: a(0), newAccount: a(1), lamports: u64(data, 4), owner: key(data, 20) } };
    return null;
  }
  if (programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID) {
    const amount = u64(data, 1);
    const checked = { amount, decimals: data[9] };
    switch (data[0]) {
      case 1:
        return { type: "initializeAccount", info: { account: a(0), mint: a(1), owner: a(2) } };
      case 16:
      case 18:
        return { type: data[0] === 16 ? "initializeAccount2" : "initializeAccount3", info: { account: a(0), mint: a(1), owner: key(data, 1) } };
      case 3:
        return { type: "transfer", info: { source: a(0), destination: a(1), authority: a(2), amount } };
      case 12:
        return { type: "transferChecked", info: { source: a(0), mint: a(1), destination: a(2), authority: a(3), tokenAmount: checked } };
      case 4:
        return { type: "approve", info: { source: a(0), delegate: a(1), owner: a(2), amount } };
      case 13:
        return { type: "approveChecked", info: { source: a(0), mint: a(1), delegate: a(2), owner: a(3), tokenAmount: checked } };
      case 5:
        return { type: "revoke", info: { source: a(0), owner: a(1) } };
      case 6:
        return {
          type: "setAuthority",
          info: { account: a(0), authority: a(1), authorityType: AUTHORITY_TYPES[data[1]] ?? "unknown", newAuthority: data[2] === 1 ? key(data, 3) : null },
        };
      case 9:
        return { type: "closeAccount", info: { account: a(0), destination: a(1), owner: a(2) } };
      case 17:
        return { type: "syncNative", info: { account: a(0) } };
      default:
        return null;
    }
  }
  if (programId === ATA_PROGRAM_ID) {
    const type = data.length === 0 || data[0] === 0 ? "create" : data[0] === 1 ? "createIdempotent" : null;
    return type ? { type, info: { source: a(0), account: a(1), wallet: a(2), mint: a(3) } } : null;
  }
  return null;
}

type RawInner = { programId: string; accounts?: string[]; data?: string; parsed?: unknown; program?: string; stackHeight?: number };
type SimulationValue = {
  err: unknown;
  logs: string[] | null;
  unitsConsumed?: number;
  fee?: number | null;
  preBalances?: number[] | null;
  postBalances?: number[] | null;
  preTokenBalances?: TokenBalance[] | null;
  postTokenBalances?: TokenBalance[] | null;
  innerInstructions?: { index: number; instructions: RawInner[] }[] | null;
  loadedAddresses?: { writable: string[]; readonly: string[] } | null;
};

/** The RPC's JSON uses address strings; the normalizer expects PublicKeys, as web3.js returns them. */
function toInstruction(ix: RawInner) {
  const programId = new PublicKey(ix.programId);
  return ix.parsed !== undefined
    ? { programId, program: ix.program ?? "", parsed: ix.parsed, stackHeight: ix.stackHeight }
    : { programId, accounts: (ix.accounts ?? []).map((k) => new PublicKey(k)), data: ix.data ?? "", stackHeight: ix.stackHeight };
}

/**
 * Dry-runs a transaction against the current state of Solana without sending it, and
 * explains the result with the same model as a real transaction. Nothing is signed or sent.
 */
export async function simulateTransaction(input: string): Promise<{ tx: TxModel; slot: number }> {
  const transaction = decodeTransaction(input);
  const message = transaction.message;
  const wire = Buffer.from(transaction.serialize()).toString("base64");

  const { context, value } = await rpcCall<{ context: { slot: number }; value: SimulationValue }>("simulateTransaction", [
    wire,
    { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, innerInstructions: true, commitment: "confirmed" },
  ]);
  if (!value.preBalances || !value.postBalances) {
    throw new TxFetchError("rpc_error", 502, "The Solana RPC didn't return balances for this simulation. Try again in a moment.");
  }

  // Same order the balance arrays use: the message's own keys, then lookup-table keys.
  const loaded = value.loadedAddresses ?? { writable: [], readonly: [] };
  const keys = [...message.staticAccountKeys.map((k) => k.toBase58()), ...loaded.writable, ...loaded.readonly];
  const staticCount = message.staticAccountKeys.length;
  const accountKeys = keys.map((k, i) => ({
    pubkey: new PublicKey(k),
    signer: i < staticCount && message.isAccountSigner(i),
    writable: i < staticCount ? message.isAccountWritable(i) : i < staticCount + loaded.writable.length,
  }));

  const instructions = message.compiledInstructions.map((ix) => {
    const programId = keys[ix.programIdIndex];
    const accounts = ix.accountKeyIndexes.map((i) => keys[i]);
    const parsed = parseInstruction(programId, accounts, ix.data);
    return parsed
      ? { programId: new PublicKey(programId), program: "", parsed }
      : { programId: new PublicKey(programId), accounts: accounts.map((k) => new PublicKey(k)), data: base58Encode(ix.data) };
  });

  const asTransaction = {
    slot: context.slot,
    blockTime: null,
    version: transaction.version,
    transaction: { signatures: [], message: { accountKeys, instructions, recentBlockhash: message.recentBlockhash } },
    meta: {
      err: value.err ?? null,
      fee: value.fee ?? 0,
      preBalances: value.preBalances,
      postBalances: value.postBalances,
      preTokenBalances: value.preTokenBalances ?? [],
      postTokenBalances: value.postTokenBalances ?? [],
      innerInstructions: (value.innerInstructions ?? []).map((g) => ({ index: g.index, instructions: g.instructions.map(toInstruction) })),
      logMessages: value.logs ?? [],
      computeUnitsConsumed: value.unitsConsumed,
    },
  } as unknown as ParsedTransactionWithMeta;

  return { tx: normalizeTransaction(PREVIEW_SIGNATURE, asTransaction), slot: context.slot };
}
