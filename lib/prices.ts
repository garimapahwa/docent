import "server-only";

/**
 * Historical USD prices from Binance's public market data (no key, not region-blocked).
 * Prices are in USDT, which tracks the US dollar; USDT itself counts as exactly $1.
 * Only tokens with a Binance market are covered; anything else has no price.
 */
const BINANCE_SYMBOLS: Record<string, string> = {
  So11111111111111111111111111111111111111112: "SOLUSDT",
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDCUSDT",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "JUPUSDT",
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: "BONKUSDT",
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: "WIFUSDT",
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: "JTOUSDT",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "PYTHUSDT",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "RAYUSDT",
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: "ORCAUSDT",
  "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN": "TRUMPUSDT",
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": "WUSDT",
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: "RENDERUSDT",
  ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82: "BOMEUSDT",
  "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv": "PENGUUSDT",
};

export const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

export function hasPrice(mint: string | null): boolean {
  return BINANCE_SYMBOLS[mint ?? WRAPPED_SOL_MINT] !== undefined;
}

/**
 * Average USD price during the minute containing `unixSeconds` (volume-weighted), or null if
 * there's no price for that exact minute. A token that wasn't listed yet gets null, never a
 * later price.
 */
export async function priceAt(mint: string | null, unixSeconds: number): Promise<number | null> {
  const symbol = BINANCE_SYMBOLS[mint ?? WRAPPED_SOL_MINT];
  if (!symbol) return null;
  if (symbol === "USDT") return 1;

  const minute = Math.floor(unixSeconds / 60) * 60_000;
  const res = await fetch(
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${minute}&limit=1`,
    { signal: AbortSignal.timeout(5000) },
  );
  if (!res.ok) return null;
  const candles = (await res.json()) as [number, string, string, string, string, string, number, string][];
  const candle = candles[0];
  if (!candle || candle[0] !== minute) return null;
  const [, open, , , close, baseVolume, , quoteVolume] = candle;
  const vwap = Number(quoteVolume) / Number(baseVolume);
  return Number.isFinite(vwap) && vwap > 0 ? vwap : (Number(open) + Number(close)) / 2;
}
