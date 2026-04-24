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
  return `당신은 한국 시장 제품 리서처입니다.
스토리 작가에게 **제품이 자연스럽게 쓰이는 상황·동작**을 알려주기 위한 간단한 자료를 만듭니다.

상품: ${productName}

## 조사 항목 (간결히)

1. **제품 한 줄 설명** (무엇을 하는 물건인지)
2. **실제 사용 동작** (손/몸이 어떻게 움직이는지 구체적으로)
3. **제품이 놓이는 전형적 공간** (집 어디? 가방? 책상? 차? 침대?)
4. **사용 시간대** (주로 언제 쓰는가)
5. **사용 전후의 감각 변화** (예: 소음 감소, 손목 이완, 시야 밝아짐)

## ⚠️ 금지
- 스펙, 기능명, 센서명, 기술 용어
- 장단점, 경쟁 비교, 추천 여부

**결과는 장편이 아니라 10줄 이내로 핵심만. 스토리 작가가 한 눈에 읽고 장면에 녹일 수 있게.**`;
}

function buildScriptPrompt(
  topic: string,
  research: string,
  productName: string,
): string {
  return `당신은 **한국 감성 쇼트 스토리 작가**입니다.
광고 카피라이터가 아닙니다. 단편 드라마, 에세이, 일상 썰을 쓰는 작가입니다.

## 🎯 창작 원리 — 이 순서를 반드시 따르세요

**STEP 1: 주제가 먼저다.**
유저가 선택한 주제를 기반으로 **한 사람의 한 순간**을 먼저 떠올리세요.
이때 제품은 아직 생각하지 마세요.

**STEP 2: 주제 안에 제품이 자연스럽게 놓일 자리를 찾는다.**
떠올린 장면 안에서 "이 제품이 현실적으로 존재할 만한 곳"을 찾으세요.
(책상 위, 손 안, 가방 속, 침대 옆 등)

**STEP 3: 제품이 주인공의 그 순간에 자연스럽게 연결되는 한 지점을 만든다.**
주제의 감정 흐름 안에서 씬 하나가 제품과의 접점이 됩니다.

## 🚨 절대 원칙

- 이건 광고가 아니라 **짧은 이야기**입니다.
- 제품 장점·기능·스펙을 **한 글자도** 쓰지 마세요.
- 제품이 **주제가 되면 안 됩니다.** 주제가 주인, 제품은 손님.
- 제품명 "${productName}"은 대본에 **0~1번** 등장. (대명사로 부르는 게 더 자연스럽습니다)
- "좋다/편하다/달라요/후회 안 해요" 같은 평가어·CTA 금지.

## 📥 유저 주제

주제: **${topic || "(주제 미입력 — 감성 일상 장면으로)"}**

이 주제를 기반으로 스토리를 구상하세요.
주제가 모호하면, 한 사람의 구체적 순간으로 해석하세요.

## 📦 제품 사용 맥락 (스토리에 녹일 소품 정보)

${research}

⚠️ 위 리서치는 **제품이 스토리 안에서 어떻게 존재할 수 있는지** 참고용입니다.
- 제품 설명하지 말고, **행동/사물**로만 등장시키세요.
- 예: "청소기를 쥐었다" (O) / "이 청소기는 흡입력이 좋아요" (X)

## ✍️ 대본 작법

### 씬 구성 (5씬 × 5초 = 25초)

| 씬 | 역할 |
|----|------|
| 1 | **오프닝** — 시간·공간·감정 세팅. 주제 분위기 오픈 |
| 2 | **전개** — 상황을 깊게. 대사 또는 묘사 |
| 3 | **제품 접점** — 주인공이 제품을 쥐거나 쓰는 순간 (스토리 흐름 속에서 자연스럽게) |
| 4 | **변화** — 주인공 안에서 감정·시선·행동이 움직이는 순간 |
| 5 | **여운** — 한 줄 엔딩. 결론 X, 감정의 잔상 |

### 문장 작법 ⭐ 중요
- **각 씬 40~70자 (공백 포함)** — 현재 너무 짧게 쓰는 경향 주의, 반드시 이 길이 유지
- 한 씬에 2~3문장 OK
- TTS가 자연스럽게 5초에 읽을 분량
- 감각어·시간·공간·온도 적극 활용
- 짧은 대사도 OK (따옴표로)
- **설명체 금지, 묘사·내레이션·혼잣말 중심**

### 예시 (각 씬 길이 참고)

씬 1 예: "화요일 밤 11시. 사무실엔 나 혼자. 창밖엔 차가운 겨울비가 조용히 내리고 있었다." (47자)

씬 3 예: "책상 구석에 세워져 있던 그것을 집어들었다. 손에 쥐는 감각이 생각보다 가벼웠다." (42자)

## 📤 JSON 출력

- storyPremise: 주인공·시공간·중심 감정을 2~3문장으로
- newScenes: 정확히 **5씬** (index 0~4, durationSec 5)
  - text: 40~70자 한국어 완성문
  - emotion: 감정 한국어 한 단어

## ✅ 제출 전 자가 체크
- [ ] 스토리가 "${topic}"의 분위기·테마에 충실하다
- [ ] 제품 이름·스펙·장점이 대본에 없다
- [ ] 제품을 빼도 스토리가 성립한다 (하지만 씬 3에 제품 접점은 있다)
- [ ] 각 씬이 40~70자로 충분히 길다
- [ ] 드라마/에세이/썰 같은 분위기다
- [ ] 씬 5가 CTA 아니라 여운이다`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      storyTopic = "",
      productName,
      productImageDataUrls = [],
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

    // Step 1: 제품 사용 맥락 간단 조사 (스펙 아닌 행동/공간)
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

    const research = researchResponse.text || "";
    if (!research) {
      return NextResponse.json(
        { error: "상품 리서치 응답이 비어있습니다." },
        { status: 500 },
      );
    }

    // Step 2: 주제 + 리서치로 스토리 씬 생성
    const scriptResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: buildScriptPrompt(storyTopic, research, productName) }],
          },
        ],
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
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
