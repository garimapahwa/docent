import type { Failure } from "@/lib/tx/model";
import { JUPITER_PROGRAM_ID, SYSTEM_PROGRAM_ID, isTokenProgram, programLabel } from "@/lib/solana/known";

type ErrorEntry = { name: string; description: string };

/** solana_program::system_instruction::SystemError */
const SYSTEM_ERRORS: Record<number, ErrorEntry> = {
  0: { name: "AccountAlreadyInUse", description: "The account being created already exists." },
  1: { name: "ResultWithNegativeLamports", description: "Insufficient funds: the account doesn't have enough SOL for this transfer." },
  2: { name: "InvalidProgramId", description: "The program ID given for the new account isn't valid." },
  3: { name: "InvalidAccountDataLength", description: "The requested account size isn't valid." },
  4: { name: "MaxSeedLengthExceeded", description: "An address seed is longer than allowed." },
  5: { name: "AddressWithSeedMismatch", description: "The address doesn't match the one derived from the seed." },
  6: { name: "NonceNoRecentBlockhashes", description: "No recent blockhashes were available for the durable nonce." },
  7: { name: "NonceBlockhashNotExpired", description: "The durable nonce's stored blockhash hasn't expired yet." },
  8: { name: "NonceUnexpectedBlockhashValue", description: "The durable nonce's blockhash didn't match the expected value." },
};

/** spl_token::error::TokenError (Token-2022 shares these codes) */
const TOKEN_ERRORS: Record<number, ErrorEntry> = {
  0: { name: "NotRentExempt", description: "The account doesn't hold enough SOL to be rent-exempt." },
  1: { name: "InsufficientFunds", description: "Insufficient funds: the token account doesn't hold enough tokens." },
  2: { name: "InvalidMint", description: "The mint account isn't valid." },
  3: { name: "MintMismatch", description: "The token account belongs to a different mint than expected." },
  4: { name: "OwnerMismatch", description: "The signer isn't the owner of this token account." },
  5: { name: "FixedSupply", description: "This token has a fixed supply; no more can be minted." },
  6: { name: "AlreadyInUse", description: "The account is already initialized." },
  7: { name: "InvalidNumberOfProvidedSigners", description: "The wrong number of multisig signers was provided." },
  8: { name: "InvalidNumberOfRequiredSigners", description: "The multisig's required signer count isn't valid." },
  9: { name: "UninitializedState", description: "The token account hasn't been initialized." },
  10: { name: "NativeNotSupported", description: "This instruction doesn't support wrapped SOL accounts." },
  11: { name: "NonNativeHasBalance", description: "Non-native token accounts must have a zero balance to be closed." },
  12: { name: "InvalidInstruction", description: "The instruction data isn't valid." },
  13: { name: "InvalidState", description: "The account is in an invalid state for this instruction." },
  14: { name: "Overflow", description: "An arithmetic overflow happened." },
  15: { name: "AuthorityTypeNotSupported", description: "This account doesn't support that authority type." },
  16: { name: "MintCannotFreeze", description: "This mint has no freeze authority." },
  17: { name: "AccountFrozen", description: "The token account is frozen." },
  18: { name: "MintDecimalsMismatch", description: "The decimals given don't match the mint's decimals." },
  19: { name: "NonNativeNotSupported", description: "This instruction only supports wrapped SOL accounts." },
};

/**
 * Custom errors of specific programs, for programs that don't log their error name.
 * Only add entries verified against the program's published IDL.
 */
const PROGRAM_ERRORS: Record<string, Record<number, ErrorEntry>> = {
  [JUPITER_PROGRAM_ID]: {
    6001: {
      name: "SlippageToleranceExceeded",
      description: "Slippage tolerance exceeded: the swap would have returned less than the minimum amount allowed, so it was cancelled.",
    },
  },
};

/** Common built-in InstructionError / TransactionError variants. */
const BUILTIN_ERRORS: Record<string, string> = {
  InsufficientFunds: "An account didn't have enough funds for this instruction.",
  InsufficientFundsForFee: "The fee payer didn't have enough SOL to pay the transaction fee.",
  InsufficientFundsForRent: "An account would be left with less SOL than it needs to stay rent-exempt.",
  BlockhashNotFound: "The transaction's recent blockhash had expired or was unknown.",
  AccountNotFound: "An account the transaction needed doesn't exist.",
  InvalidAccountData: "An account's data wasn't what the program expected.",
  InvalidArgument: "The program received an invalid argument.",
  InvalidInstructionData: "The instruction data wasn't valid for this program.",
  MissingRequiredSignature: "A required signature was missing.",
  AccountAlreadyInitialized: "The account was already initialized.",
  UninitializedAccount: "The account hadn't been initialized.",
  IncorrectProgramId: "An account was owned by a different program than expected.",
  NotEnoughAccountKeys: "The instruction was given too few accounts.",
  ComputationalBudgetExceeded: "The transaction ran out of compute units.",
  ProgramFailedToComplete: "The program failed to complete, often because it ran out of compute units.",
  AccountBorrowFailed: "An account was already in use by another part of the program.",
  InvalidSeeds: "The seeds given didn't produce a valid program address.",
  IllegalOwner: "An account had an unexpected owner.",
};

const FAILED_LINE = /^Program (\w+) failed: (.*)$/;
const ANCHOR_LINE = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;

/** Splits "InsufficientFundsForFee" into "Insufficient funds for fee". */
function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1) + ".";
}

/** The most useful log line for a failure: an Anchor error, then any "Error" line, then the last "failed" line. */
export function pickFailureLogLine(logs: string[]): string | null {
  const anchor = logs.find((l) => l.includes("AnchorError"));
  if (anchor) return anchor;
  const error = logs.find((l) => l.includes("Error") && !FAILED_LINE.test(l));
  if (error) return error;
  const failed = [...logs].reverse().find((l) => l.includes("failed"));
  return failed ?? null;
}

/** The program that actually failed: the innermost "Program X failed" line in the logs. */
function failingProgramFromLogs(logs: string[]): string | null {
  for (const line of logs) {
    const match = FAILED_LINE.exec(line);
    if (match) return match[1];
  }
  return null;
}

export function decodeFailure(
  err: unknown,
  logs: string[],
  topLevelProgramIds: string[],
): Failure {
  let instructionIndex: number | null = null;
  let detail: unknown = err;

  if (err && typeof err === "object" && "InstructionError" in err) {
    const [index, inner] = (err as { InstructionError: [number, unknown] }).InstructionError;
    instructionIndex = index;
    detail = inner;
  }

  const programId =
    failingProgramFromLogs(logs) ??
    (instructionIndex !== null ? topLevelProgramIds[instructionIndex] ?? null : null);
  const programName = programId ? programLabel(programId).name : null;
  const logLine = pickFailureLogLine(logs);

  const base = { instructionIndex, programId, programName, logLine, raw: err };

  // Custom program error: meaning depends on which program raised it.
  if (detail && typeof detail === "object" && "Custom" in detail) {
    const code = Number((detail as { Custom: number }).Custom);
    const codeHex = `0x${code.toString(16)}`;

    const table =
      programId === SYSTEM_PROGRAM_ID ? SYSTEM_ERRORS : programId && isTokenProgram(programId) ? TOKEN_ERRORS : null;
    const known = table?.[code];
    if (known) {
      return { ...base, errorName: known.name, code, codeHex, isProgramSpecific: false, description: known.description };
    }

    // Anchor programs log their error name and message; use them when the number matches.
    const anchorMatch = logs.map((l) => ANCHOR_LINE.exec(l)).find((m) => m && Number(m[2]) === code);
    if (anchorMatch) {
      return {
        ...base,
        errorName: anchorMatch[1],
        code,
        codeHex,
        isProgramSpecific: true,
        description: `${anchorMatch[3]}. This error is defined by ${programName ?? "the program"}.`,
      };
    }

    const programKnown = programId ? PROGRAM_ERRORS[programId]?.[code] : undefined;
    if (programKnown) {
      return {
        ...base,
        errorName: programKnown.name,
        code,
        codeHex,
        isProgramSpecific: true,
        description: `${programKnown.description} This error is defined by ${programName ?? "the program"}.`,
      };
    }

    const description =
      code >= 6000
        ? `Program-specific error ${code} (${codeHex}). Anchor programs number their own errors from 6000, so this is ${programName ?? "the program"}'s error #${code - 6000}.`
        : `Program-specific error ${code} (${codeHex}). Its meaning is defined by ${programName ?? "the program"}.`;
    return { ...base, errorName: "Custom", code, codeHex, isProgramSpecific: true, description };
  }

  // Built-in errors: either a bare string ("InvalidAccountData") or an object ({ InsufficientFundsForRent: {...} }).
  const errorName =
    typeof detail === "string"
      ? detail
      : detail && typeof detail === "object"
        ? Object.keys(detail)[0] ?? "UnknownError"
        : "UnknownError";

  return {
    ...base,
    errorName,
    code: null,
    codeHex: null,
    isProgramSpecific: false,
    description: BUILTIN_ERRORS[errorName] ?? humanize(errorName),
  };
}
