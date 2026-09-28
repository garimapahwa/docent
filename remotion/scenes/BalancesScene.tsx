import { shortAddress } from "@/lib/format";
import type { TxModel } from "@/lib/tx/model";
import { Enter, Eyebrow, Mono } from "../components";
import { balanceRows } from "../derive";
import { COLOR, TYPE } from "../theme";

const COLUMNS = "220px 1fr 60px 1fr 1fr";

export function BalancesScene({ tx }: { tx: TxModel }) {
  const rows = balanceRows(tx);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 44 }}>
      <Enter style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Eyebrow>Wallet balance, before → after</Eyebrow>
        <Mono style={{ fontSize: TYPE.body, color: COLOR.accent }}>{shortAddress(tx.feePayer)}</Mono>
      </Enter>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <Enter order={1}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: COLUMNS,
              padding: "0 8px 18px",
              fontSize: 22,
              color: COLOR.muted,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            <span>Token</span>
            <span>Before</span>
            <span />
            <span>After</span>
            <span style={{ textAlign: "right" }}>Change</span>
          </div>
        </Enter>
        {rows.map((r, i) => (
          <Enter key={r.symbol + i} order={i + 2}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: COLUMNS,
                alignItems: "center",
                padding: "26px 8px",
                borderTop: `2px solid ${COLOR.border}`,
                fontSize: TYPE.body,
              }}
            >
              <span style={{ fontWeight: 600 }}>{r.symbol}</span>
              <Mono style={{ color: COLOR.muted }}>{r.before}</Mono>
              <span style={{ color: COLOR.muted }}>→</span>
              <Mono>{r.after}</Mono>
              <Mono
                style={{
                  textAlign: "right",
                  color: r.sign > 0 ? COLOR.success : r.sign < 0 ? COLOR.failure : COLOR.muted,
                }}
              >
                {r.sign > 0 ? "+" : r.sign < 0 ? "−" : ""}
                {r.delta}
              </Mono>
            </div>
          </Enter>
        ))}
        {rows.length === 0 && (
          <Enter order={2}>
            <div style={{ fontSize: TYPE.body, color: COLOR.muted, paddingTop: 20 }}>No balance changes.</div>
          </Enter>
        )}
      </div>
    </div>
  );
}
