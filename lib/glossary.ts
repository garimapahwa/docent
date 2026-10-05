/**
 * Plain-English definitions. `matches` are the phrases in Docent's own text that link to the
 * term (case-insensitive, whole words); terms without `matches` only appear in the full glossary.
 */
export type Term = { term: string; meaning: string; matches?: string[] };

export const TERMS: Term[] = [
  { term: "Solana", meaning: "A public blockchain: a shared record of payments and apps that thousands of computers keep in sync. Anyone can read it." },
  { term: "Transaction", meaning: "One request sent to Solana. It can contain several steps, and either all of them happen or none do." },
  { term: "Signature", meaning: "The transaction's unique ID, the long code you pasted. It also proves the wallet owner approved it." },
  { term: "Wallet", meaning: "An account someone controls. The wallet that sent and paid for the transaction is highlighted in purple." },
  { term: "SOL", meaning: "Solana's own currency. Fees are paid in SOL." },
  { term: "Token", meaning: "Any other currency on Solana. USDC and USDT are tokens that track the US dollar." },
  {
    term: "Token account",
    meaning: "Wallets keep each token in its own sub-account, so a wallet with USDC and USDT has two.",
    matches: ["token account", "token accounts", "separate balance"],
  },
  {
    term: "Wrapped SOL",
    meaning: "SOL converted into token form so exchanges can trade it like any other token. It's turned back into normal SOL afterwards.",
    matches: ["wrapped SOL"],
  },
  {
    term: "Program",
    meaning: "An app that lives on Solana (a \"smart contract\"), such as Jupiter or Orca.",
    matches: ["program", "programs"],
  },
  { term: "Instruction", meaning: "One step in a transaction: a request to a program to do something." },
  { term: "Inner instruction", meaning: "A step a program triggers itself while it runs, like Jupiter asking an exchange to swap." },
  { term: "Swap", meaning: "Trading one token for another.", matches: ["swap", "swaps", "swapped", "make a trade"] },
  {
    term: "Router",
    meaning: "An app that doesn't hold any tokens itself. It checks many exchanges and splits your trade between them to get the best price.",
    matches: ["trading router", "router"],
  },
  {
    term: "Exchange",
    meaning: "An app holding a pool of two tokens that anyone can trade against. The price depends on how much of each token is in the pool.",
    matches: ["exchange", "exchanges"],
  },
  {
    term: "Slippage",
    meaning: "How much worse a price you'll accept. If prices move further than that while your trade is on its way, the trade is cancelled to protect you.",
    matches: ["slippage", "minimum the wallet agreed to accept", "safety limit"],
  },
  {
    term: "Fee",
    meaning: "A small SOL payment to the network for processing the transaction. It's charged even when the transaction fails.",
    matches: ["network fee", "fee"],
  },
  {
    term: "Compute units",
    meaning: "How much computing work a transaction may use. Setting a budget up front helps it get processed.",
    matches: ["computing budget", "compute units"],
  },
  {
    term: "Priority tip",
    meaning: "An optional extra payment on top of the fee so validators process the transaction sooner when the network is busy.",
    matches: ["priority tip", "tips"],
  },
  {
    term: "Account deposit",
    meaning: "Solana charges a small refundable SOL deposit (\"rent\") to store each account. You get it back when the account is closed.",
    matches: ["SOL deposit", "account deposits", "refunded account deposits"],
  },
  {
    term: "All or nothing",
    meaning: "If any step of a transaction fails, Solana cancels every step, as if nothing happened. Only the fee is kept.",
    matches: ["undid every step", "undone"],
  },
  {
    term: "Durable nonce",
    meaning: "A one-time ticket that lets a transaction be signed now and sent later, instead of expiring after about a minute.",
    matches: ["durable nonce"],
  },
  {
    term: "Market price",
    meaning: "What a token was trading for on big exchanges at that moment. Docent uses the average price during that minute.",
    matches: ["market price", "market"],
  },
  {
    term: "Simulation",
    meaning: "Solana can do a dry run of a transaction against the current state without actually sending it, to show what would happen.",
    matches: ["simulation", "simulated", "dry run"],
  },
  {
    term: "Spending permission",
    meaning: "A token \"approval\" lets another address move your tokens later without asking you again. Scammers use this to empty wallets.",
    matches: ["permission to spend", "spending permission"],
  },
  { term: "Slot", meaning: "Solana's clock. A new slot starts about every 0.4 seconds, so the slot number says when it happened." },
];
