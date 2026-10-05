import { shortAddress } from "@/lib/format";
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, isTokenProgram } from "@/lib/solana/known";
import { explainTransaction } from "@/lib/tx/explain";
import type { TxModel } from "@/lib/tx/model";
import { MAX_CAPTION_WORDS, StoryboardSchema, wordCount, type Scene, type Storyboard } from "./schema";

/** First non-empty option that fits the caption limit; the last one is the short, always-fitting fallback. */
function fit(...options: string[]): string {
  return options.find((o) => o && wordCount(o) <= MAX_CAPTION_WORDS) ?? options[options.length - 1];
}

function list(parts: string[]): string {
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

/** Short spoken descriptions of well-known programs. */
const SPOKEN_BLURBS: Record<string, string> = {
  Jupiter: "a router that shops around for the best price",
  "Orca Whirlpool": "an exchange",
  "Raydium AMM": "an exchange",
  "Raydium CLMM": "an exchange",
  "Meteora DLMM": "an exchange",
  "pump.fun": "a meme coin marketplace",
  "System Program": "Solana's built-in program for sending SOL",
  "Token Program": "which moves tokens between wallets",
  "Token-2022": "which moves tokens between wallets",
};

/** How a program is said out loud: its name, or a description when it has no known name. */
function spokenProgram(ix: TxModel["instructions"][number]): string {
  if (!ix.programKnown) return "an app without a public name";
  const blurb = SPOKEN_BLURBS[ix.programName];
  return blurb ? `${ix.programName}, ${blurb}` : ix.programName;
}

/** Named apps that moved tokens, excluding the plain System and Token programs and unlabelled ones. */
function venueNames(tx: TxModel): string[] {
  const names = new Set<string>();
  for (const t of tx.transfers) {
    if (!t.viaProgramId || !t.viaProgramName) continue;
    if (t.viaProgramId === SYSTEM_PROGRAM_ID || isTokenProgram(t.viaProgramId)) continue;
    if (t.viaProgramName === shortAddress(t.viaProgramId)) continue;
    names.add(t.viaProgramName);
  }
  return [...names];
}

/** Turns "Swapped X for Y" into "This wallet swapped X for Y". */
function walletSentence(headline: string): string {
  return /^(Swapped|Traded|Sent|Received|Ran|Tried)\b/.test(headline)
    ? `This wallet ${headline.charAt(0).toLowerCase()}${headline.slice(1)}`
    : headline;
}

/**
 * Storyboard built in code from the TxModel, worded like a friendly narrator.
 * Every number comes straight from the model. Always valid; used directly and as the AI fallback.
 */
export function deterministicStoryboard(tx: TxModel): Storyboard {
  const story = explainTransaction(tx);
  const scenes: Scene[] = [];
  const fee = tx.feeSol;

  const said = walletSentence(story.headline);
  scenes.push({
    type: "title",
    caption: tx.success
      ? fit(`${said}. Here's how it happened.`, `${said}.`, "A transaction that went through. Here's what it did.")
      : fit(`${said}. Let's see what went wrong.`, `${said}.`, "This transaction failed. Let's see what went wrong."),
  });

  const n = tx.instructions.length;
  const stepsText = `It ran ${n} ${n === 1 ? "step" : "steps"}`;
  // The main step is the app doing the work, not account setup: failed transactions have no
  // inner calls to rank by, so well-known apps come first, then plumbing programs last.
  const plumbing = new Set([COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID]);
  const rank = (ix: TxModel["instructions"][number]) =>
    (SPOKEN_BLURBS[ix.programName] ? 1000 : 0) + (isTokenProgram(ix.programId) ? 500 : 0) + ix.inner.length;
  const apps = tx.instructions.filter((ix) => !plumbing.has(ix.programId) && !isTokenProgram(ix.programId));
  const steps = apps.length > 0 ? apps : tx.instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET_PROGRAM_ID);
  const main = [...steps].sort((a, b) => rank(b) - rank(a))[0];
  scenes.push({
    type: "programs",
    caption: main
      ? fit(
          n === 1 ? `It ran 1 step, using ${spokenProgram(main)}.` : "",
          `${stepsText}. The main one used ${spokenProgram(main)}.`,
          `${stepsText}. The main one used ${main.programKnown ? main.programName : "an unnamed app"}.`,
          `${stepsText}, one after another.`,
        )
      : `${stepsText}, one after another.`,
  });

  if (tx.transfers.length > 0) {
    const moves = tx.transfers.length;
    const names = venueNames(tx);
    const through =
      names.length === 0 ? "" : names.length <= 2 ? ` through ${list(names)}` : ` through ${names.length} different apps`;
    const times = moves === 1 ? "once" : `${moves} times`;
    const attempted = moves === 1 ? "This token move" : `These ${moves} token moves`;
    const were = moves === 1 ? "was" : "were";
    scenes.push({
      type: "tokenFlow",
      caption: tx.success
        ? fit(`Follow the tokens: they moved ${times}${through}.`, `Follow the tokens: they moved ${times}.`)
        : fit(
            `${attempted}${through} ${were} attempted, then rolled back when it failed.`,
            `${attempted} ${were} attempted, then rolled back.`,
          ),
    });
  }

  scenes.push({
    type: "balances",
    caption: tx.success
      ? "Here's the before and after. Green is what the wallet gained, red is what it spent."
      : `Good news: nothing was lost except the tiny ${fee} SOL network fee.`,
  });

  if (tx.failure) {
    const step = (tx.failure.instructionIndex ?? 0) + 1;
    // "Custom" just means "the app's own error code"; it tells a listener nothing.
    const named = !/^custom/i.test(tx.failure.errorName);
    scenes.push({
      type: "failure",
      caption:
        tx.failure.errorName === "SlippageToleranceExceeded"
          ? "The price moved past the wallet's safety limit, so Solana cancelled the whole trade to protect it."
          : fit(
              `Step ${step} hit a problem: ${tx.failure.description.replace(/\.$/, "")}. So Solana undid everything.`,
              named ? `Step ${step} hit an error called ${tx.failure.errorName}, so Solana undid everything.` : "",
              `Step ${step} hit an error inside the app, so Solana undid everything.`,
            ),
    });
  }

  scenes.push({
    type: "outro",
    caption: tx.success
      ? `All of that for a network fee of just ${fee} SOL. Explained by Docent.`
      : `Even failed transactions pay a fee: ${fee} SOL here. Explained by Docent.`,
  });

  return StoryboardSchema.parse({ scenes });
}
