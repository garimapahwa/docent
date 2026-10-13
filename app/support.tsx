/**
 * Link to Docent's pay-what-you-want tip page (a Razorpay Payment Page). Set
 * NEXT_PUBLIC_SUPPORT_URL to its URL; without it, nothing is shown. It's read at build time,
 * so redeploy after changing it.
 */
export const SUPPORT_URL = process.env.NEXT_PUBLIC_SUPPORT_URL ?? "";

/** Small pill for the top bar. */
export function SupportButton() {
  if (!SUPPORT_URL) return null;
  return (
    <a
      href={SUPPORT_URL}
      target="_blank"
      rel="noreferrer"
      className="rounded-full border border-border px-3 py-1.5 font-sans text-sm text-muted transition-colors hover:border-accent hover:text-fg"
    >
      Support ☕
    </a>
  );
}

/** One-line nudge under a finished explanation, when people have just seen the value. */
export function SupportNudge() {
  if (!SUPPORT_URL) return null;
  return (
    <p className="rise text-sm text-muted">
      Docent is free. If it helped you understand your transaction,{" "}
      <a href={SUPPORT_URL} target="_blank" rel="noreferrer" className="text-accent underline-offset-4 hover:underline">
        buy it a coffee ☕
      </a>
    </p>
  );
}
