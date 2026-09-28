import { useCurrentFrame } from "remotion";
import type { TxModel } from "@/lib/tx/model";
import { Enter, Eyebrow, Mono } from "../components";
import { COLOR, TYPE } from "../theme";

export function OutroScene({ tx }: { tx: TxModel }) {
  const frame = useCurrentFrame();
  const cursorOn = Math.floor(frame / 15) % 2 === 0;
  const facts: [string, string][] = [
    ["Network fee paid", `${tx.feeSol} SOL`],
    ["Slot", tx.slot.toLocaleString("en-US")],
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 56 }}>
      <div style={{ display: "flex", gap: 120 }}>
        {facts.map(([label, value], i) => (
          <Enter key={label} order={i} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Eyebrow>{label}</Eyebrow>
            <Mono style={{ fontSize: 56 }}>{value}</Mono>
          </Enter>
        ))}
      </div>
      <Enter order={2} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Eyebrow>Signature</Eyebrow>
        <Mono style={{ fontSize: 27, color: COLOR.muted, wordBreak: "break-all" }}>{tx.signature}</Mono>
      </Enter>
      <Enter order={4}>
        <Mono style={{ fontSize: TYPE.body }}>
          Made with docent<span style={{ color: COLOR.accent, opacity: cursorOn ? 1 : 0 }}>_</span>
        </Mono>
      </Enter>
    </div>
  );
}
