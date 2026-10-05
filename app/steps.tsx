import type { ExplainedStep } from "@/lib/tx/explain";
import type { Warning } from "@/lib/tx/risk";
import { Explained } from "./glossary";

/** The numbered list of what each step did. */
export function Steps({ steps }: { steps: ExplainedStep[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map((step, i) => (
        <li key={i} className="rise flex gap-4" style={{ animationDelay: `${120 + i * 60}ms` }}>
          <span
            className={`grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs ${
              step.failed ? "bg-failure text-white" : "bg-surface text-muted"
            }`}
          >
            {i + 1}
          </span>
          <div className="flex flex-col gap-2 pt-0.5">
            <p className={step.failed ? "text-failure" : ""}>
              <Explained text={step.text} />
            </p>
            {step.details.length > 0 && (
              <ul className="flex flex-col gap-1.5 border-l-2 border-border pl-4 text-sm text-muted">
                {step.details.map((d) => (
                  <li key={d}>
                    <Explained text={d} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const LEVELS = {
  danger: { box: "border-failure/40 bg-failure/10", title: "text-failure", icon: "⚠" },
  caution: { box: "border-amber-500/40 bg-amber-500/10", title: "text-amber-700", icon: "!" },
  ok: { box: "border-success/40 bg-success/10", title: "text-success", icon: "✓" },
} as const;

/** Safety warnings, most serious first. */
export function Warnings({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) return null;
  const order = { danger: 0, caution: 1, ok: 2 };
  const sorted = [...warnings].sort((a, b) => order[a.level] - order[b.level]);
  return (
    <ul className="flex flex-col gap-3">
      {sorted.map((w, i) => (
        <li key={i} className={`rise rounded-2xl border px-5 py-4 ${LEVELS[w.level].box}`} style={{ animationDelay: `${i * 60}ms` }}>
          <p className={`font-medium ${LEVELS[w.level].title}`}>
            {LEVELS[w.level].icon} {w.title}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-fg/80">
            <Explained text={w.detail} />
          </p>
        </li>
      ))}
    </ul>
  );
}
