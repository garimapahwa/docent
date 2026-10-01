"use client";

import { getAudioDurationInSeconds } from "@remotion/media-utils";
import { Player } from "@remotion/player";
import { useEffect, useMemo, useState } from "react";
import type { StoryboardResponse, TxResponse } from "@/lib/api";
import type { Storyboard } from "@/lib/storyboard/schema";
import { DocentVideo, videoDuration, type VoiceLine } from "@/remotion/DocentVideo";
import { VIDEO } from "@/remotion/theme";
import { DownloadButton } from "./download-button";

const VOICE_TIMEOUT_MS = 45_000;
/** ElevenLabs' free plan generates at most 2 lines at once, so load 2 at a time. */
const VOICE_CONCURRENCY = 2;

async function measure(src: string): Promise<VoiceLine | null> {
  try {
    return { src, frames: Math.ceil((await getAudioDurationInSeconds(src)) * VIDEO.fps) };
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
    (async () => {
      const s = await loadStory(data);
      if (cancelled) return;
      setStory(s);
      const lines = s.voice ? await loadVoice(s.voice) : null;
      if (!cancelled) setVoice(lines);
    })();
    return () => {
      cancelled = true;
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

  if (!story || voice === "loading") {
    return (
      <div className="grid aspect-video place-items-center rounded-2xl bg-[#0B0B0F] text-sm text-[#8B8B99]">
        {story ? "Recording the narration…" : "Writing the storyboard…"}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[#0B0B0F] shadow-sm">
      <Player
        component={DocentVideo}
        inputProps={inputProps}
        durationInFrames={videoDuration(inputProps)}
        compositionWidth={VIDEO.width}
        compositionHeight={VIDEO.height}
        fps={VIDEO.fps}
        controls
        clickToPlay
        // Browsers block autoplay with sound, so narrated videos wait for a click.
        autoPlay={!voice}
        showPosterWhenUnplayed={Boolean(voice)}
        renderPoster={() => (
          <div className="grid h-full w-full place-items-center bg-black/40">
            <div className="grid size-20 place-items-center rounded-full bg-[#9945FF] pl-1.5 text-3xl text-white shadow-lg">
              ▶
            </div>
          </div>
        )}
        style={{ width: "100%", aspectRatio: `${VIDEO.width} / ${VIDEO.height}` }}
      />
      <div className="border-t border-border bg-bg px-4 py-3">
        <DownloadButton
          props={inputProps}
          durationInFrames={videoDuration(inputProps)}
          filename={`docent-${data.tx.signature.slice(0, 8)}.mp4`}
        />
      </div>
    </div>
  );
}
