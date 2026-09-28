/** Prints the plain-English explanation for every saved fixture. Usage: npm run explain */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { explainTransaction } from "@/lib/tx/explain";
import { TxModelSchema } from "@/lib/tx/model";

async function main() {
  const dir = path.join(process.cwd(), "fixtures");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const tx = TxModelSchema.parse(JSON.parse(await readFile(path.join(dir, file), "utf8")));
    const e = explainTransaction(tx);
    console.log(`\n[${file}]\n${e.headline}`);
    e.steps.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.text}${s.failed ? "  <- failed here" : ""}`);
      s.details.forEach((d) => console.log(`       - ${d}`));
    });
    console.log(`  ${e.outcome}`);
  }
}

main();
