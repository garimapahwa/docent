import { shortAddress } from "@/lib/format";
import type { TxModel } from "@/lib/tx/model";
import { Badge, Enter, Eyebrow, Mono } from "../components";
import { COLOR, TYPE } from "../theme";

function formatDate(iso: string | null): string {
  if (!iso) return "Date unknown";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

export function TitleScene({ tx }: { tx: TxModel }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 40 }}>
      <Enter order={0}>
        <Eyebrow>Solana transaction</Eyebrow>
      </Enter>
      <Enter order={1}>
        <div style={{ fontSize: TYPE.title, fontWeight: 600, letterSpacing: -1.5, lineHeight: 1.1, maxWidth: 1300 }}>
          What happened in this transaction
        </div>
      </Enter>
      <Enter order={2} style={{ display: "flex", alignItems: "center", gap: 32, fontSize: TYPE.body }}>
        <Mono>{shortAddress(tx.signature)}</Mono>
        <span style={{ color: COLOR.border }}>/</span>
        <span style={{ color: COLOR.muted }}>{formatDate(tx.blockTimeIso)}</span>
      </Enter>
      <Enter order={3}>
        <Badge success={tx.success} />
      </Enter>
    </div>
  );
}
