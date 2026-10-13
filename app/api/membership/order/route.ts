import { NextResponse } from "next/server";
import { blocked, paywallEnabled, readAccess } from "@/lib/membership";
import { createOrder } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/membership/order → a Razorpay order for the ₹99 membership, tied to this account. */
export async function POST() {
  if (!paywallEnabled()) return NextResponse.json({ error: "Payments aren't set up." }, { status: 503 });
  const access = await readAccess();
  if (!access.userId) return blocked("sign_in");
  if (access.member) return NextResponse.json({ error: "You're already a member." }, { status: 409 });
  try {
    const order = await createOrder(access.userId);
    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("[/api/membership/order]", err);
    return NextResponse.json({ error: "Couldn't start the payment. Please try again." }, { status: 502 });
  }
}
