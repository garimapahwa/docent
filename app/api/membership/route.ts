import { NextResponse } from "next/server";
import type { MembershipStatus } from "@/lib/api";
import { FREE_CHECKS, PRICE_LABEL, freeLeft, paywallEnabled, readAccess } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/membership → sign-in state, membership and free checks left for this visitor. */
export async function GET() {
  const access = await readAccess();
  return NextResponse.json<MembershipStatus>({
    enabled: paywallEnabled(),
    signedIn: access.userId !== null,
    member: access.member,
    freeLeft: freeLeft(access),
    freeChecks: FREE_CHECKS,
    price: PRICE_LABEL,
  });
}
