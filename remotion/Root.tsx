/**
 * Remotion Studio / server-side rendering entry (not used by the web app).
 * Preview: npx remotion studio remotion/index.ts
 */
import { Composition } from "remotion";
import failedLoop from "@/fixtures/jupiter-failed-slippage.json";
import failedSwap from "@/fixtures/jupiter-failed-b.json";
import successSwap from "@/fixtures/jupiter-success-a.json";
import successLoop from "@/fixtures/jupiter-success-b.json";
import { deterministicStoryboard } from "@/lib/storyboard/deterministic";
import { TxModelSchema } from "@/lib/tx/model";
import { DocentVideo, videoDuration, type DocentVideoProps } from "./DocentVideo";
import { VIDEO } from "./theme";

const SAMPLES = { failedLoop, failedSwap, successSwap, successLoop };

function propsFor(fixture: unknown): DocentVideoProps {
  const tx = TxModelSchema.parse(fixture);
  return { tx, storyboard: deterministicStoryboard(tx) };
}

export function RemotionRoot() {
  return (
    <>
      {Object.entries(SAMPLES).map(([id, fixture]) => {
        const defaultProps = propsFor(fixture);
        return (
          <Composition
            key={id}
            id={id}
            component={DocentVideo}
            width={VIDEO.width}
            height={VIDEO.height}
            fps={VIDEO.fps}
            durationInFrames={videoDuration(defaultProps)}
            defaultProps={defaultProps}
            calculateMetadata={({ props }) => ({ durationInFrames: videoDuration(props) })}
          />
        );
      })}
    </>
  );
}
