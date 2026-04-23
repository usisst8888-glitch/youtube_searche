import { NextRequest, NextResponse } from "next/server";
import { getFal } from "@/lib/fal";

export const maxDuration = 180;
export const runtime = "nodejs";

type StableAudioResult = {
  audio_file?: { url?: string };
  audio?: { url?: string };
};

export async function POST(req: NextRequest) {
  try {
    const { prompt, durationSec = 30 } = await req.json();

    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "prompt가 필요합니다." },
        { status: 400 },
      );
    }
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: "FAL_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const fal = getFal();
    const result = await fal.subscribe("fal-ai/stable-audio", {
      input: {
        prompt,
        seconds_total: Math.min(47, Math.max(1, Math.round(durationSec))),
      },
      logs: false,
    });

    const data = result.data as StableAudioResult;
    const audioUrl = data.audio_file?.url || data.audio?.url;

    if (!audioUrl) {
      return NextResponse.json(
        { error: "BGM URL이 반환되지 않았습니다." },
        { status: 500 },
      );
    }
    return NextResponse.json({ audioUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
