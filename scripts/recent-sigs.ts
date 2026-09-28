/**
 * Lists recent real signatures that touched an address (default: Jupiter).
 * Usage: npm run recent -- [address] [limit]
 */
import { Connection, PublicKey } from "@solana/web3.js";

async function main() {
  const [address = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", limit = "10"] = process.argv.slice(2);
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com");
  const sigs = await connection.getSignaturesForAddress(new PublicKey(address), { limit: Number(limit) });
  for (const s of sigs) console.log(`${s.err ? "FAIL" : "OK  "} ${s.signature}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
