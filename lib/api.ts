import type { Storyboard } from "@/lib/storyboard/schema";
import type { TxModel } from "@/lib/tx/model";
import type { Warning } from "@/lib/tx/risk";

/** Response of GET /api/tx. */
export type TxResponse = {
  tx: TxModel;
  storyboard: Storyboard;
  /** One narration URL per storyboard scene, or null when voice isn't configured. */
  voice: string[] | null;
};

/** Response of GET /api/storyboard. */
export type StoryboardResponse = {
  storyboard: Storyboard;
  /** "ai": Claude's captions; "mixed": some replaced by the safe version; "fallback": deterministic. */
  source: "ai" | "mixed" | "fallback";
  notes: string[];
  voice: string[] | null;
};

/** Response of POST /api/check: a simulated, unsent transaction. */
export type CheckResponse = {
  tx: TxModel;
  /** Slot the dry run was done against. */
  slot: number;
  warnings: Warning[];
};

/** One row of GET /api/recent. */
export type WalletTx = {
  signature: string;
  success: boolean;
  blockTime: number | null;
  /** Plain-English summary from this wallet's point of view; null if the transaction couldn't be read. */
  summary: string | null;
  /** Why it looks like spam, or null if it doesn't. */
  spam: string | null;
};

export type RecentResponse = { address: string; transactions: WalletTx[] };
