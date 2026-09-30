import type { Metadata } from "next";
import { shortAddress } from "@/lib/format";
import Explorer from "../../explorer";

type Props = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const title = `Docent · wallet ${shortAddress(address)}`;
  const description = "This wallet's latest Solana transactions, explained in plain English, with spam hidden.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary", title, description } };
}

export default async function AddressPage({ params }: Props) {
  const { address } = await params;
  return <Explorer initialInput={decodeURIComponent(address)} />;
}
