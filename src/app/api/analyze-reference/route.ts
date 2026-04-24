import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 120;
export const runtime = "nodejs";

type ImageInline = { mimeType: string; data: string };

function dataUrlToInline(dataUrl: string): ImageInline | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    storyPremise: { type: "string" },
    newScenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
          emotion: { type: "string" },
          durationSec: { type: "number" },
        },
        required: ["index", "text", "emotion", "durationSec"],
      },
    },
  },
  required: ["storyPremise", "newScenes"],
};

function buildResearchPrompt(productName: string): string {
  return `당신은 한국 시장 제품 리서처입니다. 제품에 얽힌 **놀라운 뒷이야기·반전·역사 썰** 찾아주세요.

상품: ${productName}

## 조사 항목
1. 이름/디자인/형태의 숨겨진 유래
2. 창업자/개발자 에피소드 (특히 실패나 우연)
3. 시대적 맥락이나 당시 히트한 진짜 이유
4. 다른 나라·문화와의 차이
5. 가격/용량/크기 뒤의 심리나 전략

## 출력 형식
- 각 썰은 "헐 진짜?" 반응 나올 만한 것
- 가짜 추측 금지, 검증 가능한 실제 사실만
- 10줄 이내, 마크다운`;
}

function buildScriptPromptFromAngle(args: {
  productName: string;
  angle: string;
  hook: string | null;
  fact: string | null;
  sources: string[] | null;
}): string {
  const { productName, angle, hook, fact, sources } = args;
  return `당신은 **조회수 100만 쇼츠 작가**입니다.
이미 정해진 "썰"을 받아서 50초 쇼츠 대본 (5씬 × 10초)으로 각색하는 일만 합니다.

## 🎯 반드시 사용할 썰 (이게 유일한 소재입니다)

제품: ${productName}
앵글 (제목): ${angle}
${hook ? `훅 (첫 줄로 쓸 수 있는 문장): ${hook}` : ""}
${fact ? `팩트 (실제 내용):\n${fact}` : ""}
${sources && sources.length > 0 ? `출처:\n${sources.map((u) => `- ${u}`).join("\n")}` : ""}

## 🚨 규칙

1. **위 팩트만 사용**. 새로운 정보 만들어내지 말 것. 팩트 안에서 있는 재료로만 5씬 구성.
2. **훅이 주어졌으면 씬 1은 그 훅으로 시작**.
3. 앵글을 한 번에 다 말하지 말고 **반전 구조**로 풀기:
   - 씬 1: 질문·호기심·공감 (훅) + 분위기 조성
   - 씬 2: 상황 설정 / 익숙한 전제 / 배경 정보
   - 씬 3: 반전 포인트 (팩트의 핵심) — 이 씬이 제일 길어도 OK
   - 씬 4: 부연 설명 / 숫자·디테일 / 충격 정보
   - 씬 5: 의미 부여 / 여운 있는 마무리
4. **각 씬 80~120자** (TTS로 10초에 읽히는 자연 분량)
   - 너무 빽빽하게 채우지 말고, 2~3문장으로 자연스럽게 호흡
   - 짧은 대사나 감탄어("근데...", "그런데 사실은...") 사이사이 넣으면 좋음
5. 구어체 내레이션/혼잣말. 과도한 마케팅 톤 금지.
6. 제품명은 **0~1번만** 언급.
7. "좋다/편하다/후회 안 해요" 같은 평가어 금지. CTA 금지.

## 출력 JSON

- storyPremise: 이 쇼츠의 시청자 경험을 2~3줄로 (팩트를 어떻게 풀지)
- newScenes: **정확히 5씬** (index 0~4, **durationSec 10**, emotion 1단어, text 80~120자)`;
}

function buildScriptPromptFreeform(
  topic: string,
  research: string,
  productName: string,
): string {
  return `당신은 **한국 감성 쇼트 스토리 작가**입니다.

## 입력

제품: ${productName}
주제/테마: ${topic}

## 리서치 (아래 사실 범위 안에서만 씬 만들기)
${research}

## 규칙
- 광고 금지. 숨겨진 뒷이야기·반전·호기심 자극.
- **5씬 × 10초 = 50초 쇼츠**. 각 씬 **80~120자** (2~3문장).
- 씬 1은 강한 훅 + 상황 조성. 씬 3은 반전 핵심. 씬 5는 여운.
- 제품명 0~1번만. "좋다/편하다" 평가어 금지. CTA 금지.

## 출력 JSON
- storyPremise (2~3줄)
- newScenes: 정확히 5씬 (index 0~4, **durationSec 10**)`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      storyTopic = "",
      productName,
      productImageDataUrls = [],
      angleData = null,
    } = await req.json();

    if (!productName || typeof productName !== "string") {
      return NextResponse.json(
        { error: "상품명을 입력하세요." },
        { status: 400 },
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const ai = getGeminiClient();

    let research = "";
    let scriptPrompt: string;

    if (
      angleData &&
      typeof angleData === "object" &&
      (angleData.angle || angleData.hook || angleData.fact)
    ) {
      // 라이브러리 썰이 있으면 웹 리서치 생략, 그 썰을 바로 각색
      research = angleData.fact || "";
      scriptPrompt = buildScriptPromptFromAngle({
        productName,
        angle: angleData.angle || storyTopic,
        hook: angleData.hook || null,
        fact: angleData.fact || null,
        sources: angleData.sources || null,
      });
    } else {
      // Fallback: 기존 방식 (웹 리서치 후 대본 생성)
      const productImageParts: Part[] = (productImageDataUrls as string[])
        .map(dataUrlToInline)
        .filter((v): v is ImageInline => v !== null)
        .map((v) => ({ inlineData: v }));

      const researchContents: Content[] = [
        {
          role: "user",
          parts: [
            ...productImageParts,
            { text: buildResearchPrompt(productName) },
          ],
        },
      ];

      const researchResponse = await withRetry(() =>
        ai.models.generateContent({
          model: FLASH_MODEL,
          contents: researchContents,
          config: { tools: [{ googleSearch: {} }] },
        }),
      );

      research = researchResponse.text || "";
      if (!research) {
        return NextResponse.json(
          { error: "상품 리서치 응답이 비어있습니다." },
          { status: 500 },
        );
      }

      scriptPrompt = buildScriptPromptFreeform(
        storyTopic,
        research,
        productName,
      );
    }

    const scriptResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: scriptPrompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCRIPT_SCHEMA,
        },
      }),
    );

    const text = scriptResponse.text;
    if (!text) {
      return NextResponse.json(
        { error: "대본 생성 응답이 비어있습니다." },
        { status: 500 },
      );
    }

    const parsed = JSON.parse(text);

    return NextResponse.json({
      storyPremise: parsed.storyPremise,
      scenes: parsed.newScenes,
      productResearch: research,
      usedAngle: !!angleData,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
