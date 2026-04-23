import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL } from "@/lib/gemini";
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
  return `당신은 한국 유튜브 쇼츠 스크립트 작가입니다.

## 입력 1: 참고 영상 대본
${
  transcript
    ? `참고 영상의 자막은 다음과 같습니다:\n---\n${transcript}\n---`
    : "참고 영상 자막이 없어, 첨부된 YouTube 영상의 음성을 들어 먼저 전사한 뒤 스타일을 추출하세요."
}

## 입력 2: 상품 리서치 결과
---
${research}
---

## 과제 A: 참고 영상의 대본 스타일 분석
- styleSummary: 대본 작법 특징 (1~2문장)
- toneTags: 어조/무드 태그 3~5개
- hookPattern: 도입부 훅 전략
- structureNotes: 기승전결 구조 및 전환 지점 (3~5줄)

## 과제 B: 같은 스타일로 "${productName}" 스토리텔링 쇼츠 대본 생성
- 리서치에서 발견된 **페인 포인트 + USP + 생활 장면**을 활용
- **스토리 80% / 상품 언급 20%** 비율
- 총 25초, **5씬** (각 5초)
- 각 씬:
  - text: 실제 내레이션 문장 (TTS로 자연스럽게 읽히는 한국어 완성문)
  - emotion: 감정 태그
  - durationSec: 5

## 출력
JSON 스키마 엄격히 따라 반환. originalScript에는 참고 영상 자막/전사 결과를 담으세요.`;
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

    const researchResponse = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: researchContents,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

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

    const scriptResponse = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents: [{ role: "user", parts: scriptParts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    });

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
