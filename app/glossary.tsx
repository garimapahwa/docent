"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TERMS, type Term } from "@/lib/glossary";

export function Glossary() {
  return (
    <dl className="rise grid gap-x-8 gap-y-4 rounded-2xl bg-surface p-6 text-sm sm:grid-cols-2">
      {TERMS.map(({ term, meaning }) => (
        <div key={term}>
          <dt className="font-medium">{term}</dt>
          <dd className="mt-1 leading-relaxed text-muted">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every matchable phrase, longest first so "network fee" wins over "fee". */
const PHRASES: [string, Term][] = TERMS.flatMap((t) => (t.matches ?? []).map((m): [string, Term] => [m.toLowerCase(), t]))
  .sort((a, b) => b[0].length - a[0].length);
const PATTERN = new RegExp(`\\b(${PHRASES.map(([p]) => escape(p)).join("|")})\\b`, "gi");
const BY_PHRASE = new Map(PHRASES);

/**
 * Text with glossary words made tappable. Only the first mention of each term is linked,
 * so a sentence doesn't turn into a wall of underlines.
 */
export function Explained({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const used = new Set<string>();
  let last = 0;
  for (const match of text.matchAll(PATTERN)) {
    const term = BY_PHRASE.get(match[0].toLowerCase());
    if (!term || used.has(term.term)) continue;
    used.add(term.term);
    parts.push(text.slice(last, match.index));
    parts.push(<TermButton key={match.index} label={match[0]} term={term} />);
    last = match.index + match[0].length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}

const EDGE = 16;

const TIP_WIDTH = 288;
const GAP = 8;

function TermButton({ label, term }: { label: string; term: Term }) {
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  // The popup is portalled to <body> with fixed positioning: inside the page, the sections'
  // entry animations create stacking contexts that would paint later sections over it.
  // It's placed under the word, kept on screen, and flipped above if there's no room below.
  const place = () => {
    const word = button.current?.getBoundingClientRect();
    if (!word) return;
    const width = Math.min(TIP_WIDTH, window.innerWidth - 2 * EDGE);
    const left = Math.min(Math.max(word.left, EDGE), window.innerWidth - width - EDGE);
    const height = tip.current?.offsetHeight ?? 0;
    const below = word.bottom + GAP;
    const top = below + height > window.innerHeight - EDGE && word.top - GAP - height > EDGE ? word.top - GAP - height : below;
    setPos({ top, left, width });
  };

  // Measure again once the popup has rendered, so the flip-above check knows its height.
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !tip.current?.contains(target)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const dismiss = () => setPos(null);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", dismiss, { passive: true });
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => (open ? setPos(null) : place())}
        aria-expanded={open}
        className="cursor-help underline decoration-accent/50 decoration-dotted decoration-2 underline-offset-4 transition-colors hover:decoration-accent"
      >
        {label}
      </button>
      {pos &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            className="fixed z-50 rounded-xl border border-border bg-bg p-4 text-left text-sm leading-relaxed text-fg shadow-xl"
          >
            <span className="block font-medium text-accent">{term.term}</span>
            <span className="mt-1 block text-muted">{term.meaning}</span>
          </div>,
          document.body,
        )}
    </>
  );
}
