import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const runtime = "nodejs";

const TYPECAST_BASE = "https://typecast.ai/api";
const GOOGLE_TTS = "https://texttospeech.googleapis.com/v1/text:synthesize";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

type TtsResult = {
  audioUrl: string;
  provider: "typecast" | "google";
};

async function googleTts(args: {
  text: string;
  voice?: string;
  pitch?: number;
  speed?: number;
}): Promise<TtsResult> {
  const apiKey =
    process.env.GEMINI_API_KEY || process.env.YOUTUBE_API_KEY || "";
  if (!apiKey) {
    throw new Error("Google TTS용 API 키(GEMINI/YOUTUBE)가 없습니다.");
  }
  const res = await fetch(`${GOOGLE_TTS}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text: args.text },
      voice: {
        languageCode: "ko-KR",
        name: args.voice || "ko-KR-Wavenet-A",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: args.speed ?? 1,
        pitch: args.pitch ?? 0,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (msg.includes("has not been used") || msg.includes("disabled")) {
      throw new Error(
        `Cloud Text-to-Speech API가 활성화되지 않았습니다. https://console.cloud.google.com/apis/library/texttospeech.googleapis.com 에서 활성화 후 재시도하세요.`,
      );
    }
    throw new Error(`Google TTS 실패: ${msg}`);
  }
  const audioContent: string | undefined = data.audioContent;
  if (!audioContent) throw new Error("Google TTS 응답에 audioContent 없음");
  return {
    audioUrl: `data:audio/mp3;base64,${audioContent}`,
    provider: "google",
  };
}

async function typecastTts(args: {
  text: string;
  actorId?: string;
  emotionTone?: string;
  pitch?: number;
  speed?: number;
}): Promise<TtsResult> {
  const apiKey = process.env.TYPECAST_API_KEY;
  if (!apiKey) throw new Error("TYPECAST_API_KEY가 없습니다.");

  const submitRes = await fetch(`${TYPECAST_BASE}/speak`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: args.text,
      lang: "auto",
      actor_id: args.actorId || "5c3c3f7c5d3b9d00079f6a4a",
      tempo: args.speed ?? 1,
      pitch: args.pitch ?? 0,
      emotion_tone_preset: args.emotionTone || "normal-1",
      xapi_hd: true,
      model_version: "latest",
    }),
  });
  if (!submitRes.ok) {
    const body = await submitRes.text();
    throw new Error(`Typecast ${submitRes.status}: ${body.slice(0, 200)}`);
  }

  const submitData = await submitRes.json();
  const pollUrl: string | undefined =
    submitData?.result?.speak_v2_url || submitData?.result?.speak_url;
  if (!pollUrl) throw new Error("Typecast 응답에 poll URL 없음");

  let audioUrl: string | null = null;
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const pollRes = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!pollRes.ok) continue;
    const pollData = await pollRes.json();
    const status = pollData?.result?.status;
    if (status === "done") {
      audioUrl =
        pollData?.result?.audio?.url ||
        pollData?.result?.audio_download_url ||
        null;
      break;
    }
    if (status === "failed" || status === "error") {
      throw new Error("Typecast 합성 실패");
    }
  }
  if (!audioUrl) throw new Error("Typecast 합성 타임아웃");
  return { audioUrl, provider: "typecast" };
}

export async function POST(req: NextRequest) {
  try {
    const {
      text,
      actorId,
      emotionTone,
      pitch = 0,
      speed = 1,
      voice,
      provider,
    } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text가 필요합니다." },
        { status: 400 },
      );
    }

    const order: ("typecast" | "google")[] =
      provider === "google"
        ? ["google"]
        : provider === "typecast"
          ? ["typecast", "google"]
          : process.env.TYPECAST_API_KEY
            ? ["typecast", "google"]
            : ["google"];

    const errors: string[] = [];
    for (const p of order) {
      try {
        const result =
          p === "typecast"
            ? await typecastTts({ text, actorId, emotionTone, pitch, speed })
            : await googleTts({ text, voice, pitch, speed });
        return NextResponse.json({
          audioUrl: result.audioUrl,
          provider: result.provider,
          fallbackFrom: errors.length > 0 ? errors[0] : undefined,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "오류";
        errors.push(`[${p}] ${msg}`);
      }
    }

    return NextResponse.json(
      { error: errors.join(" | ") || "모든 TTS 제공자 실패" },
      { status: 500 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
