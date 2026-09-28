/** First 4 + "…" + last 4. Used everywhere an address is displayed. */
export function shortAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** Exact decimal string for an integer amount with `decimals` places (no float rounding). */
export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toString();
  if (decimals > 0 && frac > 0n) {
    out += "." + frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  }
  return negative ? `-${out}` : out;
}

export const SOL_DECIMALS = 9;

export function lamportsToSol(lamports: bigint | number): string {
  return formatUnits(BigInt(lamports), SOL_DECIMALS);
}
