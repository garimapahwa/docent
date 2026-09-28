import { shortAddress } from "@/lib/format";

export const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
export const JUPITER_PROGRAM_ID = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const PROGRAM_NAMES: Record<string, string> = {
  [SYSTEM_PROGRAM_ID]: "System Program",
  [TOKEN_PROGRAM_ID]: "Token Program",
  [TOKEN_2022_PROGRAM_ID]: "Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account Program",
  [COMPUTE_BUDGET_PROGRAM_ID]: "Compute Budget",
  MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr: "Memo Program",
  [JUPITER_PROGRAM_ID]: "Jupiter",
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: "Orca Whirlpool",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8": "Raydium AMM",
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK: "Raydium CLMM",
};

const TOKENS: Record<string, { symbol: string; name: string }> = {
  So11111111111111111111111111111111111111112: { symbol: "SOL", name: "Wrapped SOL" },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin" },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether USD" },
};

export function programLabel(programId: string): { name: string; known: boolean } {
  const name = PROGRAM_NAMES[programId];
  return name ? { name, known: true } : { name: shortAddress(programId), known: false };
}

export function tokenLabel(mint: string): { symbol: string; name: string | null; known: boolean } {
  const token = TOKENS[mint];
  return token
    ? { ...token, known: true }
    : { symbol: shortAddress(mint), name: null, known: false };
}

export function isTokenProgram(programId: string): boolean {
  return programId === TOKEN_PROGRAM_ID || programId === TOKEN_2022_PROGRAM_ID;
}
