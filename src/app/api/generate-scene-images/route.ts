import { NextRequest, NextResponse } from "next/server";
import { getFal } from "@/lib/fal";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 300;
export const runtime = "nodejs";

// FAL nano-banana = Gemini 2.5 Flash Image (이미지당 약 60원)
// 모든 씬 이미지는 text-to-image로 생성 — 씬 대본 내용을 정확히 반영하기 위해
const IMAGE_MODEL = "fal-ai/nano-banana";

type SceneIn = {
  index: number;
  text: string;
  emotion: string;
  durationSec?: number;
};

type GenItem = {
  sceneIndex: number;
  slot: number;
  dataUrl: string;
  prompt: string;
  error?: string;
};

async function generateStyleGuide(
  storyTopic: string,
  storyPremise: string,
): Promise<string> {
  try {
    const ai = getGeminiClient();
    const prompt = `당신은 9:16 한국 쇼츠 영상의 아트디렉터입니다.
영상 전체에 일관되게 적용할 단 하나의 비주얼 스타일을 영어로 작성하세요.

주제: ${storyTopic}
프레미스: ${storyPremise}

요건:
- art direction (예: 3D pixar style, anime, watercolor, claymation 등)
- 색감 팔레트
- 조명
- 카메라 분위기
- 인물이 등장한다면 외형 한 명 고정 묘사 (옷, 헤어스타일, 체형) — 모든 씬에서 동일하게 보여야 함
- **특정 제품/브랜드/상품 묘사는 금지** — 스토리 분위기와 인물에만 집중

영어로 150~250자 한 문단. JSON 출력.`;
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: { styleGuide: { type: "string" } },
            required: ["styleGuide"],
          },
        },
      }),
    );
    const data = JSON.parse(res.text || "{}");
    return (
      (data.styleGuide as string) ||
      "cinematic 3D animation, vibrant pastel palette, soft warm lighting, cheerful mood"
    );
  } catch {
    return "cinematic 3D animation, vibrant pastel palette, soft warm lighting, cheerful mood";
  }
}

async function generateScenePrompt(
  scene: SceneIn,
  storyTopic: string,
  storyPremise: string,
): Promise<string> {
  try {
    const ai = getGeminiClient();
    const prompt = `당신은 쇼츠 영상 스토리보드 아티스트입니다.
한국어 씬 대본의 **내용을 정확히 시각화**할 영어 이미지 프롬프트를 작성하세요.
**대사가 아니라 시청자가 화면에서 보게 될 구체적인 장면**을 그려야 합니다.

## 영상 컨텍스트
주제: ${storyTopic}
프레미스: ${storyPremise}

## 이번 씬
대본: "${scene.text}"
감정: ${scene.emotion}
길이: ${scene.durationSec || 5}초

## 작성 규칙
1. 대본이 말하는 **순간/사건/행동**을 프레임으로 옮기세요 (대사 자체를 묘사 X)
2. 다음을 명시:
   - **Subject (주체)**: 누가/무엇이 화면 중심에 있는지 — 인물·표정·동작 위주
   - **Action (행동)**: 그 주체가 무엇을 하고 있는지
   - **Setting (배경)**: 어디에서 일어나고 있는지
   - **Mood/Lighting (분위기)**: 감정에 맞는 톤
   - **Camera angle (카메라)**: close-up / medium shot / wide / overhead 등
3. 9:16 세로 쇼츠 구도
4. 200~350자 영어로 자연스러운 묘사문
5. **자막/텍스트/말풍선/UI 절대 없음** — 순수 시각 장면만
6. ⚠️ **특정 제품·브랜드·로고·포장지 묘사는 절대 금지** — 인물의 행동·표정·감정·환경에만 집중. 어떤 사물도 클로즈업하지 말고 사람 위주로 그리세요.

## 예시
대본: "그런데 사실 여기엔 비밀이 있어요"
→ "Medium shot of a young Korean woman in a cozy cafe leaning forward with a curious expression and a finger raised to her lips, eyes sparkling with intrigue. Warm afternoon sunlight streams through window blinds casting striped shadows on her face. Cozy intimate atmosphere, slight Dutch tilt for mystery, vertical 9:16 frame, cinematic shallow depth of field."

JSON 출력.`;
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: { scenePrompt: { type: "string" } },
            required: ["scenePrompt"],
          },
        },
      }),
    );
    const data = JSON.parse(res.text || "{}");
    return (data.scenePrompt as string) || scene.text;
  } catch {
    return scene.text;
  }
}

async function generateImage(fullPrompt: string): Promise<string> {
  const fal = getFal();
  const result = await fal.subscribe(IMAGE_MODEL, {
    input: {
      prompt: fullPrompt,
      num_images: 1,
      output_format: "jpeg",
      aspect_ratio: "9:16",
    },
    logs: false,
  });
  const url = (result.data as { images?: { url: string }[] }).images?.[0]?.url;
  if (!url) throw new Error("이미지 URL 없음");
  return url;
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 다운로드 실패: ${res.status}`);
  const buf = await res.arrayBuffer();
  const ct = res.headers.get("content-type") || "image/jpeg";
  return `data:${ct};base64,${Buffer.from(buf).toString("base64")}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode: "all" | "scene" | "image" = body.mode || "all";
    const scenes: SceneIn[] = body.scenes || [];
    const storyTopic: string = body.storyTopic || "";
    const storyPremise: string = body.storyPremise || "";
    const imagesPerScene: number = Math.max(
      1,
      Math.min(6, body.imagesPerScene || 3),
    );
    const sceneIndex: number | undefined = body.sceneIndex;
    const slot: number | undefined = body.slot;

    if (!Array.isArray(scenes) || scenes.length === 0) {
      return NextResponse.json(
        { error: "scenes 배열이 필요합니다." },
        { status: 400 },
      );
    }
    if (!process.env.FAL_KEY) {
      return NextResponse.json(
        { error: "FAL_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    // 1) 스타일 가이드 — 입력으로 받은 게 있으면 재사용 (재생성 시 일관성 유지)
    const styleGuide: string =
      body.styleGuide ||
      (await generateStyleGuide(storyTopic, storyPremise));

    // 2) 씬별 프롬프트 — 누락된 씬만 생성 (병렬)
    const scenePrompts: Record<number, string> = {
      ...(body.scenePrompts || {}),
    };
    const needsPrompt = scenes.filter((s) => !scenePrompts[s.index]);
    if (needsPrompt.length > 0) {
      const generated = await Promise.all(
        needsPrompt.map((s) =>
          generateScenePrompt(s, storyTopic, storyPremise),
        ),
      );
      needsPrompt.forEach((s, i) => {
        scenePrompts[s.index] = generated[i];
      });
    }

    // 씬 내용 먼저, 스타일은 보조 — 프롬프트 순응도 우선
    // 강한 negative directive로 제품/브랜드 이미지 차단
    const buildFullPrompt = (idx: number) =>
      `LIFESTYLE STORYTELLING SCENE — people only, no commercial items.\n\n${scenePrompts[idx] || ""}\n\nVisual style throughout: ${styleGuide}\n\n9:16 vertical aspect ratio. Focus exclusively on people (faces, expressions, gestures, body language) and environments (rooms, streets, nature). Treat this like a candid documentary photo or movie still about a person, not a product shoot.\n\nABSOLUTE NEGATIVE — DO NOT INCLUDE: product packaging, brand logos, branded items, product close-ups, food packaging, beverage bottles or cartons, snack bags, advertising imagery, store shelves with products, commercial photography style, e-commerce style images, isolated objects on white backgrounds.\n\nALSO EXCLUDE: text overlays, captions, subtitles, watermarks, UI elements, speech bubbles, any written words or letters in the image.`;

    // 3) 생성 대상 결정
    const targets: { sceneIndex: number; slot: number }[] = [];
    if (mode === "image") {
      if (sceneIndex === undefined || slot === undefined) {
        return NextResponse.json(
          { error: "sceneIndex, slot 필요" },
          { status: 400 },
        );
      }
      targets.push({ sceneIndex, slot });
    } else if (mode === "scene") {
      if (sceneIndex === undefined) {
        return NextResponse.json(
          { error: "sceneIndex 필요" },
          { status: 400 },
        );
      }
      for (let i = 0; i < imagesPerScene; i++) {
        targets.push({ sceneIndex, slot: i });
      }
    } else {
      for (const s of scenes) {
        for (let i = 0; i < imagesPerScene; i++) {
          targets.push({ sceneIndex: s.index, slot: i });
        }
      }
    }

    // 4) 모든 이미지 병렬 생성 — 각자 자기 씬 프롬프트로 (text-to-image)
    const results: GenItem[] = await Promise.all(
      targets.map(async (t): Promise<GenItem> => {
        const fullPrompt = buildFullPrompt(t.sceneIndex);
        try {
          const url = await generateImage(fullPrompt);
          const dataUrl = await urlToDataUrl(url);
          return {
            sceneIndex: t.sceneIndex,
            slot: t.slot,
            dataUrl,
            prompt: fullPrompt,
          };
        } catch (e) {
          return {
            sceneIndex: t.sceneIndex,
            slot: t.slot,
            dataUrl: "",
            prompt: fullPrompt,
            error: e instanceof Error ? e.message : "fail",
          };
        }
      }),
    );

    return NextResponse.json({
      styleGuide,
      scenePrompts,
      anchorImageUrl: "",
      images: results,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
