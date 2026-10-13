"use client";

import { useState, type FormEvent } from "react";
import type { MembershipStatus } from "@/lib/api";

type RazorpayResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type RazorpayCheckout = { open: () => void; on: (event: string, cb: (e: { error?: { description?: string } }) => void) => void };
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

export async function fetchMembership(): Promise<MembershipStatus | null> {
  try {
    const res = await fetch("/api/membership", { cache: "no-store" });
    return res.ok ? ((await res.json()) as MembershipStatus) : null;
  } catch {
    return null;
  }
}

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Couldn't load Razorpay. Check your connection."));
    document.body.appendChild(script);
  });
}

/**
 * Opens Razorpay Checkout for the lifetime membership. Resolves true once our server has
 * verified the payment (and set the membership cookie), false if the visitor closed it.
 */
async function buyMembership(): Promise<boolean> {
  await loadCheckout();
  const orderRes = await fetch("/api/membership/order", { method: "POST" });
  const order = (await orderRes.json()) as { orderId?: string; amount?: number; currency?: string; keyId?: string; error?: string };
  if (!orderRes.ok || !order.orderId) throw new Error(order.error ?? "Couldn't start the payment.");

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: "Docent",
      description: "Lifetime membership: unlimited checks",
      theme: { color: "#9945FF" },
      handler: async (response: RazorpayResponse) => {
        const verify = await fetch("/api/membership/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(response),
        });
        if (verify.ok) resolve(true);
        else reject(new Error("Payment received, but we couldn't confirm it. Use 'restore' with your payment ID."));
      },
      modal: { ondismiss: () => resolve(false) },
    });
    checkout.on("payment.failed", (e) => reject(new Error(e.error?.description ?? "The payment failed.")));
    checkout.open();
  });
}

/** Shown when the free checks are used up. Calls onMember after a successful payment or restore. */
export function Paywall({ price, freeChecks, onMember }: { price: string; freeChecks: number; onMember: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [paymentId, setPaymentId] = useState("");

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      if (await buyMembership()) onMember();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The payment didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/membership/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const body = (await res.json()) as { error?: string };
      if (res.ok) onMember();
      else setError(body.error ?? "Couldn't restore the membership.");
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rise flex flex-col gap-4 rounded-2xl border border-accent/40 bg-accent/5 p-6">
      <p className="text-xs uppercase tracking-wide text-accent">Docent membership</p>
      <h2 className="text-2xl font-semibold tracking-tight">You&apos;ve used your {freeChecks} free checks</h2>
      <ul className="flex flex-col gap-1.5 text-muted">
        <li>✓ Unlimited transaction explanations and narrated videos</li>
        <li>✓ Unlimited &quot;check before you sign&quot; scam checks</li>
        <li>✓ Pay once, yours for life, on every device you sign in on</li>
      </ul>
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={pay}
          disabled={busy}
          className="rounded-full bg-accent px-6 py-3 font-medium text-white transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          {busy ? "Opening…" : `Become a member · ${price}`}
        </button>
        <span className="text-sm text-muted">UPI, cards and netbanking via Razorpay</span>
      </div>
      {error && <p className="text-sm text-failure">{error}</p>}
      {restoring ? (
        <form onSubmit={restore} className="flex flex-wrap items-center gap-3 text-sm">
          <input
            value={paymentId}
            onChange={(e) => setPaymentId(e.target.value)}
            placeholder="pay_… from your receipt email"
            className="min-w-0 flex-1 rounded-full border border-border bg-bg px-4 py-2 font-mono outline-none focus:border-accent"
          />
          <button disabled={busy || !paymentId.trim()} className="text-accent disabled:opacity-50">
            restore
          </button>
        </form>
      ) : (
        <button onClick={() => setRestoring(true)} className="self-start text-left text-sm text-muted hover:text-fg">
          Paid but still locked? Enter your payment ID
        </button>
      )}
    </section>
  );
}

/** One line under the input: free checks left, or the member badge. */
export function MembershipHint({ status }: { status: MembershipStatus | null }) {
  if (!status?.enabled) return null;
  if (status.member) return <p className="text-sm text-success">✓ Member · unlimited checks</p>;
  if (!status.signedIn) {
    return (
      <p className="text-sm text-muted">
        Sign in for {status.freeChecks} free checks. Shared links, wallet lists and demos are always free.
      </p>
    );
  }
  const left = status.freeLeft ?? 0;
  return (
    <p className="text-sm text-muted">
      {left > 0 ? `${left} free ${left === 1 ? "check" : "checks"} left` : "Free checks used"} · unlimited for {status.price}, once.
      Shared links and demos are always free.
    </p>
  );
}
