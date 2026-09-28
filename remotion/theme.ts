/** Video design system. The video is always dark, independent of the web UI theme. */
export const VIDEO = { width: 1920, height: 1080, fps: 30 } as const;

export const COLOR = {
  bg: "#0B0B0F",
  surface: "#16161D",
  border: "#2A2A35",
  text: "#F5F5F7",
  muted: "#8B8B99",
  accent: "#9945FF",
  success: "#14F195",
  failure: "#FF5C5C",
} as const;

export const TYPE = { title: 72, body: 36, caption: 32, small: 26 } as const;

export const SAFE = 120;
export const CAPTION_HEIGHT = 104;
/** Bottom edge of the content area, leaving room for the caption bar. */
export const CONTENT_BOTTOM = VIDEO.height - SAFE - CAPTION_HEIGHT - 40;
export const CONTENT_WIDTH = VIDEO.width - SAFE * 2;

export const SPRING = { damping: 200 } as const;
export const STAGGER = 4;
export const EXIT_FRAMES = 10;
