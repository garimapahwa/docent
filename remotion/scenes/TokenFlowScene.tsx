import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TxModel } from "@/lib/tx/model";
import { Enter, Eyebrow, Mono } from "../components";
import { tokenFlow, type FlowNode } from "../derive";
import { mono } from "../fonts";
import { COLOR, CONTENT_BOTTOM, CONTENT_WIDTH, SAFE, SPRING, TYPE } from "../theme";

const HEIGHT = CONTENT_BOTTOM - SAFE;
const GRAPH_TOP = 90;
const NODE_W = 340;
const NODE_H = 120;
const WALLET_X = NODE_W / 2 + 40;
const VENUE_X = CONTENT_WIDTH - NODE_W / 2 - 120;
const DRAW_FRAMES = 18;
const FIRST_EDGE = 20;

type Point = { x: number; y: number };

export function flowEdgeCount(tx: TxModel): number {
  return tokenFlow(tx).edges.length;
}

/** Frames between arrows, chosen so all arrows finish with time left to read them. */
function edgeGap(duration: number, edges: number): number {
  const available = duration - FIRST_EDGE - DRAW_FRAMES - 50;
  return Math.max(10, Math.min(24, Math.floor(available / Math.max(1, edges))));
}

function bezier(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

export function TokenFlowScene({ tx, duration }: { tx: TxModel; duration: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { nodes, edges, truncated } = tokenFlow(tx);

  // Columns: wallet | programs the wallet dealt with directly | programs only reached through those.
  const wallet = nodes.find((n) => n.isWallet)!;
  const touchesWallet = (key: string) =>
    edges.some((e) => (e.from === key && e.to === wallet.key) || (e.to === key && e.from === wallet.key));
  const venues = nodes.filter((n) => !n.isWallet);
  const near = venues.filter((n) => touchesWallet(n.key));
  const far = venues.filter((n) => !touchesWallet(n.key));
  const columns = far.length > 0 && near.length > 0 ? [near, far] : [venues];
  const columnX = columns.length === 2 ? [CONTENT_WIDTH / 2, VENUE_X] : [VENUE_X];

  const span = HEIGHT - GRAPH_TOP;
  const center = new Map<string, Point>();
  center.set(wallet.key, { x: WALLET_X, y: GRAPH_TOP + span / 2 });
  columns.forEach((col, c) =>
    col.forEach((n, k) => center.set(n.key, { x: columnX[c], y: GRAPH_TOP + ((k + 0.5) * span) / col.length })),
  );

  const gap = edgeGap(duration, edges.length);
  const starts = edges.map((_, i) => FIRST_EDGE + i * gap);
  const lastDone = (starts[starts.length - 1] ?? 0) + DRAW_FRAMES;
  const active = starts.reduce((acc, s, i) => (frame >= s ? i : acc), -1);

  // Failed transactions: once every attempted move is shown, everything is undone.
  const revert = tx.success ? 0 : spring({ frame: frame - lastDone - 12, fps, config: SPRING });
  const fade = 1 - 0.8 * revert;

  const geometry = edges.map((e) => {
    const a = center.get(e.from)!;
    const b = center.get(e.to)!;
    let p0: Point;
    let p1: Point;
    let c: Point;
    if (a.x === b.x) {
      // Between two venues: arc out to the right of the column.
      p0 = { x: a.x + NODE_W / 2, y: a.y };
      p1 = { x: b.x + NODE_W / 2, y: b.y };
      c = { x: a.x + NODE_W / 2 + 110, y: (a.y + b.y) / 2 };
    } else {
      const dir = Math.sign(b.x - a.x);
      p0 = { x: a.x + (dir * NODE_W) / 2, y: a.y };
      p1 = { x: b.x - (dir * NODE_W) / 2, y: b.y };
      // Offset along the normal so A→B and B→A arcs separate.
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      c = { x: (p0.x + p1.x) / 2 + (-dy / len) * 130, y: (p0.y + p1.y) / 2 + (dx / len) * 130 };
    }
    return { p0, p1, c };
  });

  return (
    <div style={{ position: "relative", width: CONTENT_WIDTH, height: HEIGHT }}>
      <Enter>
        <Eyebrow>{tx.success ? "Where the tokens went" : "Where the tokens would have gone"}</Eyebrow>
      </Enter>
      {truncated > 0 && (
        <div style={{ position: "absolute", right: 0, top: 0, fontSize: 22, color: COLOR.muted }}>
          +{truncated} more {truncated === 1 ? "movement" : "movements"} not shown
        </div>
      )}

      <svg width={CONTENT_WIDTH} height={HEIGHT} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        {geometry.map(({ p0, p1, c }, i) => {
          const p = interpolate(frame, [starts[i], starts[i] + DRAW_FRAMES], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.inOut(Easing.cubic),
          });
          if (p <= 0) return null;
          const current = i === active;
          const stroke = current ? COLOR.text : COLOR.muted;
          const opacity = (current ? 1 : 0.4) * fade;
          const dot = bezier(p0, c, p1, p);
          const dx = p1.x - c.x;
          const dy = p1.y - c.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const head = `${p1.x},${p1.y} ${p1.x - ux * 22 - uy * 11},${p1.y - uy * 22 + ux * 11} ${p1.x - ux * 22 + uy * 11},${p1.y - uy * 22 - ux * 11}`;
          return (
            <g key={i} opacity={opacity}>
              <path
                d={`M ${p0.x} ${p0.y} Q ${c.x} ${c.y} ${p1.x} ${p1.y}`}
                fill="none"
                stroke={stroke}
                strokeWidth={4}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - p}
              />
              {p < 1 ? <circle cx={dot.x} cy={dot.y} r={9} fill={stroke} /> : <polygon points={head} fill={stroke} />}
            </g>
          );
        })}
      </svg>

      {geometry.map(({ p0, p1, c }, i) => {
        const p = interpolate(frame, [starts[i] + DRAW_FRAMES / 2, starts[i] + DRAW_FRAMES], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        if (p <= 0) return null;
        const mid = bezier(p0, c, p1, 0.5);
        // Only the move happening now carries a label, so labels never pile up.
        const current = i === active;
        if (!current) return null;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: mid.x,
              top: mid.y,
              transform: "translate(-50%, -50%)",
              opacity: p * fade,
              padding: "10px 22px",
              borderRadius: 14,
              backgroundColor: COLOR.bg,
              border: `2px solid ${COLOR.text}`,
              fontFamily: mono,
              fontSize: 30,
              whiteSpace: "nowrap",
            }}
          >
            {edges[i].amount} {edges[i].symbol}
          </div>
        );
      })}

      {nodes.map((n, k) => (
        <NodeBox key={n.key} node={n} at={center.get(n.key)!} order={k} />
      ))}

      {!tx.success && revert > 0.01 && (
        <div
          style={{
            position: "absolute",
            left: (WALLET_X + VENUE_X) / 2,
            top: GRAPH_TOP + span / 2,
            transform: `translate(-50%, -50%) translateY(${(1 - revert) * 20}px)`,
            opacity: revert,
            padding: "20px 40px",
            borderRadius: 20,
            backgroundColor: COLOR.bg,
            border: `3px solid ${COLOR.failure}`,
            color: COLOR.failure,
            fontSize: TYPE.body,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          All undone: nothing moved
        </div>
      )}
    </div>
  );
}

function NodeBox({ node, at, order }: { node: FlowNode; at: Point; order: number }) {
  return (
    <Enter
      order={order}
      delay={4}
      style={{
        position: "absolute",
        left: at.x - NODE_W / 2,
        top: at.y - NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
        borderRadius: 20,
        backgroundColor: node.isWallet ? COLOR.accent : COLOR.surface,
        border: `3px solid ${node.isWallet ? COLOR.accent : COLOR.border}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 28px",
        gap: 6,
      }}
    >
      <div style={{ fontSize: 30, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {node.label}
      </div>
      <Mono style={{ fontSize: 22, color: node.isWallet ? COLOR.text : COLOR.muted, opacity: node.isWallet ? 0.85 : 1 }}>
        {node.sub}
      </Mono>
    </Enter>
  );
}
