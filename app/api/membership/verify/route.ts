import { NextResponse, type NextRequest } from "next/server";
import { blocked, grantMembership, paywallEnabled, readAccess, validPaymentSignature } from "@/lib/membership";
import { orderBelongsTo } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/membership/verify → after Checkout succeeds. Razorpay signs order_id|payment_id
 * with our key secret, so a valid signature proves this payment was made for our order; the
 * order must also have been created for this account.
 */
export async function POST(req: NextRequest) {
  if (!paywallEnabled()) return NextResponse.json({ error: "Payments aren't set up." }, { status: 503 });
  const access = await readAccess();
  if (!access.userId) return blocked("sign_in");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const orderId = typeof body?.razorpay_order_id === "string" ? body.razorpay_order_id : "";
  const paymentId = typeof body?.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
  const signature = typeof body?.razorpay_signature === "string" ? body.razorpay_signature : "";
  if (!orderId || !paymentId || !validPaymentSignature(orderId, paymentId, signature)) {
    return NextResponse.json({ error: "We couldn't confirm this payment." }, { status: 400 });
  }
  try {
    if (!(await orderBelongsTo(orderId, access.userId))) {
      return NextResponse.json({ error: "This payment belongs to a different account." }, { status: 403 });
    }
    await grantMembership(access, paymentId);
  } catch (err) {
    console.error("[/api/membership/verify]", err);
    return NextResponse.json({ error: "Payment received, but we couldn't save it. Please contact us." }, { status: 502 });
  }
  return NextResponse.json({ member: true });
}
