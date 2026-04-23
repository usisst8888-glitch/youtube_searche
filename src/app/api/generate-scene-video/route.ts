import { NextRequest, NextResponse } from "next/server";
import { getFal } from "@/lib/fal";

export const maxDuration = 300;
export const runtime = "nodejs";

type LtxResult = {
  video?: { url?: string };
};

async function uploadDataUrlToFal(dataUrl: string): Promise<string> {
  const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!match) throw new Error("invalid dataUrl");
  const mime = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const fal = getFal();
  const file = new File([buffer], "scene.png", { type: mime });
  return fal.storage.upload(file);
}

export async function POST(req: NextRequest) {
  try {
    const { imageDataUrl, sceneText, emotion, durationSec = 5 } =
      await req.json();

    if (!imageDataUrl) {
      return NextResponse.json(
        { error: "imageDataUrl이 필요합니다." },
        { status: 400 },
      );
    }
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: "FAL_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const imageUrl = await uploadDataUrlToFal(imageDataUrl);

    const prompt = `Short vertical cinematic shot. Emotion: ${emotion}. Narration context: "${sceneText}". Subtle character motion, gentle camera movement, keep the art style consistent with the input image.`;

    const fal = getFal();
    const result = await fal.subscribe(
      "fal-ai/ltxv-13b-098-distilled/image-to-video",
      {
        input: {
          prompt,
          image_url: imageUrl,
          num_frames: Math.min(161, Math.round(durationSec * 24)),
          aspect_ratio: "9:16",
        },
        logs: false,
      },
    );

    const data = result.data as LtxResult;
    const videoUrl = data.video?.url;
    if (!videoUrl) {
      return NextResponse.json(
        { error: "비디오 URL이 반환되지 않았습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({ videoUrl });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
