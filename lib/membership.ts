import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/tx/model";

/**
 * Free checks and the ₹99 lifetime membership, stored on the visitor's Clerk account
 * (private metadata, which only the server can read or write):
 *  - Checking a transaction needs an account. Each account gets FREE_CHECKS different
 *    transactions free; opening one of those again stays free.
 *  - Members check without limits, on any device they sign in on.
 *  - Links shared from Docent and the demo examples carry a signed tag and are always free,
 *    even without an account.
 * The paywall is off (everything free, no sign-in) until both Clerk and Razorpay keys are set.
 */
export const FREE_CHECKS = 2;
export const PRICE_PAISE = 9900;
export const PRICE_LABEL = "₹99";
export const MEMBERSHIP_NOTE = "docent-lifetime";

export function authEnabled(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

export function paywallEnabled(): boolean {
  return authEnabled() && Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function secret(): string {
  return createHash("sha256").update(`docent-membership:${process.env.RAZORPAY_KEY_SECRET ?? ""}`).digest("hex");
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url").slice(0, 32);
}

function verify(value: string, signature: string): boolean {
  const expected = Buffer.from(sign(value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Short, stable id for a transaction signature or a pasted transaction. */
export function checkKey(input: string): string {
  return createHash("sha256").update(input).digest("base64url").slice(0, 12);
}

/** Tag for a link shared from Docent: opening it never needs an account or a free check. */
export function shareTag(signature: string): string | null {
  return paywallEnabled() ? sign(`share:${signature}`) : null;
}

/** Tag for a demo transaction built by Docent itself. */
export function demoTag(transaction: string): string | null {
  return paywallEnabled() ? sign(`demo:${checkKey(transaction)}`) : null;
}

export function validShareTag(signature: string, tag: string | null | undefined): boolean {
  return Boolean(tag) && verify(`share:${signature}`, tag!);
}

export function validDemoTag(transaction: string, tag: string | null | undefined): boolean {
  return Boolean(tag) && verify(`demo:${checkKey(transaction)}`, tag!);
}

/** Razorpay's checkout signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export function validPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = Buffer.from(
    createHmac("sha256", process.env.RAZORPAY_KEY_SECRET ?? "").update(`${orderId}|${paymentId}`).digest("hex"),
  );
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** What Docent keeps on the account, under privateMetadata.docent. */
type DocentMetadata = { used?: string[]; member?: boolean; paymentId?: string };

export type Access = {
  userId: string | null;
  member: boolean;
  /** Transactions already checked for free (hashed). */
  used: string[];
};

const ANONYMOUS: Access = { userId: null, member: false, used: [] };

export async function readAccess(): Promise<Access> {
  if (!paywallEnabled()) return ANONYMOUS;
  const { userId } = await auth();
  if (!userId) return ANONYMOUS;
  const user = await (await clerkClient()).users.getUser(userId);
  const meta = (user.privateMetadata?.docent ?? {}) as DocentMetadata;
  return { userId, member: meta.member === true, used: Array.isArray(meta.used) ? meta.used.slice(0, FREE_CHECKS) : [] };
}

export function freeLeft(access: Access): number | null {
  if (!paywallEnabled() || !access.userId || access.member) return null;
  return Math.max(0, FREE_CHECKS - access.used.length);
}

export type Decision =
  | { allowed: true; record: string | null }
  | { allowed: false; reason: "sign_in" | "pay" };

/**
 * Whether this visitor may check `key` (a hashed transaction), and what to record if so.
 * `free` covers shared links and demos.
 */
export function decide(access: Access, key: string, free: boolean): Decision {
  if (!paywallEnabled() || free) return { allowed: true, record: null };
  if (!access.userId) return { allowed: false, reason: "sign_in" };
  if (access.member || access.used.includes(key)) return { allowed: true, record: null };
  if (access.used.length >= FREE_CHECKS) return { allowed: false, reason: "pay" };
  return { allowed: true, record: key };
}

async function saveMetadata(userId: string, docent: DocentMetadata) {
  await (await clerkClient()).users.updateUserMetadata(userId, { privateMetadata: { docent } });
}

/** Saves a newly used free check on the account. */
export async function recordUse(access: Access, key: string) {
  if (!access.userId) return;
  await saveMetadata(access.userId, { member: access.member, used: [...access.used, key].slice(0, FREE_CHECKS) });
}

/** Makes the account a lifetime member, tied to the Razorpay payment. */
export async function grantMembership(access: Access, paymentId: string) {
  if (!access.userId) return;
  await saveMetadata(access.userId, { member: true, used: access.used, paymentId });
}

function apiError(code: "payment_required" | "sign_in_required", message: string, status: number) {
  return NextResponse.json<ApiError>({ error: { code, message } }, { status });
}

/** 401/402 response for a blocked check; the page shows the sign-in or membership card. */
export function blocked(reason: "sign_in" | "pay") {
  return reason === "sign_in"
    ? apiError("sign_in_required", `Sign in to check transactions. You get ${FREE_CHECKS} free checks.`, 401)
    : apiError(
        "payment_required",
        `You've used your ${FREE_CHECKS} free checks. Become a member for ${PRICE_LABEL} (one time) for unlimited checks.`,
        402,
      );
}

/**
 * Whether a transaction may be shown in full (storyboard, price check). The page passes the
 * share tag it got with the explanation, so this rarely needs to look up the account.
 */
export async function mayView(key: string, sharedOk: boolean): Promise<boolean> {
  if (!paywallEnabled() || sharedOk) return true;
  const access = await readAccess();
  return access.member || access.used.includes(key);
}
