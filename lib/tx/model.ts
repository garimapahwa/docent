import { z } from "zod";

/**
 * TxModel: the deterministic, normalized view of a transaction.
 * Every later stage (storyboard, video) may only use facts present here.
 * Amounts are exact decimal strings (never floats) so nothing is rounded or invented.
 */

export const InstructionSchema = z.object({
  /** Index of the top-level instruction this belongs to. */
  index: z.number().int().nonnegative(),
  /** Position within the parent's inner instructions; null for top-level instructions. */
  innerIndex: z.number().int().nonnegative().nullable(),
  /** CPI depth reported by the RPC (1 = top level). Null when the node doesn't report it. */
  stackHeight: z.number().int().nullable(),
  programId: z.string(),
  programName: z.string(),
  programKnown: z.boolean(),
  /** Parsed instruction type, e.g. "transfer", "transferChecked". Null if the RPC couldn't parse it. */
  type: z.string().nullable(),
  /** Where `type` came from: the RPC's parser, our own decoder, or the program's "Instruction: X" log. */
  typeSource: z.enum(["parsed", "decoded", "log"]).nullable(),
  /** Parsed instruction fields from the RPC's jsonParsed output. */
  info: z.record(z.string(), z.unknown()).nullable(),
  /** Account addresses, only for instructions the RPC couldn't parse. */
  accounts: z.array(z.string()),
});

export const TopLevelInstructionSchema = InstructionSchema.extend({
  inner: z.array(InstructionSchema),
});

export const AccountSchema = z.object({
  address: z.string(),
  signer: z.boolean(),
  writable: z.boolean(),
  isFeePayer: z.boolean(),
});

export const SolChangeSchema = z.object({
  address: z.string(),
  isFeePayer: z.boolean(),
  /** SOL, exact decimal strings. */
  pre: z.string(),
  post: z.string(),
  delta: z.string(),
});

export const TokenChangeSchema = z.object({
  /** The token account whose balance changed. */
  tokenAccount: z.string(),
  /** Wallet that owns the token account, if the RPC reported it. */
  owner: z.string().nullable(),
  ownedByFeePayer: z.boolean(),
  mint: z.string(),
  symbol: z.string(),
  tokenName: z.string().nullable(),
  symbolKnown: z.boolean(),
  decimals: z.number().int().nonnegative(),
  /** Token units, exact decimal strings. */
  pre: z.string(),
  post: z.string(),
  delta: z.string(),
});

/**
 * A transfer as executed (or attempted) by an instruction, in execution order.
 * Unlike balance changes these exist for failed transactions too; `reverted` marks
 * transfers the chain rolled back because the transaction failed.
 */
export const TransferSchema = z.object({
  index: z.number().int().nonnegative(),
  innerIndex: z.number().int().nonnegative().nullable(),
  kind: z.enum(["sol", "token"]),
  /** Source and destination accounts (token accounts for token transfers). */
  from: z.string(),
  to: z.string(),
  /** The program that invoked this transfer (e.g. the DEX whose pool it came from). Null for top-level transfers. */
  viaProgramId: z.string().nullable(),
  viaProgramName: z.string().nullable(),
  /** Wallets that own the token accounts; for SOL transfers these equal from/to. */
  fromOwner: z.string().nullable(),
  toOwner: z.string().nullable(),
  mint: z.string().nullable(),
  symbol: z.string(),
  symbolKnown: z.boolean(),
  /** Null when the mint's decimals couldn't be determined; `amount` is then the raw integer. */
  decimals: z.number().int().nonnegative().nullable(),
  amount: z.string(),
  rawAmount: z.string(),
  involvesFeePayer: z.boolean(),
  reverted: z.boolean(),
});

export const FailureSchema = z.object({
  /** Top-level instruction that failed; null for transaction-level errors. */
  instructionIndex: z.number().int().nullable(),
  /** Program that actually raised the error (may be a CPI callee, taken from logs). */
  programId: z.string().nullable(),
  programName: z.string().nullable(),
  /** e.g. "InsufficientFunds", "SlippageToleranceExceeded", or "Custom" if unknown. */
  errorName: z.string(),
  code: z.number().int().nullable(),
  codeHex: z.string().nullable(),
  /** True when the error's meaning is defined by the program itself, not by Solana. */
  isProgramSpecific: z.boolean(),
  /** Plain-English explanation. */
  description: z.string(),
  /** The most relevant log line. */
  logLine: z.string().nullable(),
  /** meta.err exactly as returned by the RPC. */
  raw: z.unknown(),
});

/** Every token account the transaction touched, with its mint and owning wallet. */
export const TokenAccountSchema = z.object({
  address: z.string(),
  mint: z.string(),
  owner: z.string().nullable(),
});

export const TxModelSchema = z.object({
  signature: z.string(),
  slot: z.number().int(),
  blockTime: z.number().int().nullable(),
  blockTimeIso: z.string().nullable(),
  version: z.union([z.literal("legacy"), z.number()]).nullable(),
  success: z.boolean(),
  feePayer: z.string(),
  feeLamports: z.number().int(),
  feeSol: z.string(),
  computeUnitsConsumed: z.number().int().nullable(),
  accounts: z.array(AccountSchema),
  instructions: z.array(TopLevelInstructionSchema),
  solChanges: z.array(SolChangeSchema),
  tokenChanges: z.array(TokenChangeSchema),
  transfers: z.array(TransferSchema),
  tokenAccounts: z.array(TokenAccountSchema).default([]),
  logs: z.array(z.string()),
  failure: FailureSchema.nullable(),
});

export type Instruction = z.infer<typeof InstructionSchema>;
export type TopLevelInstruction = z.infer<typeof TopLevelInstructionSchema>;
export type TxAccount = z.infer<typeof AccountSchema>;
export type SolChange = z.infer<typeof SolChangeSchema>;
export type TokenChange = z.infer<typeof TokenChangeSchema>;
export type Transfer = z.infer<typeof TransferSchema>;
export type Failure = z.infer<typeof FailureSchema>;
export type TxModel = z.infer<typeof TxModelSchema>;

export const ApiErrorCodeSchema = z.enum([
  "invalid_signature",
  "not_found",
  "rate_limited",
  "rpc_error",
  "internal_error",
]);

export const ApiErrorSchema = z.object({
  error: z.object({ code: ApiErrorCodeSchema, message: z.string() }),
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
