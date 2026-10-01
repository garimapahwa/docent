"use client";

import { useRef, useState } from "react";
import { DocentVideo, type DocentVideoProps } from "@/remotion/DocentVideo";
import { VIDEO } from "@/remotion/theme";

type State =
  | { status: "idle" }
  | { status: "rendering"; progress: number }
  | { status: "done" }
  | { status: "error"; message: string };

/**
 * Renders the video to an MP4 in the viewer's browser (WebCodecs via @remotion/web-renderer),
 * so there's no render server and the file never leaves their device.
 */
export function DownloadButton({
  props,
  durationInFrames,
  filename,
}: {
  props: DocentVideoProps;
  durationInFrames: number;
  filename: string;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);

  async function render() {
    setState({ status: "rendering", progress: 0 });
    abort.current = new AbortController();
    try {
      // Loaded on demand: the renderer is only needed when someone downloads.
      const { canRenderMediaOnWeb, renderMediaOnWeb } = await import("@remotion/web-renderer");
      const check = await canRenderMediaOnWeb({
        container: "mp4",
        videoCodec: "h264",
        width: VIDEO.width,
        height: VIDEO.height,
      });
      if (!check.canRender) {
        const issue = check.issues.find((i) => i.severity === "error");
        setState({
          status: "error",
          message: `This browser can't create videos${issue ? ` (${issue.message})` : ""}. Try Chrome or Edge on a computer.`,
        });
        return;
      }

      const result = await renderMediaOnWeb({
        composition: {
          component: DocentVideo,
          id: "docent",
          width: VIDEO.width,
          height: VIDEO.height,
          fps: VIDEO.fps,
          durationInFrames,
          defaultProps: props,
        },
        inputProps: props,
        container: "mp4",
        videoCodec: check.resolvedVideoCodec ?? "h264",
        signal: abort.current.signal,
        onProgress: (p) => setState({ status: "rendering", progress: p.progress }),
      });

      const url = URL.createObjectURL(await result.getBlob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setState({ status: "done" });
    } catch (err) {
      if (abort.current?.signal.aborted) {
        setState({ status: "idle" });
        return;
      }
      console.error("[download]", err);
      setState({ status: "error", message: "Couldn't create the video. Please try again, or use Chrome on a computer." });
    }
  }

  if (state.status === "rendering") {
    const pct = Math.round(state.progress * 100);
    return (
      <div className="flex items-center gap-3 text-sm">
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-muted">Making your video… {pct}%</span>
        <button onClick={() => abort.current?.abort()} className="text-muted hover:text-fg">
          cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <button
        onClick={render}
        className="rounded-full bg-accent px-4 py-2 font-medium text-white transition-transform hover:scale-105 active:scale-95"
      >
        {state.status === "done" ? "Downloaded ✓ · download again" : "Download MP4"}
      </button>
      {state.status === "error" && <span className="text-failure">{state.message}</span>}
    </div>
  );
}
