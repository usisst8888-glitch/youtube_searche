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
## ⚠️ CRITICAL RULE 2 — PRODUCT MUST APPEAR (EXACT MATCH)
- The reference images labeled "ACTUAL PRODUCT" are the product that MUST appear in this scene.
- The product is REQUIRED in every single scene — it can be held by the character, placed on a surface, in the background, or the focal subject. Prominent or subtle is fine, but it MUST be visible somewhere in the frame.
- The product must be the EXACT same one as the reference images:
  • Same shape, silhouette, color, material, distinctive features
  • Same logo/branding position (rendered visually without readable text)
  • Same proportions and form factor
- DO NOT substitute, generalize, or invent a different product.
- Render the product in the ${stylePrompt} art style — but keep its identity instantly recognizable.
- If the narration doesn't explicitly mention the product, still place it naturally in the environment (on a desk, held, nearby) so every scene visually contains the product.`
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
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "9:16" },
        },
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
