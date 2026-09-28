const TERMS: [string, string][] = [
  ["Solana", "A public blockchain: a shared record of payments and apps that thousands of computers keep in sync. Anyone can read it."],
  ["Transaction", "One request sent to Solana. It can contain several steps, and either all of them happen or none do."],
  ["Signature", "The transaction's unique ID, the long code you pasted. It also proves the wallet owner approved it."],
  ["Wallet", "An account someone controls. The wallet that sent and paid for the transaction is highlighted in purple."],
  ["SOL", "Solana's own currency. Fees are paid in SOL."],
  ["Token", "Any other currency on Solana. USDC and USDT are tokens that track the US dollar."],
  ["Token account", "Wallets keep each token in its own sub-account, so a wallet with USDC and USDT has two."],
  ["Wrapped SOL", "SOL converted into token form so exchanges can trade it like any other token."],
  ["Program", "An app that lives on Solana (a \"smart contract\"), such as Jupiter or Orca."],
  ["Instruction", "One step in a transaction: a request to a program to do something."],
  ["Inner instruction", "A step a program triggers itself while it runs, like Jupiter asking an exchange to swap."],
  ["Swap", "Trading one token for another."],
  ["Slippage", "How much worse a price you'll accept. If prices move further than that, the trade is cancelled."],
  ["Fee", "A small SOL payment to the network. It's charged even when the transaction fails."],
  ["Compute units", "How much computing work a transaction may use. A priority tip pays to get processed sooner."],
  ["Slot", "Solana's clock. A new slot starts about every 0.4 seconds, so the slot number says when it happened."],
];

export function Glossary() {
  return (
    <dl className="rise grid gap-x-8 gap-y-4 rounded-2xl bg-surface p-6 text-sm sm:grid-cols-2">
      {TERMS.map(([term, meaning]) => (
        <div key={term}>
          <dt className="font-medium">{term}</dt>
          <dd className="mt-1 leading-relaxed text-muted">{meaning}</dd>
        </div>
      ))}
    </dl>
  );
}
