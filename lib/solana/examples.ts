import "server-only";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@/lib/solana/known";
import { TxFetchError, rpcCall } from "@/lib/solana/rpc";

/**
 * Example unsigned transactions for trying "check before you sign". They're built for public
 * wallets with funds so the dry run has something to show, and are never signed or sent
 * (nobody but the owner could sign them anyway).
 */
const SAMPLE_WALLETS = ["4XBqViD1XYF1qHrErrsXBzDrCapvP9fEFX4LPjXZi9YU", "B4RRE8DrRRLAH3d6CAqmSixLdcurwnic1h83rEYmSY4s"];
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** A made-up "scammer" address: derived from a label, so nobody holds its key. */
const SCAMMER = PublicKey.findProgramAddressSync([Buffer.from("docent example scammer")], SystemProgram.programId)[0];
/** Placeholder: the simulation swaps in a fresh blockhash. */
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111";

export type ExampleKind = "swap" | "drainer";

function usdcAccount(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), new PublicKey(TOKEN_PROGRAM_ID).toBuffer(), new PublicKey(USDC_MINT).toBuffer()],
    ATA_PROGRAM_ID,
  )[0];
}

/** First sample wallet with enough SOL for a 0.05 SOL swap and fees. */
async function fundedWallet(): Promise<PublicKey> {
  for (const address of SAMPLE_WALLETS) {
    const { value } = await rpcCall<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]);
    if (value >= 200_000_000) return new PublicKey(address);
  }
  throw new TxFetchError("rpc_error", 503, "The example wallets are out of SOL right now. Try your own transaction instead.");
}

/** A real SOL → USDC swap built by Jupiter's API, exactly what a trading app would ask a wallet to sign. */
async function swapExample(wallet: PublicKey): Promise<string> {
  const quoteRes = await fetch(
    `https://lite-api.jup.ag/swap/v1/quote?inputMint=${WSOL_MINT}&outputMint=${USDC_MINT}&amount=50000000&slippageBps=50`,
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!quoteRes.ok) throw new TxFetchError("rpc_error", 502, "Jupiter didn't return a price quote. Try again in a moment.");
  const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteResponse: await quoteRes.json(), userPublicKey: wallet.toBase58(), wrapAndUnwrapSol: true }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await swapRes.json().catch(() => null)) as { swapTransaction?: string } | null;
  if (!swapRes.ok || !body?.swapTransaction) {
    throw new TxFetchError("rpc_error", 502, "Jupiter couldn't build the example swap. Try again in a moment.");
  }
  return body.swapTransaction;
}

/**
 * What a wallet drainer asks you to sign, disguised as something harmless: unlimited permission
 * to spend your USDC, plus ownership of your USDC account, both handed to the scammer.
 */
function drainerExample(wallet: PublicKey): string {
  const account = usdcAccount(wallet);
  const unlimited = Buffer.alloc(9);
  unlimited.writeUInt8(4, 0); // Approve
  unlimited.writeBigUInt64LE(18446744073709551615n, 1);
  const approve = new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: SCAMMER, isSigner: false, isWritable: false },
      { pubkey: wallet, isSigner: true, isWritable: false },
    ],
    data: unlimited,
  });
  const setOwner = new TransactionInstruction({
    programId: new PublicKey(TOKEN_PROGRAM_ID),
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: wallet, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([6, 2, 1]), SCAMMER.toBuffer()]), // SetAuthority: AccountOwner → scammer
  });
  const message = new TransactionMessage({
    payerKey: wallet,
    recentBlockhash: PLACEHOLDER_BLOCKHASH,
    instructions: [approve, setOwner],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
}

export async function exampleTransaction(kind: ExampleKind): Promise<string> {
  const wallet = await fundedWallet();
  return kind === "swap" ? swapExample(wallet) : drainerExample(wallet);
}
