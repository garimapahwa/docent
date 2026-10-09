"use client";

import { useEffect, useState } from "react";
import type { TradeCheck, TradeSide } from "@/lib/tx/trade-check";
import { Explained } from "./glossary";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1 ? 2 : 6 });

const unitPrice = (s: TradeSide) =>
  `1 ${s.symbol} = ${s.price.toLocaleString("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 6 })}`;

const VERDICTS = {
  better: { title: "Better than the market price", tone: "text-success", icon: "↑" },
  fair: { title: "Fair price", tone: "text-success", icon: "✓" },
  slightly_worse: { title: "A bit below the market price", tone: "text-caution", icon: "~" },
  worse: { title: "Well below the market price", tone: "text-failure", icon: "↓" },
} as const;

function explanation(check: Extract<TradeCheck, { status: "checked" }>): string {
  const pct = Math.abs(check.diffPct).toFixed(check.diffPct === 0 ? 0 : Math.abs(check.diffPct) < 0.1 ? 2 : 1);
  switch (check.verdict) {
    case "better":
      return `That's ${pct}% more than the market price at that minute. Prices move within a minute, so this trade caught a good moment.`;
    case "fair":
      return check.diffPct < 0
        ? `That's ${pct}% less than the market price at that minute, which is normal: exchanges charge a small fee on every swap.`
        : `That's right at the market price for that minute.`;
    case "slightly_worse":
      return `That's ${pct}% less than the market price at that minute. Some is the exchange fee; the rest is usually price impact, when a trade is big compared with the pool it trades against.`;
    case "worse":
      return `That's ${pct}% less than the market price at that minute. Big gaps usually mean a large trade in a small pool, a high slippage setting, or a token that's hard to trade.`;
  }
}

/** "Was this a good trade?": the swap's price compared with the market price at that minute. */
export function TradeCheckCard({ signature }: { signature: string }) {
  const [check, setCheck] = useState<TradeCheck | "loading" | null>("loading");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/trade-check?sig=${encodeURIComponent(signature)}`)
      .then((r) => (r.ok ? (r.json() as Promise<TradeCheck>) : null))
      .catch(() => null)
      .then((c) => !cancelled && setCheck(c));
    return () => {
      cancelled = true;
    };
  }, [signature]);

  if (check === null || (check !== "loading" && check.status === "not_a_swap")) return null;

  return (
    <section className="rise flex flex-col gap-3 rounded-2xl border border-border p-5">
      <h3 className="text-xs uppercase tracking-wide text-muted">Was this a good trade?</h3>
      {check === "loading" ? (
        <p className="text-sm text-muted">Checking the market price at that minute…</p>
      ) : check.status === "unpriced" ? (
        <p className="text-sm text-muted">Can&apos;t tell: {check.reason}</p>
      ) : (
        <>
          <p className={`text-lg font-medium ${VERDICTS[check.verdict].tone}`}>
            {VERDICTS[check.verdict].icon} {VERDICTS[check.verdict].title}
          </p>
          <p className="leading-relaxed">
            Paid {check.sent.amount} {check.sent.symbol} (about {usd(check.sent.usd)}) and got {check.got.amount}{" "}
            {check.got.symbol} (about {usd(check.got.usd)}).
          </p>
          <p className="text-sm leading-relaxed text-muted">
            <Explained text={explanation(check)} />
          </p>
          <p className="text-xs text-muted/70">
            Average prices on Binance during{" "}
            {new Date(check.minute).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}:{" "}
            {unitPrice(check.sent)}, {unitPrice(check.got)}.
          </p>
        </>
      )}
    </section>
  );
}
