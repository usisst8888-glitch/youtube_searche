import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const runtime = "nodejs";

const TYPECAST_BASE = "https://typecast.ai/api";

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function POST(req: NextRequest) {
  try {
    const { text, actorId, emotionTone, pitch = 0, speed = 1 } =
      await req.json();

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

    // Submit a speech synthesis job
    const submitRes = await fetch(`${TYPECAST_BASE}/speak`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        lang: "auto",
        actor_id: actorId || "5c3c3f7c5d3b9d00079f6a4a",
        tempo: speed,
        pitch,
        emotion_tone_preset: emotionTone || "normal-1",
        xapi_hd: true,
        model_version: "latest",
      }),
    });

    if (!submitRes.ok) {
      const body = await submitRes.text();
      return NextResponse.json(
        { error: `Typecast 요청 실패: ${submitRes.status} ${body}` },
        { status: 500 },
      );
    }

    const submitData = await submitRes.json();
    const pollUrl: string | undefined =
      submitData?.result?.speak_v2_url || submitData?.result?.speak_url;

    if (!pollUrl) {
      return NextResponse.json(
        { error: "Typecast 응답에 poll URL이 없습니다." },
        { status: 500 },
      );
    }

    // Poll until done
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
        audioUrl = pollData?.result?.audio?.url || pollData?.result?.audio_download_url;
        break;
      }
      if (status === "failed" || status === "error") {
        return NextResponse.json(
          { error: "Typecast 합성 실패" },
          { status: 500 },
        );
      }
    }

    if (!audioUrl) {
      return NextResponse.json(
        { error: "Typecast 합성 타임아웃" },
        { status: 500 },
      );
    }

    return NextResponse.json({ audioUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
