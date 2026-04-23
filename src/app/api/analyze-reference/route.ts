import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL } from "@/lib/gemini";
import {
  extractVideoId,
  tryFetchTranscript,
} from "@/lib/youtube-transcript";

export const maxDuration = 60;
export const runtime = "nodejs";

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

function buildAnalysisPrompt(
  topic: string,
  transcript: string | null,
): string {
  return `당신은 한국 유튜브 쇼츠 스크립트 전문가입니다. 아래 과제를 수행하세요.

## 과제 1: 참고 영상의 대본 스타일 분석
${
  transcript
    ? `참고 영상의 자막(대본)은 다음과 같습니다:\n---\n${transcript}\n---`
    : "참고 영상의 자막이 주어지지 않았습니다. 첨부된 YouTube 영상의 음성을 들어 대본을 먼저 전사한 뒤, 그 대본을 분석하세요."
}

분석 항목:
- styleSummary: 대본의 전반적인 작법 특징 (1~2문장)
- toneTags: 어조/무드 태그 3~5개 (예: "친근함", "드라마틱", "호기심 유발")
- hookPattern: 도입부 훅 전략 (무엇으로 시청자를 붙잡는가)
- structureNotes: 기승전결 구조, 문장 리듬, 전환 지점 요약 (3~5줄)

## 과제 2: 같은 스타일로 "새 쇼츠 대본" 생성
- 주제: ${topic || "(유저가 주제를 입력하지 않았습니다 — 일반 상품 스토리로 대신 작성)"}
- **스토리 80%, 상품 언급 20%** 비율
- 총 길이 25초, **5개 씬**으로 분할 (각 씬 5초씩)
- 각 씬마다:
  - text: 실제 내레이션 문장 (한국어, TTS로 읽을 수 있는 완성된 문장)
  - emotion: 해당 씬의 감정 태그 (예: "호기심", "긴장감", "놀람", "감동", "해소")
  - durationSec: 5 (고정)

## 출력
위에서 정의한 JSON 스키마를 엄격히 따라 반환.
originalScript 필드에는 참고 영상 대본(자막 있으면 그대로, 없으면 전사 결과)을 담으세요.`;
}

export async function POST(req: NextRequest) {
  try {
    const { url, topic } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: "YouTube URL이 필요합니다." },
        { status: 400 },
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        {
          error:
            "서버에 GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.",
        },
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
    const prompt = buildAnalysisPrompt(topic || "", transcript);

    const parts: Part[] = [{ text: prompt }];

    if (!transcript) {
      parts.unshift({
        fileData: { fileUri: canonicalUrl, mimeType: "video/*" },
      });
    }

    const contents: Content[] = [{ role: "user", parts }];

    const response = await ai.models.generateContent({
      model: FLASH_MODEL,
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini 응답이 비어있습니다.");
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
      topic,
      transcriptSource: transcript ? "captions" : "gemini-audio",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
