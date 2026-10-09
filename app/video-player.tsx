"use client";

import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StoryboardResponse, TxResponse } from "@/lib/api";
import type { Storyboard } from "@/lib/storyboard/schema";
import { DocentVideo, videoDuration, type VoiceLine } from "@/remotion/DocentVideo";
import { VIDEO } from "@/remotion/theme";
import { DownloadButton } from "./download-button";

const VOICE_TIMEOUT_MS = 45_000;
/** ElevenLabs' free plan generates at most 2 lines at once, so load 2 at a time. */
const VOICE_CONCURRENCY = 2;

/**
 * Downloads one narration line and measures it. The audio is played from a local copy (a blob
 * URL): Safari reports a streamed MP3's length as Infinity and wants range requests to seek,
 * and a local copy avoids both. A line that can't be measured is left silent.
 */
async function measure(url: string): Promise<VoiceLine | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const src = URL.createObjectURL(await res.blob());
    const seconds = await getAudioDurationInSeconds(src);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      URL.revokeObjectURL(src);
      return null;
    }
    return { src, frames: Math.ceil(seconds * VIDEO.fps) };
  } catch {
    return null;
  }
}

/**
 * Measures every narration line, 2 at a time. A line that fails is left silent instead of
 * silencing the whole video. Resolves to null if nothing loaded in time.
 */
async function loadVoice(urls: string[]): Promise<(VoiceLine | null)[] | null> {
  const lines: (VoiceLine | null)[] = urls.map(() => null);
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      lines[i] = await measure(urls[i]);
    }
  };
  const load = Promise.all(Array.from({ length: VOICE_CONCURRENCY }, worker)).then(() =>
    lines.some(Boolean) ? lines : null,
  );
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), VOICE_TIMEOUT_MS));
  return Promise.race([load, timeout]);
}

const STORYBOARD_TIMEOUT_MS = 50_000;

type Story = { storyboard: Storyboard; voice: string[] | null; source: StoryboardResponse["source"] };

/** Claude's storyboard from the server; the deterministic one from /api/tx if that fails or is slow. */
async function loadStory(data: TxResponse): Promise<Story> {
  const fallback: Story = { storyboard: data.storyboard, voice: data.voice, source: "fallback" };
  try {
    const res = await fetch(`/api/storyboard?sig=${encodeURIComponent(data.tx.signature)}`, {
      signal: AbortSignal.timeout(STORYBOARD_TIMEOUT_MS),
    });
    if (!res.ok) return fallback;
    const body = (await res.json()) as StoryboardResponse;
    return { storyboard: body.storyboard, voice: body.voice, source: body.source };
  } catch {
    return fallback;
  }
}

export default function VideoPlayer({ data }: { data: TxResponse }) {
  const [story, setStory] = useState<Story | null>(null);
  const [voice, setVoice] = useState<(VoiceLine | null)[] | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;
    let loaded: (VoiceLine | null)[] | null = null;
    (async () => {
      const s = await loadStory(data);
      if (cancelled) return;
      setStory(s);
      loaded = s.voice ? await loadVoice(s.voice) : null;
      if (!cancelled) setVoice(loaded);
    })();
    return () => {
      cancelled = true;
      // Free the downloaded narration when this video goes away.
      loaded?.forEach((line) => line && URL.revokeObjectURL(line.src));
    };
  }, [data]);

  const inputProps = useMemo(
    () => ({
      tx: data.tx,
      storyboard: story?.storyboard ?? data.storyboard,
      voice: voice === "loading" ? null : voice,
    }),
    [data, story, voice],
  );

  const player = useRef<PlayerRef>(null);
  const [started, setStarted] = useState(false);
  // Pseudo full screen: iPhones only allow real full screen for <video>, not for a player like this.
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const onPlay = () => setStarted(true);
    p.addEventListener("play", onPlay);
    return () => p.removeEventListener("play", onPlay);
  }, [story, voice]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded]);

  if (!story || voice === "loading") {
    return (
      <div className="grid aspect-video place-items-center rounded-2xl bg-[#0B0B0F] text-sm text-[#8B8B99]">
        {story ? "Recording the narration…" : "Writing the storyboard…"}
      </div>
    );
  }

  const narrated = Boolean(voice?.some(Boolean));

  function fullScreen() {
    const canFullscreen =
      document.fullscreenEnabled || (document as Document & { webkitFullscreenEnabled?: boolean }).webkitFullscreenEnabled;
    if (canFullscreen && player.current) player.current.requestFullscreen();
    else setExpanded(true);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[#0B0B0F] shadow-sm">
      <div
        className={
          expanded
            ? "fixed inset-0 z-50 flex flex-col items-center justify-center bg-black p-2"
            : "relative"
        }
      >
        {expanded && (
          <button
            onClick={() => setExpanded(false)}
            aria-label="Exit full screen"
            className="absolute right-4 top-4 z-20 grid size-11 place-items-center rounded-full bg-white/15 text-xl text-white"
          >
            ✕
          </button>
        )}
        <div className="relative w-full" style={expanded ? { maxWidth: `calc((100vh - 1rem) * ${VIDEO.width / VIDEO.height})` } : undefined}>
          <Player
            ref={player}
            component={DocentVideo}
            inputProps={inputProps}
            durationInFrames={videoDuration(inputProps)}
            compositionWidth={VIDEO.width}
            compositionHeight={VIDEO.height}
            fps={VIDEO.fps}
            controls
            clickToPlay
            allowFullscreen
            // Browsers block autoplay with sound, so narrated videos wait for a tap.
            autoPlay={!narrated}
            acknowledgeRemotionLicense
            style={{ width: "100%", aspectRatio: `${VIDEO.width} / ${VIDEO.height}` }}
          />
          {narrated && !started && (
            // Our own play button above the player: on phones the player's touch layer swallows
            // taps on a poster, and audio may only start from a tap that calls play() directly.
            <button
              onClick={(e) => player.current?.play(e)}
              aria-label="Play the narrated video"
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/40"
            >
              <span className="grid size-20 place-items-center rounded-full bg-[#9945FF] pl-1.5 text-3xl text-white shadow-lg transition-transform hover:scale-105">
                ▶
              </span>
              <span className="rounded-full bg-black/50 px-3 py-1 text-sm text-white">🔊 Tap to play with sound</span>
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-bg px-4 py-3">
        <DownloadButton
          props={inputProps}
          durationInFrames={videoDuration(inputProps)}
          filename={`docent-${data.tx.signature.slice(0, 8)}.mp4`}
        />
        <div className="flex items-center gap-4 text-sm">
          {!narrated && <span className="text-muted">No narration right now</span>}
          <button onClick={fullScreen} className="text-muted transition-colors hover:text-fg">
            ⛶ Full screen
          </button>
        </div>
      </div>
    </div>
  );
}
