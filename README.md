# Docent

Turn any Solana transaction into a plain-English explanation and a narrated video.

**Live:** https://docent-kohl.vercel.app

Paste a transaction signature and Docent tells you what happened: who sent what, where the tokens went, what changed in the wallet, and why it failed if it did. Paste a wallet address instead and it lists that wallet's recent transactions with one-line summaries, hiding spam.

## Features

- **Plain-English summary:** a one-line headline ("Swapped 10.48 USDC for 0.088 SOL") and every step in order.
- **Narrated video:** a ~30 s [Remotion](https://www.remotion.dev) video with scenes for the steps, the token flow, balances before and after, and the failure reason, read aloud by an [ElevenLabs](https://elevenlabs.io) voice.
- **Failures explained:** decoded errors (e.g. Jupiter's `0x1771` → slippage exceeded) with the relevant log line.
- **Wallet lookup:** recent transactions with summaries, with dust payments and junk airdrops hidden.
- **Beginner glossary** of the Solana terms used on the page.

## Accuracy

Every fact comes from the chain; nothing is generated. Numbers are exact decimal strings, never floats. `npm run verify` cross-checks Docent's token totals and fees against Solana's own before/after balance records and against Helius' independent transaction decoder.

## How it works

1. **Fetch and normalize** (`lib/tx/normalize.ts`): the parsed transaction becomes a validated `TxModel` covering instructions, inner calls, transfers (including reverted ones), balance changes and the decoded error.
2. **Explain** (`lib/tx/explain.ts`): deterministic rules turn the model into a headline and steps.
3. **Storyboard** (`lib/storyboard/`): picks scenes and captions. Scenes read their data from the `TxModel`, so a storyboard can't invent facts.
4. **Render** (`remotion/`): the video composition, played in the browser with `@remotion/player`.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your keys
npm run dev
```

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run inspect -- <signature> [name]` | Runs the pipeline on a transaction and saves it to `fixtures/` |
| `npm run explain` | Prints the plain-English explanation for every fixture |
| `npm run wallet -- <address>` | Lists a wallet's recent transactions with summaries and spam flags |
| `npm run verify -- [signatures]` | Cross-checks the numbers against balance records and Helius |
| `npx remotion studio remotion/index.ts` | Opens the video in Remotion Studio |

## Stack

Next.js, TypeScript, Tailwind, Remotion, `@solana/web3.js`, zod, ElevenLabs, deployed on Vercel.
