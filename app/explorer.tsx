"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { shortAddress } from "@/lib/format";
import { explainTransaction } from "@/lib/tx/explain";
import { ApiErrorSchema, type TxModel } from "@/lib/tx/model";
import type { CheckResponse, TxResponse, WalletTx } from "@/lib/api";
import { isValidAddress, isValidSignature } from "@/lib/solana/signature";
import { riskWarnings } from "@/lib/tx/risk";
import { CheckResult } from "./check-result";
import { Explained, Glossary } from "./glossary";
import { Steps, Warnings } from "./steps";
import { TradeCheckCard } from "./trade-check";

// The Remotion player only runs in the browser.
const VideoPlayer = dynamic(() => import("./video-player"), {
  ssr: false,
  loading: () => <div className="aspect-video animate-pulse rounded-2xl bg-surface" />,
});

type State =
  | { status: "idle" }
  | { status: "fetching"; label: string }
  | { status: "error"; message: string; attempt: number }
  | { status: "picking"; address: string; transactions: WalletTx[] }
  | { status: "done"; data: TxResponse }
  | { status: "checked"; data: CheckResponse };

/** Anything much longer than a signature (88 characters at most) is a whole transaction to check. */
const looksLikeTransaction = (input: string) => input.length > 100 && !isValidSignature(input);

/** Shareable path for an explained transaction or wallet. */
function sharePath(input: string, isWallet: boolean): string {
  return `/${isWallet ? "address" : "tx"}/${encodeURIComponent(input)}`;
}

/**
 * The whole app: input, loading states, wallet picker and result. Rendered at "/" and, for share
 * links, at /tx/<signature> and /address/<wallet> with `initialInput` so it loads straight away.
 */
export default function Explorer({ initialInput }: { initialInput?: string }) {
  const [signature, setSignature] = useState(initialInput ?? "");
  const [state, setState] = useState<State>({ status: "idle" });

  const started = useRef(false);
  useEffect(() => {
    if (!initialInput || started.current) return;
    started.current = true;
    explain(initialInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialInput]);

  async function explain(input: string) {
    if (!input) return;
    if (looksLikeTransaction(input)) return check(input);
    const isWallet = isValidAddress(input);
    setState({ status: "fetching", label: isWallet ? "Loading this wallet's latest transactions" : "Fetching transaction" });
    const fail = (message: string) =>
      setState((s) => ({ status: "error", message, attempt: s.status === "error" ? s.attempt + 1 : 0 }));
    try {
      const res = await fetch(
        isWallet ? `/api/recent?address=${encodeURIComponent(input)}` : `/api/tx?sig=${encodeURIComponent(input)}`,
      );
      const body: unknown = await res.json();
      if (!res.ok) {
        const parsed = ApiErrorSchema.safeParse(body);
        return fail(parsed.success ? parsed.data.error.message : `Request failed (${res.status}).`);
      }
      if (isWallet) {
        const { transactions } = body as { transactions: WalletTx[] };
        if (transactions.length === 0) return fail("This wallet has no transactions yet.");
        setState({ status: "picking", address: input, transactions });
      } else {
        setState({ status: "done", data: body as TxResponse });
      }
      // Keep the address bar shareable: it always points at what's on screen.
      window.history.replaceState(null, "", sharePath(input, isWallet));
    } catch {
      fail("Couldn't reach the server. Check your connection and try again.");
    }
  }

  /** Dry-runs an unsigned transaction. Not shareable: it only exists in this browser. */
  async function check(input: string) {
    setState({ status: "fetching", label: "Doing a dry run of this transaction (nothing gets sent)" });
    const fail = (message: string) =>
      setState((s) => ({ status: "error", message, attempt: s.status === "error" ? s.attempt + 1 : 0 }));
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transaction: input }),
      });
      const body: unknown = await res.json();
      if (!res.ok) {
        const parsed = ApiErrorSchema.safeParse(body);
        return fail(parsed.success ? parsed.data.error.message : `Request failed (${res.status}).`);
      }
      setState({ status: "checked", data: body as CheckResponse });
      window.history.replaceState(null, "", "/");
    } catch {
      fail("Couldn't reach the server. Check your connection and try again.");
    }
  }

  /** Loads an example unsigned transaction and checks it. */
  async function tryExample(kind: "swap" | "drainer") {
    setState({ status: "fetching", label: kind === "swap" ? "Building an example swap" : "Building an example scam" });
    try {
      const res = await fetch(`/api/check/example?kind=${kind}`);
      const body = (await res.json()) as { transaction?: string };
      if (!res.ok || !body.transaction) {
        const parsed = ApiErrorSchema.safeParse(body);
        throw new Error(parsed.success ? parsed.data.error.message : "Couldn't build the example.");
      }
      setSignature(body.transaction);
      await check(body.transaction);
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't build the example.", attempt: 0 });
    }
  }

  function pick(sig: string) {
    setSignature(sig);
    explain(sig);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    explain(signature.trim());
  }

  async function pasteAndGo() {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      setSignature(text);
      explain(text);
    } catch {
      // Clipboard permission denied: the user can still paste manually.
    }
  }

  const busy = state.status === "fetching";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6">
      <nav className="flex items-center py-8 font-mono text-sm">
        {/* A full page load, not a client link: the address bar was rewritten with replaceState,
            so a fresh load is the simplest way to clear the result and start over. */}
        <a href="/" aria-label="Docent home" className="transition-colors hover:text-accent">
          docent<span className="blink text-accent">_</span>
        </a>
      </nav>

      <section
        className={`flex flex-1 flex-col justify-center gap-10 transition-[padding] duration-500 ${
          state.status === "done" ? "pb-8" : "pb-32"
        }`}
      >
        <div className="flex flex-col gap-5">
          <h1 className="rise text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            What happened in <br />
            this <span className="text-accent">transaction</span>?
          </h1>
          <p className="rise max-w-xl text-lg leading-relaxed text-muted" style={{ animationDelay: "40ms" }}>
            Every payment and trade on Solana is public, but written in code. Paste one in and Docent tells you
            what happened, in plain English.
          </p>
        </div>

        <form onSubmit={onSubmit} className="rise flex flex-col gap-3" style={{ animationDelay: "80ms" }}>
          <div
            key={state.status === "error" ? state.attempt : "input"}
            className={`group flex items-center gap-3 border-b-2 pb-3 transition-colors ${
              state.status === "error" ? "shake border-failure" : "border-border focus-within:border-accent"
            }`}
          >
            <input
              value={signature}
              onChange={(e) => setSignature(e.target.value)}
              placeholder="Paste a transaction signature or wallet address"
              aria-label="Transaction signature, wallet address, or unsigned transaction"
              spellCheck={false}
              autoFocus
              disabled={busy}
              className="min-w-0 flex-1 bg-transparent font-mono text-lg text-fg outline-none placeholder:font-sans placeholder:text-muted/60 disabled:opacity-50 sm:text-xl"
            />
            {signature.trim() ? (
              <button
                type="submit"
                disabled={busy}
                aria-label="Explain transaction"
                className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-xl text-white transition-transform hover:scale-110 active:scale-95 disabled:opacity-40"
              >
                →
              </button>
            ) : (
              <button
                type="button"
                onClick={pasteAndGo}
                className="shrink-0 rounded-full border border-border px-4 py-2 text-sm text-muted transition-colors hover:border-accent hover:text-fg"
              >
                paste
              </button>
            )}
          </div>

          <div className="min-h-6 text-sm">
            {state.status === "fetching" && <Loading label={state.label} />}
            {state.status === "error" && <p className="text-failure">{state.message}</p>}
            {state.status === "idle" && (
              <p className="text-muted/60">
                A signature is a transaction&apos;s ID. Find one in your wallet&apos;s activity or on{" "}
                <a
                  href="https://explorer.solana.com"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4 hover:text-fg"
                >
                  explorer.solana.com
                </a>
                .
              </p>
            )}
          </div>
        </form>

        {state.status === "idle" && (
          <div className="rise flex flex-col gap-2 rounded-2xl border border-border p-5 text-sm" style={{ animationDelay: "120ms" }}>
            <p className="font-medium">New: check a transaction before you sign it</p>
            <p className="leading-relaxed text-muted">
              When an app asks your wallet to sign something, paste that transaction here first. Docent does a dry run
              and tells you what it would do, and warns you if it looks like a scam.
            </p>
            <p className="flex flex-wrap gap-x-5 gap-y-1">
              <button onClick={() => tryExample("swap")} className="text-accent transition-opacity hover:opacity-70">
                try a normal swap →
              </button>
              <button onClick={() => tryExample("drainer")} className="text-failure transition-opacity hover:opacity-70">
                try a scam →
              </button>
            </p>
          </div>
        )}

        {state.status === "picking" && (
          <Picker address={state.address} transactions={state.transactions} onPick={pick} />
        )}
        {state.status === "done" && <Result key={state.data.tx.signature} data={state.data} />}
        {state.status === "checked" && <CheckResult key={state.data.slot} data={state.data} />}
      </section>
    </main>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-3 text-muted">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="hop size-1.5 rounded-full bg-accent" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </span>
      {label}
    </p>
  );
}

function Result({ data }: { data: TxResponse }) {
  const model: TxModel = data.tx;
  const [panel, setPanel] = useState<"words" | "raw" | null>(null);
  const toggle = (p: "words" | "raw") => setPanel((cur) => (cur === p ? null : p));
  const story = explainTransaction(model);
  // Only the serious ones (handing over control) for a transaction that already happened.
  const warnings = riskWarnings(model, { preview: false });
  const innerCount = model.instructions.reduce((n, ix) => n + ix.inner.length, 0);
  const stats: [string, string][] = [
    ["steps", `${model.instructions.length}${innerCount ? ` + ${innerCount} inner` : ""}`],
    [model.success ? "token movements" : "movements undone", String(model.transfers.length)],
    ["network fee", `${model.feeSol} SOL`],
    ["slot", model.slot.toLocaleString("en-US")],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="rise flex flex-wrap items-center gap-3 font-mono text-sm">
        <span
          className={`rounded-full px-3 py-1 ${
            model.success ? "bg-success/15 text-success" : "bg-failure/15 text-failure"
          }`}
        >
          {model.success ? "success" : "failed"}
        </span>
        <span className="text-muted">{shortAddress(model.signature)}</span>
        {model.blockTimeIso && (
          <span className="text-muted/60">{new Date(model.blockTimeIso).toLocaleString()}</span>
        )}
      </div>

      <div className="rise">
        <VideoPlayer data={data} />
      </div>

      <h2 className="rise text-2xl font-semibold leading-snug tracking-tight sm:text-3xl" style={{ animationDelay: "60ms" }}>
        {story.headline}
      </h2>

      <Warnings warnings={warnings} />

      <Steps steps={story.steps} />

      <p
        className={`rise rounded-2xl px-5 py-4 leading-relaxed ${
          model.success ? "bg-success/10 text-success" : "bg-failure/10 text-failure"
        }`}
        style={{ animationDelay: `${120 + story.steps.length * 60}ms` }}
      >
        <Explained text={story.outcome} />
      </p>

      <TradeCheckCard signature={model.signature} />

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        {stats.map(([label, value], i) => (
          <div key={label} className="rise bg-bg p-5" style={{ animationDelay: `${200 + story.steps.length * 60 + i * 60}ms` }}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="mt-2 font-mono text-lg">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-6 text-sm">
        <CopyLink path={sharePath(model.signature, false)} />
        <button onClick={() => toggle("words")} className="text-accent transition-opacity hover:opacity-70">
          {panel === "words" ? "hide" : "what do these words mean?"}
        </button>
        <button onClick={() => toggle("raw")} className="text-muted transition-colors hover:text-fg">
          {panel === "raw" ? "hide" : "show"} raw data
        </button>
        <a
          href={`https://explorer.solana.com/tx/${model.signature}`}
          target="_blank"
          rel="noreferrer"
          className="text-muted transition-colors hover:text-fg"
        >
          explorer ↗
        </a>
      </div>

      {panel === "words" && <Glossary />}

      {panel === "raw" && (
        <pre className="rise max-h-[60vh] overflow-auto rounded-2xl border border-border bg-surface p-5 font-mono text-xs leading-relaxed">
          {JSON.stringify(model, null, 2)}
        </pre>
      )}
    </div>
  );
}

function timeAgo(blockTime: number | null): string {
  if (!blockTime) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - blockTime));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const MAX_SHOWN = 10;

function Picker({
  address,
  transactions,
  onPick,
}: {
  address: string;
  transactions: WalletTx[];
  onPick: (signature: string) => void;
}) {
  const [showSpam, setShowSpam] = useState(false);
  const real = transactions.filter((t) => !t.spam).slice(0, MAX_SHOWN);
  const spam = transactions.filter((t) => t.spam);

  return (
    <div className="flex flex-col gap-4">
      <p className="rise text-muted">
        That&apos;s a wallet address (<span className="font-mono text-fg">{shortAddress(address)}</span>), not a
        single transaction. Here are its latest ones. Pick one to explain.
      </p>
      {real.length > 0 ? (
        <TxList transactions={real} onPick={onPick} />
      ) : (
        <p className="rise text-sm text-muted">No recent activity besides spam.</p>
      )}
      {spam.length > 0 && (
        <div className="flex flex-col gap-3">
          <button
            onClick={() => setShowSpam((v) => !v)}
            className="self-start text-sm text-muted transition-colors hover:text-fg"
          >
            {showSpam ? "Hide" : "Show"} {spam.length} likely spam {spam.length === 1 ? "transaction" : "transactions"}
          </button>
          {showSpam && <TxList transactions={spam} onPick={onPick} dim />}
        </div>
      )}
    </div>
  );
}

function TxList({
  transactions,
  onPick,
  dim = false,
}: {
  transactions: WalletTx[];
  onPick: (signature: string) => void;
  dim?: boolean;
}) {
  return (
    <ul className={`flex flex-col overflow-hidden rounded-2xl border border-border ${dim ? "opacity-70" : ""}`}>
      {transactions.map((t, i) => (
        <li key={t.signature} className="rise border-b border-border last:border-b-0" style={{ animationDelay: `${i * 40}ms` }}>
          <button
            onClick={() => onPick(t.signature)}
            className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface"
          >
            <span className={`size-2 shrink-0 rounded-full ${t.success ? "bg-success" : "bg-failure"}`} />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate">{t.summary ?? (t.success ? "Transaction" : "Failed transaction")}</span>
              <span className="truncate text-xs text-muted">
                <span className="font-mono">{shortAddress(t.signature)}</span>
                {t.blockTime ? ` · ${timeAgo(t.blockTime)}` : ""}
                {t.spam ? ` · ${t.spam}` : ""}
              </span>
            </span>
            <span className="text-accent">→</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address bar already shows the same link.
    }
  }
  return (
    <button onClick={copy} className="font-medium text-accent transition-opacity hover:opacity-70">
      {copied ? "link copied ✓" : "copy share link"}
    </button>
  );
}
