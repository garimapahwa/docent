import "server-only";
import { MEMBERSHIP_NOTE, PRICE_PAISE } from "@/lib/membership";

const API = "https://api.razorpay.com/v1";

function auth(): string {
  return `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64")}`;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", ...init?.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as (T & { error?: { description?: string } }) | null;
  if (!res.ok || !body) throw new Error(`Razorpay ${res.status}: ${body?.error?.description ?? "no response"}`);
  return body;
}

export type Order = { id: string; amount: number; currency: string };

/** An order for the ₹99 lifetime membership for one account; Checkout collects the payment. */
export function createOrder(userId: string): Promise<Order> {
  return call<Order>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: PRICE_PAISE,
      currency: "INR",
      receipt: `docent-${Date.now()}`,
      notes: { product: MEMBERSHIP_NOTE, userId },
    }),
  });
}

export type Payment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  order_id: string | null;
  notes: Record<string, string> | unknown[];
};

export function fetchPayment(id: string): Promise<Payment> {
  return call<Payment>(`/payments/${encodeURIComponent(id)}`);
}

export function fetchOrder(id: string): Promise<Order & { notes: Record<string, string> | unknown[] }> {
  return call(`/orders/${encodeURIComponent(id)}`);
}

/** Whether an order is a Docent membership order created for `userId`. */
export async function orderBelongsTo(orderId: string, userId: string): Promise<boolean> {
  const order = await fetchOrder(orderId);
  return !Array.isArray(order.notes) && order.notes?.product === MEMBERSHIP_NOTE && order.notes?.userId === userId;
}

/** Whether a payment is a completed ₹99 Docent membership bought by `userId`. */
export async function isMembershipPayment(payment: Payment, userId: string): Promise<boolean> {
  if (payment.status !== "captured" && payment.status !== "authorized") return false;
  if (payment.amount !== PRICE_PAISE || payment.currency !== "INR" || !payment.order_id) return false;
  return orderBelongsTo(payment.order_id, userId);
}
