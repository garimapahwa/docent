/**
 * Runs Stage 1 for real signatures and saves each TxModel to fixtures/<name>.json.
 * Usage: npm run inspect -- <signature> [name]
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchParsedTransaction } from "@/lib/solana/rpc";
import { isValidSignature } from "@/lib/solana/signature";
import { TxModelSchema } from "@/lib/tx/model";
import { normalizeTransaction } from "@/lib/tx/normalize";

async function main() {
  const [signature, name] = process.argv.slice(2);
  if (!signature || !isValidSignature(signature)) {
    console.error("Usage: npm run inspect -- <signature> [name]");
    process.exit(1);
  }

  const model = TxModelSchema.parse(normalizeTransaction(signature, await fetchParsedTransaction(signature)));

  const dir = path.join(process.cwd(), "fixtures");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name ?? signature.slice(0, 8)}.json`);
  await writeFile(file, JSON.stringify(model, null, 2) + "\n");

  console.log(`${model.success ? "SUCCESS" : "FAILED"}  slot ${model.slot}  fee ${model.feeSol} SOL`);
  for (const ix of model.instructions) {
    console.log(`  #${ix.index} ${ix.programName}${ix.type ? ` · ${ix.type}` : ""} ${ix.info && ix.type?.startsWith("setCompute") ? JSON.stringify(ix.info) : ""}`);
    for (const inner of ix.inner) console.log(`      ${"  ".repeat(Math.max(0, (inner.stackHeight ?? 2) - 2))}↳ ${inner.programName}${inner.type ? ` · ${inner.type}` : ""}`);
  }
  console.log("  transfers:");
  for (const t of model.transfers) {
    console.log(`    ${t.amount} ${t.symbol}  ${t.from.slice(0, 4)} → ${t.to.slice(0, 4)}${t.viaProgramName ? `  via ${t.viaProgramName}` : ""}${t.involvesFeePayer ? "  [fee payer]" : ""}${t.reverted ? "  (reverted)" : ""}`);
  }
  if (model.failure) console.log(`  failure: ${model.failure.errorName} — ${model.failure.description}`);
  console.log(`saved ${path.relative(process.cwd(), file)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
