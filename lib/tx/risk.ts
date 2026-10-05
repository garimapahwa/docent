import { shortAddress } from "@/lib/format";
import { SYSTEM_PROGRAM_ID, isTokenProgram } from "@/lib/solana/known";
import { approvalAmount, displayAmount, tokenIn, walletNet } from "@/lib/tx/explain";
import type { Instruction, TxModel } from "@/lib/tx/model";

export type Warning = {
  /** danger: could lose funds; caution: worth a second look; ok: nothing found. */
  level: "danger" | "caution" | "ok";
  title: string;
  detail: string;
};

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

/** Sending more than this share of the wallet's SOL counts as "almost all of it". */
const MOST_OF_BALANCE = 0.95;

const str = (ix: Instruction, k: string) => (typeof ix.info?.[k] === "string" ? (ix.info[k] as string) : null);

/** Spending permissions, ownership changes and other ways a transaction can hand over control. */
function controlWarnings(tx: TxModel, wallet: string): Warning[] {
  const warnings: Warning[] = [];
  const all = tx.instructions.flatMap((ix) => [ix, ...ix.inner]);
  for (const ix of all) {
    const owner = str(ix, "owner") ?? str(ix, "multisigOwner") ?? str(ix, "authority");
    const token = isTokenProgram(ix.programId);

    if (token && (ix.type === "approve" || ix.type === "approveChecked") && owner === wallet) {
      const { symbol, text } = approvalAmount(tx, ix);
      warnings.push({
        level: "danger",
        title: `Gives another address permission to spend your ${symbol}`,
        detail: `${shortAddress(str(ix, "delegate") ?? "unknown")} could move ${text} out of this wallet later, without asking again. Scammers use this to empty wallets. Only allow it if you know exactly why the app needs it.`,
      });
    }

    if (token && ix.type === "setAuthority" && owner === wallet) {
      const type = str(ix, "authorityType");
      if (type === "accountOwner" || type === "closeAccount") {
        const token = tokenIn(tx, str(ix, "account"));
        const to = str(ix, "newAuthority");
        warnings.push({
          level: "danger",
          title: `Hands control of your ${token.symbol} account to ${to ? shortAddress(to) : "nobody"}`,
          detail:
            type === "accountOwner"
              ? `After this, ${to ? shortAddress(to) : "someone else"} owns the account and everything in it. This is a common wallet-drainer trick.`
              : "After this, someone else can close the account and take its SOL deposit.",
        });
      }
    }

    if (ix.programId === SYSTEM_PROGRAM_ID && ix.type === "assign" && str(ix, "account") === wallet) {
      warnings.push({
        level: "danger",
        title: "Hands control of your whole wallet to a program",
        detail: `This changes who controls the wallet itself to ${shortAddress(str(ix, "owner") ?? "unknown")}. Normal apps never ask for this. Don't sign it.`,
      });
    }
  }
  return warnings;
}

/** Things worth a second look before signing; they're normal in transactions that already happened. */
function previewWarnings(tx: TxModel, wallet: string): Warning[] {
  const warnings: Warning[] = [];

  if (tx.failure) {
    warnings.push({
      level: "caution",
      title: "This would fail if you sent it right now",
      detail: `${tx.failure.description} You'd still pay the network fee, so there's no point signing it as it is.`,
    });
  }

  // Emptying a balance: the wallet's token accounts that would end at zero, and SOL nearly gone.
  for (const c of tx.tokenChanges) {
    // Wrapped SOL accounts are emptied routinely by swaps; real SOL is checked below.
    if (c.owner !== wallet || c.mint === WRAPPED_SOL_MINT || c.post !== "0" || Number(c.pre) <= 0) continue;
    warnings.push({
      level: "caution",
      title: `Sends all of your ${c.symbol}`,
      detail: `This wallet's ${c.symbol} balance would go from ${displayAmount(c.pre)} to 0. Make sure that's what you meant to do.`,
    });
  }
  const sol = tx.solChanges.find((c) => c.address === wallet);
  if (sol && Number(sol.pre) > 0.01 && Number(sol.post) < Number(sol.pre) * (1 - MOST_OF_BALANCE)) {
    warnings.push({
      level: "caution",
      title: "Spends almost all of your SOL",
      detail: `This wallet's SOL would go from ${displayAmount(sol.pre)} to ${displayAmount(sol.post)}.`,
    });
  }

  // Giving something away with nothing back: normal for payments, the whole point of a scam.
  const net = walletNet(tx, wallet);
  if (net.length > 0 && net.every((a) => a.net < 0n)) {
    const recipients = [
      ...new Set(tx.transfers.filter((t) => t.fromOwner === wallet && t.toOwner !== wallet).map((t) => t.toOwner ?? t.to)),
    ];
    const to = recipients.length === 1 ? shortAddress(recipients[0]) : recipients.length > 1 ? `${recipients.length} addresses` : "other addresses";
    warnings.push({
      level: "caution",
      title: "Sends tokens without getting anything back",
      detail: `Everything here goes out of the wallet, to ${to}. That's fine for a payment you meant to make, but it's also exactly what a scam looks like.`,
    });
  }

  const unknown = [...new Set(tx.instructions.filter((ix) => !ix.programKnown).map((ix) => ix.programId))];
  if (unknown.length > 0) {
    warnings.push({
      level: "caution",
      title: `Uses ${unknown.length === 1 ? "an app" : `${unknown.length} apps`} Docent doesn't recognise`,
      detail: "That's normal for newer apps, but wallet drainers use unknown programs too. Only sign if you trust the website that asked you to.",
    });
  }
  return warnings;
}

/**
 * Plain-English safety warnings for `wallet` (default: the wallet that signs).
 * For a transaction that already happened, only the serious ones (handing over control).
 * For a preview, also anything worth a second look, or an all-clear when nothing is found.
 */
export function riskWarnings(tx: TxModel, { preview, wallet = tx.feePayer }: { preview: boolean; wallet?: string }): Warning[] {
  const warnings = controlWarnings(tx, wallet);
  if (!preview) return warnings;
  warnings.push(...previewWarnings(tx, wallet));
  if (warnings.length === 0) {
    warnings.push({
      level: "ok",
      title: "No red flags found",
      detail: "Docent did a dry run of this transaction on Solana as it is right now. Nothing in it hands over control of your wallet or tokens.",
    });
  }
  return warnings;
}
