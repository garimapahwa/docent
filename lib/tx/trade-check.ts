import "server-only";
import { formatUnits } from "@/lib/format";
import { hasPrice, priceAt } from "@/lib/prices";
import { displayAmount, mainAndSideCost } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";

export type TradeSide = { symbol: string; amount: string; usd: number; price: number };

export type TradeCheck =
  | {
      status: "checked";
      sent: TradeSide;
      got: TradeSide;
      /** Value received vs value sent, in percent: -0.3 means 0.3% less than the market price. */
      diffPct: number;
      verdict: "better" | "fair" | "slightly_worse" | "worse";
      /** ISO time of the minute the prices are from. */
      minute: string;
    }
  | { status: "unpriced"; reason: string }
  | { status: "not_a_swap" };

/** Within this, a trade got the market price (exchange fees are usually 0.01–0.3%). */
const FAIR_PCT = 0.5;
const SLIGHTLY_WORSE_PCT = 2;

/**
 * Compares what a swap paid with what it got, using market prices at that minute.
 * Only for successful swaps of one token for one other token.
 */
export async function checkTrade(tx: TxModel): Promise<TradeCheck> {
  if (!tx.success || tx.blockTime === null) return { status: "not_a_swap" };
  const { main } = mainAndSideCost(tx);
  const sent = main.filter((a) => a.net < 0n);
  const got = main.filter((a) => a.net > 0n);
  if (sent.length !== 1 || got.length !== 1) return { status: "not_a_swap" };
  const [s, g] = [sent[0], got[0]];

  const missing = [s, g].filter((a) => !hasPrice(a.mint)).map((a) => a.symbol);
  if (missing.length > 0) {
    return { status: "unpriced", reason: `There's no reliable market price for ${missing.join(" or ")}.` };
  }

  const [ps, pg] = await Promise.all([priceAt(s.mint, tx.blockTime), priceAt(g.mint, tx.blockTime)]);
  if (ps === null || pg === null) {
    return { status: "unpriced", reason: "Couldn't find market prices for the minute this happened." };
  }

  const side = (a: typeof s, price: number): TradeSide => {
    const amount = formatUnits(a.net < 0n ? -a.net : a.net, a.decimals);
    return { symbol: a.symbol, amount: displayAmount(amount), usd: Number(amount) * price, price };
  };
  const sentSide = side(s, ps);
  const gotSide = side(g, pg);
  const diffPct = (gotSide.usd / sentSide.usd - 1) * 100;
  const verdict =
    diffPct > FAIR_PCT
      ? "better"
      : diffPct >= -FAIR_PCT
        ? "fair"
        : diffPct >= -SLIGHTLY_WORSE_PCT
          ? "slightly_worse"
          : "worse";
  return {
    status: "checked",
    sent: sentSide,
    got: gotSide,
    diffPct,
    verdict,
    minute: new Date(Math.floor(tx.blockTime / 60) * 60_000).toISOString(),
  };
}
