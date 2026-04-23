import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, withRetry } from "@/lib/gemini";

export const maxDuration = 60;
export const runtime = "nodejs";

const IMAGE_MODEL = "gemini-2.5-flash-image";

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

    const hasProduct = productParts.length > 0;

    const textPrompt = `You are generating scene ${sceneIndex + 1} of a Korean short-form storytelling video.

## Visual style
${stylePrompt}

## This scene's script (narration context, NOT to render as text)
"${sceneText}"

## Emotion / mood for this scene
${emotion}

## ⚠️ CRITICAL RULE 1 — NO TEXT IN THE IMAGE
- DO NOT include any text, letters, words, Korean characters (Hangul), numbers, subtitles, captions, speech bubbles, labels, watermarks, signs, logos with readable text, or any written content ANYWHERE in the image.
- The image must be pure visual imagery. Zero typography.
- If a character is shown speaking, show only their mouth/expression — no speech bubble, no text.
${
  hasProduct
    ? `
## ⚠️ CRITICAL RULE 2 — EXACT PRODUCT MATCH
- The FIRST image(s) attached at the beginning of this prompt are reference images of the ACTUAL product.
- If the product appears in this scene, it MUST be the EXACT same product as those reference images.
- Preserve the product's exact shape, color, form factor, proportions, and distinctive features.
- DO NOT substitute with a similar/generic product. DO NOT invent a product.
- DO render the product in the ${stylePrompt} art style — but keep its identity recognizable.
- If the scene doesn't naturally need the product visible, it's OK to keep it out of frame rather than adding a wrong product.`
    : ""
}

## Composition guidelines
- Vertical 9:16 aspect ratio (Korean Shorts format)
- ONE clear focal subject, clean background, strong storytelling composition
- Expressive character pose reflecting the "${emotion}" mood
${previousImageDataUrl ? "- Maintain the SAME main character, outfit, face, body type, hair, and overall art direction as the previous-scene reference image" : "- Establish the main character design (age, gender, look) so later scenes can reuse it"}

Return a single image. No text. Just visuals.`;

    const parts: Part[] = [];
    if (productParts.length > 0) {
      parts.push({
        text: "=== REFERENCE IMAGES: THE ACTUAL PRODUCT (must be preserved exactly in the output) ===",
      });
      parts.push(...productParts);
    }
    if (prevPart.length > 0) {
      parts.push({
        text: "=== REFERENCE IMAGE: PREVIOUS SCENE (for character + art style consistency only, not the product) ===",
      });
      parts.push(...prevPart);
    }
    parts.push({ text: textPrompt });

    const contents: Content[] = [{ role: "user", parts }];

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: IMAGE_MODEL,
        contents,
      }),
    );

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
