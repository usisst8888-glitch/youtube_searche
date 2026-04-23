import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient } from "@/lib/gemini";

export const maxDuration = 60;
export const runtime = "nodejs";

const IMAGE_MODEL = "gemini-2.5-flash-image-preview";

type ImageInput = { mimeType: string; data: string };

function dataUrlToInlineData(dataUrl: string): ImageInput | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export async function POST(req: NextRequest) {
  try {
    const {
      sceneIndex,
      sceneText,
      emotion,
      stylePrompt,
      productDataUrls = [],
      previousImageDataUrl,
    } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    if (typeof sceneText !== "string" || !sceneText.trim()) {
      return NextResponse.json(
        { error: "sceneText가 필요합니다." },
        { status: 400 },
      );
    }

    const ai = getGeminiClient();

    const productParts: Part[] = (productDataUrls as string[])
      .map(dataUrlToInlineData)
      .filter((v): v is ImageInput => v !== null)
      .map((v) => ({ inlineData: v }));

    const prevInline = previousImageDataUrl
      ? dataUrlToInlineData(previousImageDataUrl)
      : null;
    const prevPart: Part[] = prevInline ? [{ inlineData: prevInline }] : [];

    const textPrompt = `You are generating scene ${sceneIndex + 1} of a Korean short-form storytelling video.

## Visual style
${stylePrompt}

## This scene's script
"${sceneText}"

## Emotion / mood for this scene
${emotion}

## Composition guidelines
- Vertical 9:16 aspect ratio (Korean Shorts format)
- ONE clear focal subject, clean background, strong storytelling composition
- Include the product (subtly integrate it into the story when relevant)
- Expressive character pose reflecting the "${emotion}" mood
${previousImageDataUrl ? "- Maintain the SAME main character, outfit, and overall art direction as the reference image provided" : "- Establish the main character design (age, gender, look) so later scenes can reuse it"}

Return a single image.`;

    const parts: Part[] = [
      ...productParts,
      ...prevPart,
      { text: textPrompt },
    ];

    const contents: Content[] = [{ role: "user", parts }];

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents,
    });

    const candidates = response.candidates || [];
    for (const cand of candidates) {
      const innerParts = cand.content?.parts || [];
      for (const p of innerParts) {
        if (p.inlineData?.data) {
          const mime = p.inlineData.mimeType || "image/png";
          const dataUrl = `data:${mime};base64,${p.inlineData.data}`;
          return NextResponse.json({ imageDataUrl: dataUrl });
        }
      }
    }

    return NextResponse.json(
      { error: "Gemini가 이미지를 반환하지 않았습니다." },
      { status: 500 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
