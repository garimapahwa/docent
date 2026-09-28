import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Voice lines are signed so /api/voice only speaks captions Docent itself produced.
 * Without this, anyone could use the endpoint to spend the ElevenLabs credits on any text.
 */
function secret(): string | null {
  const explicit = process.env.VOICE_SIGNING_SECRET;
  if (explicit) return explicit;
  const key = process.env.ELEVENLABS_API_KEY;
  return key ? createHash("sha256").update(`docent-voice:${key}`).digest("hex") : null;
}

export function voiceEnabled(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

function sign(text: string, s: string): string {
  return createHmac("sha256", s).update(text).digest("base64url").slice(0, 32);
}

/** URL the player loads for one caption, or null if voice isn't configured. */
export function voiceUrl(text: string): string | null {
  const s = secret();
  if (!s || !voiceEnabled()) return null;
  return `/api/voice?text=${encodeURIComponent(text)}&t=${sign(text, s)}`;
}

export function verifyVoiceToken(text: string, token: string): boolean {
  const s = secret();
  if (!s) return false;
  const expected = Buffer.from(sign(text, s));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
