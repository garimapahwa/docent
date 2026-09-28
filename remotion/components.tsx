import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { mono, sans } from "./fonts";
import { CAPTION_HEIGHT, COLOR, CONTENT_BOTTOM, EXIT_FRAMES, SAFE, SPRING, STAGGER, TYPE } from "./theme";

/** The one entrance used everywhere: spring (damping 200), fade in + slide up 20px. */
export function useEnter(delay: number): CSSProperties {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: frame - delay, fps, config: SPRING });
  return { opacity: p, transform: `translateY(${(1 - p) * 20}px)` };
}

/** Entrance wrapper. `order` staggers siblings by 4 frames each. */
export function Enter({
  order = 0,
  delay = 0,
  style,
  children,
}: {
  order?: number;
  delay?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const enter = useEnter(delay + order * STAGGER);
  return <div style={{ ...style, ...enter }}>{children}</div>;
}

/** Scene frame: background, safe-area content box, caption bar, and a short fade out. */
export function SceneFrame({
  caption,
  duration,
  children,
}: {
  caption: string;
  duration: number;
  children: ReactNode;
}) {
  const frame = useCurrentFrame();
  const exit = interpolate(frame, [duration - EXIT_FRAMES, duration], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg, color: COLOR.text, fontFamily: sans }}>
      <AbsoluteFill style={{ opacity: exit }}>
        <div style={{ position: "absolute", left: SAFE, right: SAFE, top: SAFE, height: CONTENT_BOTTOM - SAFE }}>
          {children}
        </div>
        <CaptionBar text={caption} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function CaptionBar({ text }: { text: string }) {
  const enter = useEnter(8);
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE,
        right: SAFE,
        bottom: SAFE,
        height: CAPTION_HEIGHT,
        display: "flex",
        alignItems: "center",
        padding: "0 44px",
        borderRadius: 20,
        backgroundColor: COLOR.surface,
        border: `2px solid ${COLOR.border}`,
        fontSize: TYPE.caption,
        lineHeight: 1.3,
        ...enter,
      }}
    >
      {text}
    </div>
  );
}

export function Badge({ success }: { success: boolean }) {
  const color = success ? COLOR.success : COLOR.failure;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 28px",
        borderRadius: 999,
        border: `2px solid ${color}`,
        color,
        fontSize: TYPE.small,
        fontWeight: 600,
        letterSpacing: 2,
        textTransform: "uppercase",
      }}
    >
      <span style={{ width: 14, height: 14, borderRadius: 999, backgroundColor: color }} />
      {success ? "Success" : "Failed"}
    </span>
  );
}

export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontFamily: mono, ...style }}>{children}</span>;
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: TYPE.small, color: COLOR.muted, letterSpacing: 3, textTransform: "uppercase", fontWeight: 500 }}>
      {children}
    </div>
  );
}
