import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const runtime = "nodejs";

// Typecast 새 API (api.typecast.ai/v1, X-API-KEY 헤더, 응답 = MP3 바이너리)
const TYPECAST_BASE = "https://api.typecast.ai/v1";

// 기본 한국어 보이스 — Moonjung (여, ssfm-v30, 감정 다양)
const DEFAULT_VOICE_ID = "tc_68f9c6a72f0f04a417bb136f";

export async function POST(req: NextRequest) {
  try {
    const {
      text,
      voiceId,
      emotion,
    } = await req.json();

    const apiKey = process.env.TYPECAST_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "TYPECAST_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }
    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "text가 필요합니다." },
        { status: 400 },
      );
    }

    const res = await fetch(`${TYPECAST_BASE}/text-to-speech`, {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        voice_id: voiceId || DEFAULT_VOICE_ID,
        text,
        model: "ssfm-v30",
        language: "kor",
        prompt: {
          emotion_preset: emotion || "normal",
        },
        output: { audio_format: "mp3" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        {
          error: `Typecast ${res.status}: ${body.slice(0, 300)}`,
        },
        { status: 500 },
      );
    }

    const contentType = res.headers.get("content-type") || "";
    // 새 API: audio/mpeg 으로 직접 바이너리 반환
    if (contentType.startsWith("audio/") || contentType.includes("mpeg")) {
      const buf = await res.arrayBuffer();
      const base64 = Buffer.from(buf).toString("base64");
      const mime = contentType || "audio/mpeg";
      return NextResponse.json({
        audioUrl: `data:${mime};base64,${base64}`,
        provider: "typecast",
      });
    }

    // fallback: JSON 응답일 경우
    try {
      const data = await res.json();
      const url =
        data?.audio?.url ||
        data?.audio_download_url ||
        data?.result?.audio?.url;
      if (url) {
        return NextResponse.json({ audioUrl: url, provider: "typecast" });
      }
      return NextResponse.json(
        { error: "Typecast 응답 형식 미지원", raw: data },
        { status: 500 },
      );
    } catch {
      return NextResponse.json(
        { error: "Typecast 응답을 해석할 수 없습니다." },
        { status: 500 },
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
