import { NextResponse, type NextRequest } from "next/server";
import { verifyVoiceToken } from "@/lib/voice/sign";

export const runtime = "nodejs";
export const maxDuration = 60;

// A calm narrator voice from ElevenLabs' default library; override with ELEVENLABS_VOICE_ID.
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";
const MAX_CHARS = 300;
/** Waits between retries when ElevenLabs is busy (the free plan allows 2 requests at once). */
const RETRY_DELAYS_MS = [800, 1600, 3200, 5000];

const AUDIO_HEADERS = {
  "Content-Type": "audio/mpeg",
  "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
};

function checkRequest(req: NextRequest): { text: string } | NextResponse {
  if (!process.env.ELEVENLABS_API_KEY) {
    return NextResponse.json({ error: "Voice is not configured." }, { status: 503 });
  }
  const text = req.nextUrl.searchParams.get("text") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!text || text.length > MAX_CHARS || !verifyVoiceToken(text, token)) {
    return NextResponse.json({ error: "Invalid voice request." }, { status: 403 });
  }
  return { text };
}

async function synthesize(text: string): Promise<Response> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const request = () =>
    fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY!,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

  let res = await request();
  for (const delay of RETRY_DELAYS_MS) {
    if (res.status !== 429) break;
    await new Promise((r) => setTimeout(r, delay));
    res = await request();
  }
  return res;
}

/** Speaks one signed caption. Responses are cached by the CDN, so each line is generated once. */
export async function GET(req: NextRequest) {
  const checked = checkRequest(req);
  if (checked instanceof NextResponse) return checked;

  const res = await synthesize(checked.text);
  if (!res.ok) {
    console.error("[/api/voice] ElevenLabs error", res.status, await res.text().catch(() => ""));
    return NextResponse.json({ error: "The voice service returned an error." }, { status: 502 });
  }
  return new NextResponse(res.body, { headers: AUDIO_HEADERS });
}

/** Players probe audio with HEAD; answer without generating speech (and spending credits). */
export async function HEAD(req: NextRequest) {
  const checked = checkRequest(req);
  if (checked instanceof NextResponse) return new NextResponse(null, { status: checked.status });
  return new NextResponse(null, { headers: { "Content-Type": "audio/mpeg" } });
}
