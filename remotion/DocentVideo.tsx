import { AbsoluteFill, Html5Audio, Sequence, Series } from "remotion";
import type { Scene } from "@/lib/storyboard/schema";
import type { Storyboard } from "@/lib/storyboard/schema";
import type { TxModel } from "@/lib/tx/model";
import { SceneFrame } from "./components";
import { BalancesScene } from "./scenes/BalancesScene";
import { FailureScene } from "./scenes/FailureScene";
import { OutroScene } from "./scenes/OutroScene";
import { ProgramsScene } from "./scenes/ProgramsScene";
import { TitleScene } from "./scenes/TitleScene";
import { TokenFlowScene, flowEdgeCount } from "./scenes/TokenFlowScene";
import { COLOR, VIDEO } from "./theme";

/** Narration for one scene: the audio URL and its length in frames. */
export type VoiceLine = { src: string; frames: number };

export type DocentVideoProps = {
  tx: TxModel;
  storyboard: Storyboard;
  /** One line per scene, same order as the storyboard; null entries are silent scenes. */
  voice?: (VoiceLine | null)[] | null;
};

const { fps } = VIDEO;
/** Narration starts just before the caption bar finishes entering. */
const VOICE_START = 6;
/** Pause after the narration ends, before the scene fades out. */
const VOICE_TAIL = 20;

/**
 * Scene length is decided here from the data (4–6 s), never by the storyboard.
 * Narration can extend a scene so a line is never cut off.
 */
export function sceneDuration(scene: Scene, tx: TxModel, voice?: VoiceLine | null): number {
  const base = baseDuration(scene, tx);
  return voice ? Math.max(base, VOICE_START + voice.frames + VOICE_TAIL) : base;
}

function baseDuration(scene: Scene, tx: TxModel): number {
  switch (scene.type) {
    case "title":
      return 4 * fps;
    case "programs":
      return 6 * fps;
    case "tokenFlow": {
      const extra = tx.success ? 0 : 45; // time for the "all undone" beat
      return Math.min(6 * fps, Math.max(4 * fps, 90 + flowEdgeCount(tx) * 12 + extra));
    }
    case "balances":
      return 5 * fps;
    case "failure":
      return 6 * fps;
    case "outro":
      return 4 * fps;
  }
}

export function videoDuration({ tx, storyboard, voice }: DocentVideoProps): number {
  return storyboard.scenes.reduce((sum, s, i) => sum + sceneDuration(s, tx, voice?.[i]), 0);
}

function SceneContent({ scene, tx, duration }: { scene: Scene; tx: TxModel; duration: number }) {
  switch (scene.type) {
    case "title":
      return <TitleScene tx={tx} />;
    case "programs":
      return <ProgramsScene tx={tx} />;
    case "tokenFlow":
      return <TokenFlowScene tx={tx} duration={duration} />;
    case "balances":
      return <BalancesScene tx={tx} />;
    case "failure":
      return <FailureScene tx={tx} />;
    case "outro":
      return <OutroScene tx={tx} />;
  }
}

export function DocentVideo({ tx, storyboard, voice }: DocentVideoProps) {
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.bg }}>
      <Series>
        {storyboard.scenes.map((scene, i) => {
          const line = voice?.[i];
          const duration = sceneDuration(scene, tx, line);
          return (
            <Series.Sequence key={i} durationInFrames={duration}>
              <SceneFrame caption={scene.caption} duration={duration}>
                <SceneContent scene={scene} tx={tx} duration={duration} />
              </SceneFrame>
              {line && (
                <Sequence from={VOICE_START} durationInFrames={line.frames}>
                  <Html5Audio src={line.src} />
                </Sequence>
              )}
            </Series.Sequence>
          );
        })}
      </Series>
    </AbsoluteFill>
  );
}
