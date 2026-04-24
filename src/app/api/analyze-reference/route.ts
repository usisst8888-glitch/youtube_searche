import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  extractVideoId,
  tryFetchTranscript,
} from "@/lib/youtube-transcript";

export const maxDuration = 120;
export const runtime = "nodejs";

type ImageInline = { mimeType: string; data: string };

function dataUrlToInline(dataUrl: string): ImageInline | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    originalScript: { type: "string" },
    styleSummary: { type: "string" },
    toneTags: { type: "array", items: { type: "string" } },
    hookPattern: { type: "string" },
    structureNotes: { type: "string" },
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
  required: [
    "originalScript",
    "styleSummary",
    "toneTags",
    "hookPattern",
    "structureNotes",
    "newScenes",
  ],
};

function buildResearchPrompt(productName: string): string {
  return `당신은 한국 시장 제품 리서처입니다.

아래 상품에 대해 **웹 검색**을 활용해 깊이 조사하고 마크다운으로 정리하세요.

상품명: ${productName}

조사 항목:
1. 제품 개요 & 카테고리
2. 타겟 고객층 + 그들이 느끼는 **구체적 페인 포인트** 3~5개
3. 핵심 셀링 포인트(USP) 3~5개
4. 한국 소비자 맥락 (현재 트렌드, 관련 밈/문화, 경쟁 제품과의 차별점)
5. **스토리텔링용 후크 아이디어 5개** — "이 제품이 해결하는 구체적 생활 장면"

결과는 실제 스토리 대본을 짜는 작가가 읽고 바로 영감 받을 수 있도록 **구체적이고 감각적으로** 작성하세요.`;
}

function buildScriptPrompt(
  transcript: string | null,
  research: string,
  productName: string,
): string {
  return `당신은 **조회수 100만을 수시로 뚫는 한국 유튜브 쇼츠 스토리 작가**입니다.
"알고리즘을 찢는 훅"의 패턴을 꿰고 있고, 3초 안에 시청자 손가락을 멈추게 하는 법을 알고 있습니다.

## 미션
"${productName}" 상품의 **스토리텔링 쇼츠 대본** 작성 — 스토리 80% / 상품 20%.

## 입력 1: 참고 영상 대본 (스타일 벤치마크)
${
  transcript
    ? `자막:\n---\n${transcript}\n---`
    : "참고 영상 자막 없음 — 첨부된 YouTube 영상 음성을 들어 직접 전사한 뒤 스타일 추출."
}

## 입력 2: 상품 리서치 (웹 검색 결과)
---
${research}
---

## 과제 A: 참고 영상 스타일 분석
- styleSummary, toneTags(3~5개), hookPattern, structureNotes
- originalScript = 참고 영상 자막/전사 원문

## 과제 B: 새 쇼츠 대본 생성 — **반드시** 아래 규칙 따를 것

### 🎯 씬 구성 — 총 **30초, 6씬 × 5초**
시청 유지율 우상향을 위한 감정 곡선:

| 씬 | 역할 | 감정 태그 예시 |
|----|------|--------------|
| 1 | **강력한 훅** (0~5초, 이탈 방지 구간) | 충격, 공감, 모순 |
| 2 | **문제 증폭** (진짜 얼마나 심각한지) | 답답함, 피로 |
| 3 | **반전 / 발견** (상품 자연 등장) | 호기심, 반전 |
| 4 | **체험** (실제 사용 순간의 변화) | 놀람, 기대 |
| 5 | **감정 피크** (완전히 달라진 일상) | 해방감, 만족 |
| 6 | **임팩트 마무리** (한 줄 여운 + 은근한 CTA) | 여운, 확신 |

### 🔥 1번 씬 훅 규칙 (가장 중요 — 평범하면 전멸)
다음 중 **하나는 반드시** 사용:
- **충격 선언**: "이거 진짜 저만 모른 거예요?"
- **공감 페인 직격**: "퇴근하고 집 오면 아무것도 못 하죠?"
- **의외의 모순**: "10만 원짜리가 5만 원짜리보다 못한 이유"
- **시간 손실 강조**: "이거 때문에 매일 1시간씩 날리고 있었어요"
- **질문형 어그로**: "여러분 이거 진짜 아세요?"
- **숫자 임팩트**: "3초면 되는데 평생 30분씩 했습니다"
- **부정어 훅**: "이거 사지 마세요. 진짜로."
- **상황 스냅샷**: "아침 7시. 눈 뜨자마자 후회 시작."

### ✍️ 문장 작법
- 한 씬당 **1~2문장**, 평균 12~20자
- **감탄사/짧은 동사**로 리듬 (진짜, 와, 근데, 이게)
- **숫자·감각 언어** 적극 (3초, 따뜻한, 쫀득한, 확)
- 구어체 반말/존댓말 중 참고 영상 따라가기
- 설명형 지양, **경험담 형식**으로
- 리서치에서 발견한 **구체적 페인 포인트·생활 장면** 녹이기

### 📦 상품 노출 규칙
- "이거 사세요" 같은 광고 금지
- 상품명은 **1~2번만** 언급 (씬 3 또는 4)
- **페인 → 자연스러운 발견 → 결과** 흐름
- 씬 6는 감정 여운 중심 (팔이 아님)

### 📄 출력 JSON
- newScenes: **정확히 6개** (index 0~5, durationSec 5)
- 각 scene.text는 TTS가 그대로 읽을 자연스러운 완성문
- emotion은 한국어 감정 태그 한 단어

**중요: 대본이 평범하면 망합니다. 훅을 과감하게, 감정을 직설적으로.**`;
}

export async function POST(req: NextRequest) {
  try {
    const { url, productName, productImageDataUrls = [] } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: "참고 영상 URL이 필요합니다." },
        { status: 400 },
      );
    }
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

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "유효한 YouTube URL이 아닙니다." },
        { status: 400 },
      );
    }

    const transcript = await tryFetchTranscript(videoId);
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const ai = getGeminiClient();

    // Step 1: 상품 웹 리서치 (Google Search grounding)
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
        config: {
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    const research = researchResponse.text || "";
    if (!research) {
      return NextResponse.json(
        { error: "상품 리서치 응답이 비어있습니다." },
        { status: 500 },
      );
    }

    // Step 2: 대본 분석 + 생성 (structured output)
    const scriptParts: Part[] = [
      { text: buildScriptPrompt(transcript, research, productName) },
    ];
    if (!transcript) {
      scriptParts.unshift({
        fileData: { fileUri: canonicalUrl, mimeType: "video/*" },
      });
    }

    const scriptResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: scriptParts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA,
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
      analysis: {
        referenceUrl: canonicalUrl,
        originalScript: parsed.originalScript,
        styleSummary: parsed.styleSummary,
        toneTags: parsed.toneTags,
        hookPattern: parsed.hookPattern,
        structureNotes: parsed.structureNotes,
      },
      scenes: parsed.newScenes,
      productResearch: research,
      transcriptSource: transcript ? "captions" : "gemini-audio",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
