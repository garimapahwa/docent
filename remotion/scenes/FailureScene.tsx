import type { TxModel } from "@/lib/tx/model";
import { Enter, Eyebrow, Mono } from "../components";
import { COLOR, TYPE } from "../theme";

/** Splits "SlippageToleranceExceeded" into "Slippage tolerance exceeded" for display. */
function readable(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The failure description without the heading repeated in front or the "defined by X." note. */
function plainDescription(text: string, heading: string): string {
  let out = text.replace(/\s*This error is defined by [^.]+\.$/, "");
  if (out.toLowerCase().startsWith(`${heading.toLowerCase()}:`)) {
    out = out.slice(heading.length + 1).trim();
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

export function FailureScene({ tx }: { tx: TxModel }) {
  const f = tx.failure;
  if (!f) return null;
  const ix = f.instructionIndex !== null ? tx.instructions[f.instructionIndex] : null;
  const heading = f.errorName === "Custom" ? "Program error" : readable(f.errorName);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 34 }}>
      <Enter>
        <Eyebrow>
          {ix ? `Step ${ix.index + 1} failed · ${f.programName ?? ix.programName}` : "The transaction failed"}
        </Eyebrow>
      </Enter>
      <Enter order={1}>
        <div style={{ fontSize: TYPE.title, fontWeight: 600, letterSpacing: -1.5, color: COLOR.failure, lineHeight: 1.1 }}>
          {heading}
        </div>
      </Enter>
      <Enter order={2}>
        <div style={{ fontSize: TYPE.body, lineHeight: 1.4, maxWidth: 1400 }}>
          {plainDescription(f.description, heading)}
        </div>
      </Enter>
      {f.code !== null && (
        <Enter order={3}>
          <Mono style={{ fontSize: 26, color: COLOR.muted }}>
            Error code {f.code} · {f.codeHex}
            {f.isProgramSpecific ? " · defined by the program" : ""}
          </Mono>
        </Enter>
      )}
      {f.logLine && (
        <Enter order={4}>
          <div
            style={{
              padding: "24px 30px",
              borderRadius: 16,
              backgroundColor: COLOR.surface,
              border: `2px solid ${COLOR.border}`,
              fontSize: 24,
              lineHeight: 1.5,
              wordBreak: "break-all",
            }}
          >
            <Mono style={{ color: COLOR.muted }}>log › </Mono>
            <Mono>{f.logLine}</Mono>
          </div>
        </Enter>
      )}
    </div>
  );
}
