/** Prints a wallet's recent transactions with summaries and spam flags. Usage: npm run wallet -- <address> */
import { fetchParsedTransactions, fetchRecentSignatures } from "@/lib/solana/rpc";
import { headline } from "@/lib/tx/explain";
import { normalizeTransaction } from "@/lib/tx/normalize";
import { spamReason } from "@/lib/tx/spam";

async function main() {
  const address = process.argv[2];
  const recent = await fetchRecentSignatures(address, 15);
  const parsed = await fetchParsedTransactions(recent.map((r) => r.signature));
  recent.forEach((r, i) => {
    const raw = parsed[i];
    if (!raw) return console.log(`?    ${r.signature.slice(0, 8)}  (unreadable)`);
    const tx = normalizeTransaction(r.signature, raw);
    const spam = spamReason(tx, address);
    console.log(`${spam ? "SPAM" : "    "} ${r.signature.slice(0, 8)}  ${headline(tx, address)}${spam ? `  [${spam}]` : ""}`);
  });
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
