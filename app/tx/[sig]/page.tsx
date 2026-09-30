import type { Metadata } from "next";
import { shortAddress } from "@/lib/format";
import { fetchParsedTransaction } from "@/lib/solana/rpc";
import { isValidSignature } from "@/lib/solana/signature";
import { headline } from "@/lib/tx/explain";
import { normalizeTransaction } from "@/lib/tx/normalize";
import Explorer from "../../explorer";

type Props = { params: Promise<{ sig: string }> };

/** Link previews (X, WhatsApp, Slack) show what the transaction did. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { sig } = await params;
  const title = `Docent · ${shortAddress(sig)}`;
  let description = "What happened in this Solana transaction, explained in plain English.";
  if (isValidSignature(sig)) {
    try {
      description = `${headline(normalizeTransaction(sig, await fetchParsedTransaction(sig)))}. Explained by Docent.`;
    } catch {
      // Keep the generic description; the page itself shows the error.
    }
  }
  return { title, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
}

export default async function TxPage({ params }: Props) {
  const { sig } = await params;
  return <Explorer initialInput={decodeURIComponent(sig)} />;
}
