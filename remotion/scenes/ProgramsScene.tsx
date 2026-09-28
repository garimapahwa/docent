import type { TxModel } from "@/lib/tx/model";
import { Enter, Eyebrow, Mono } from "../components";
import { programCards } from "../derive";
import { COLOR, CONTENT_WIDTH, TYPE } from "../theme";

const GAP = 28;
/** Frames between one top-level card and the next. */
const CARD_STEP = 14;

export function ProgramsScene({ tx }: { tx: TxModel }) {
  const cards = programCards(tx);
  const width = (CONTENT_WIDTH - GAP * (cards.length - 1)) / cards.length;
  const nameSize = width < 300 ? 26 : 30;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 48 }}>
      <Enter>
        <Eyebrow>The steps, in order</Eyebrow>
      </Enter>
      <div style={{ display: "flex", gap: GAP, alignItems: "flex-start" }}>
        {cards.map((card, i) => {
          const border =
            card.highlight === "failure" ? COLOR.failure : card.highlight === "accent" ? COLOR.accent : COLOR.border;
          const delay = 6 + i * CARD_STEP;
          return (
            <div key={card.key} style={{ width, display: "flex", flexDirection: "column", gap: 14 }}>
              <Enter delay={delay}>
                <div
                  style={{
                    padding: "24px 26px",
                    borderRadius: 20,
                    backgroundColor: COLOR.surface,
                    border: `3px solid ${border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                    minHeight: 170,
                  }}
                >
                  <div style={{ fontSize: 22, color: card.highlight === "failure" ? COLOR.failure : COLOR.muted }}>
                    {card.step}
                    {card.highlight === "failure" ? " · failed" : ""}
                  </div>
                  <div style={{ fontSize: nameSize, fontWeight: 600, lineHeight: 1.15 }}>{card.name}</div>
                  <Mono style={{ fontSize: 22, color: COLOR.muted }}>{card.action}</Mono>
                </div>
              </Enter>
              {card.inner.map((inner, j) => (
                <Enter key={j} delay={delay + 6} order={j + 1}>
                  <div
                    style={{
                      marginLeft: 24,
                      padding: "14px 20px",
                      borderRadius: 14,
                      border: `2px solid ${COLOR.border}`,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.2 }}>{inner.name}</div>
                    <Mono style={{ fontSize: 18, color: COLOR.muted }}>
                      {inner.action}
                      {inner.transfers > 0 ? ` · ${inner.transfers} ${inner.transfers === 1 ? "transfer" : "transfers"}` : ""}
                    </Mono>
                  </div>
                </Enter>
              ))}
              {card.moreInner > 0 && (
                <Enter delay={delay + 6} order={card.inner.length + 1}>
                  <div style={{ marginLeft: 24, fontSize: 20, color: COLOR.muted }}>+{card.moreInner} more</div>
                </Enter>
              )}
            </div>
          );
        })}
      </div>
      {cards.length === 0 && <div style={{ fontSize: TYPE.body, color: COLOR.muted }}>No instructions.</div>}
    </div>
  );
}
