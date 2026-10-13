import { NextResponse, type NextRequest } from "next/server";
import { blocked, grantMembership, paywallEnabled, readAccess } from "@/lib/membership";
import { fetchPayment, isMembershipPayment } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/membership/restore { paymentId } → for someone whose payment went through but the
 * page didn't confirm it (e.g. the connection dropped). Only a completed ₹99 membership payment
 * made from this same account counts. The payment ID (pay_…) is in Razorpay's receipt email.
 */
export async function POST(req: NextRequest) {
  if (!paywallEnabled()) return NextResponse.json({ error: "Payments aren't set up." }, { status: 503 });
  const access = await readAccess();
  if (!access.userId) return blocked("sign_in");

  const body = (await req.json().catch(() => null)) as { paymentId?: unknown } | null;
  const paymentId = typeof body?.paymentId === "string" ? body.paymentId.trim() : "";
  if (!/^pay_[A-Za-z0-9]{6,30}$/.test(paymentId)) {
    return NextResponse.json({ error: "That doesn't look like a Razorpay payment ID (it starts with pay_)." }, { status: 400 });
  }
  try {
    if (!(await isMembershipPayment(await fetchPayment(paymentId), access.userId))) {
      return NextResponse.json({ error: "That isn't a completed Docent membership payment from this account." }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "We couldn't find that payment. Check the ID in your receipt email." }, { status: 404 });
  }
  await grantMembership(access, paymentId);
  return NextResponse.json({ member: true });
}
