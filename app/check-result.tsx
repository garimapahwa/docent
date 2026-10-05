"use client";

import { formatUnits, shortAddress } from "@/lib/format";
import type { CheckResponse } from "@/lib/api";
import { displayAmount, explainTransaction, walletNet } from "@/lib/tx/explain";
import { Explained } from "./glossary";
import { Steps, Warnings } from "./steps";

/** What an unsigned transaction would do if signed now: warnings first, then balances and steps. */
export function CheckResult({ data }: { data: CheckResponse }) {
  const { tx, warnings, slot } = data;
  const story = explainTransaction(tx);
  const changes = tx.success ? walletNet(tx) : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="rise flex flex-wrap items-center gap-3 font-mono text-sm">
        <span className="rounded-full bg-accent/15 px-3 py-1 text-accent">preview · not sent</span>
        <span className="text-muted">signer {shortAddress(tx.feePayer)}</span>
        <span className="text-muted/60">dry run at slot {slot.toLocaleString("en-US")}</span>
      </div>

      <Warnings warnings={warnings} />

      <div className="rise flex flex-col gap-2" style={{ animationDelay: "60ms" }}>
        <p className="text-sm text-muted">If you sign this, here&apos;s what happens:</p>
        <h2 className="text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
          {tx.success ? story.headline : `It would fail. ${story.headline}`}
        </h2>
      </div>

      {tx.success && (
        <dl className="rise grid gap-px overflow-hidden rounded-2xl border border-border bg-border" style={{ animationDelay: "90ms" }}>
          {changes.map((a) => {
            const abs = a.net < 0n ? -a.net : a.net;
            return (
              <div key={a.mint ?? "SOL"} className="flex items-center justify-between bg-bg px-5 py-3">
                <dt className="text-sm text-muted">{a.net < 0n ? "You'd send" : "You'd get"}</dt>
                <dd className={`font-mono ${a.net < 0n ? "text-failure" : "text-success"}`}>
                  {a.net < 0n ? "−" : "+"}
                  {displayAmount(formatUnits(abs, a.decimals))} {a.symbol}
                </dd>
              </div>
            );
          })}
          <div className="flex items-center justify-between bg-bg px-5 py-3">
            <dt className="text-sm text-muted">
              <Explained text="Network fee" />
            </dt>
            <dd className="font-mono text-muted">{tx.feeSol} SOL</dd>
          </div>
        </dl>
      )}

      <Steps steps={story.steps} />

      <p className="rise rounded-2xl bg-surface px-5 py-4 text-sm leading-relaxed text-muted">
        <Explained text="This is a simulation against Solana as it is right now. Nothing was signed or sent, and Docent never sees your keys. Prices and balances can still change before you sign." />
      </p>
    </div>
  );
}
