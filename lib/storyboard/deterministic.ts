import { COMPUTE_BUDGET_PROGRAM_ID } from "@/lib/solana/known";
import { explainTransaction } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";
import { MAX_CAPTION_WORDS, StoryboardSchema, wordCount, type Scene, type Storyboard } from "./schema";

/** Uses `preferred` if it fits the caption limit, otherwise `fallback`. */
function fit(preferred: string, fallback: string): string {
  return wordCount(preferred) <= MAX_CAPTION_WORDS ? preferred : fallback;
}

/** Owners the wallet traded with, i.e. distinct programs that moved tokens. */
function venueCount(tx: TxModel): number {
  return new Set(tx.transfers.map((t) => t.viaProgramId).filter(Boolean)).size;
}

/** Storyboard built in code from the TxModel. Always valid; used directly and as the AI fallback. */
export function deterministicStoryboard(tx: TxModel): Storyboard {
  const story = explainTransaction(tx);
  const scenes: Scene[] = [];

  scenes.push({
    type: "title",
    caption: fit(story.headline, tx.success ? "A transaction that went through." : "A transaction that failed."),
  });

  const steps = tx.instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM_ID);
  const main = [...steps].sort((a, b) => b.inner.length - a.inner.length)[0];
  scenes.push({
    type: "programs",
    caption: main
      ? fit(
          `${tx.instructions.length} steps ran in order. The main one called ${main.programName}.`,
          `${tx.instructions.length} steps ran in order.`,
        )
      : `${tx.instructions.length} steps ran in order.`,
  });

  if (tx.transfers.length > 0) {
    const n = tx.transfers.length;
    const venues = venueCount(tx);
    scenes.push({
      type: "tokenFlow",
      caption: tx.success
        ? `Tokens moved ${n} ${n === 1 ? "time" : "times"} between the wallet and ${venues} ${venues === 1 ? "program" : "programs"}.`
        : `These ${n} token ${n === 1 ? "move was" : "moves were"} attempted, then undone when the transaction failed.`,
    });
  }

  scenes.push({
    type: "balances",
    caption: tx.success
      ? "The wallet's balances before and after. Green was gained, red was spent."
      : `Nothing changed except the ${tx.feeSol} SOL network fee.`,
  });

  if (tx.failure) {
    const step = (tx.failure.instructionIndex ?? 0) + 1;
    const reason =
      tx.failure.errorName === "SlippageToleranceExceeded"
        ? `Step ${step} failed: prices moved past the wallet's limit, so everything was cancelled.`
        : `Step ${step} failed with the error ${tx.failure.errorName}.`;
    scenes.push({ type: "failure", caption: fit(reason, `Step ${step} failed, so everything was cancelled.`) });
  }

  scenes.push({ type: "outro", caption: `Network fee paid: ${tx.feeSol} SOL. Explained by Docent.` });

  return StoryboardSchema.parse({ scenes });
}
