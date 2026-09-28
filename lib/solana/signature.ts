import { base58Decode } from "@/lib/solana/base58";

/** A transaction signature is 64 bytes, base58 encoded (usually 87 or 88 characters). */
export function isValidSignature(input: string): boolean {
  if (input.length < 64 || input.length > 88) return false;
  return base58Decode(input)?.length === 64;
}

/** A wallet, token or program address is 32 bytes, base58 encoded (32–44 characters). */
export function isValidAddress(input: string): boolean {
  if (input.length < 32 || input.length > 44) return false;
  return base58Decode(input)?.length === 32;
}
