import { NextRequest, NextResponse } from "next/server";
import {
  tryFetchTranscript,
  extractVideoId,
} from "@/lib/youtube-transcript";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 180;
export const runtime = "nodejs";

type VideoInput = {
  url: string;
  title?: string;
  views?: number;
  channel?: string;
  outlierScore?: number;
};

type VideoAnalysis = {
  url: string;
  videoId: string | null;
  title?: string;
  views?: number;
  channel?: string;
  outlierScore?: number;
  transcript: string | null;
  transcriptError?: string;
};

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    overall: {
      type: "object",
      properties: {
        commonHookPattern: { type: "string" },
        avgStructure: { type: "string" },
        viralFormula: { type: "string" },
        toneStyle: { type: "string" },
        hookKeywords: { type: "array", items: { type: "string" } },
      },
      required: [
        "commonHookPattern",
        "avgStructure",
        "viralFormula",
        "toneStyle",
        "hookKeywords",
      ],
    },
    perVideo: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          openingHook: { type: "string" },
          structure: { type: "string" },
          retentionTactics: { type: "array", items: { type: "string" } },
          ending: { type: "string" },
          whyItHit: { type: "string" },
        },
        required: [
          "url",
          "openingHook",
          "structure",
          "retentionTactics",
          "ending",
          "whyItHit",
        ],
      },
    },
  },
  required: ["overall", "perVideo"],
};

function buildAnalysisPrompt(videos: VideoAnalysis[]): string {
  const blocks = videos
    .filter((v) => v.transcript)
    .map(
      (v, i) => `## 영상 ${i + 1}
URL: ${v.url}
제목: ${v.title || "—"}
채널: ${v.channel || "—"} · 조회수: ${v.views?.toLocaleString() || "—"} · 떡상 배율: ${
        v.outlierScore?.toFixed(1) || "—"
      }x

대본 (자막 추출):
"""
${v.transcript}
"""
`,
    )
    .join("\n---\n");

  return `당신은 한국 YouTube Shorts 알고리즘 전문가 + 카피라이터입니다.
아래 ${videos.length}개의 떡상 쇼츠 영상의 자막을 분석해서, **무엇이 이 영상들을 떡상시켰는지** 패턴을 추출하세요.

${blocks}

## 분석 항목

### overall (영상들의 공통 패턴)
- commonHookPattern: 첫 1.5초에 공통적으로 쓰는 후크 패턴 (예: "여러분 이거 아세요?", 충격 단어 반복)
- avgStructure: 평균적인 영상 구조 (배경→문제→반전 등 단계 흐름)
- viralFormula: 이 영상들의 떡상 공식을 한 문장으로
- toneStyle: 말투 / 화법 / 분위기
- hookKeywords: 첫 문장에 자주 등장하는 키워드 5~10개

### perVideo (각 영상마다)
- url: 영상 URL
- openingHook: 그 영상의 첫 문장 / 첫 후크
- structure: 그 영상의 씬 구성 흐름 (예: "배경 → 디테일 → 반전")
- retentionTactics: retention 전술 (예: "중간에 질문 던지기", "숫자 박기")
- ending: 마무리 방식 (예: "정보 폭탄으로 끝", "다음 떡밥")
- whyItHit: 왜 이 영상이 떡상한 것 같은지 1~2줄

JSON 출력. 모든 텍스트는 한국어, 요체 (~요/~죠)로.`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const inputs: VideoInput[] = Array.isArray(body.videos) ? body.videos : [];
    if (inputs.length === 0) {
      return NextResponse.json(
        { error: "videos 배열이 비어있습니다." },
        { status: 400 },
      );
    }
    if (inputs.length > 15) {
      return NextResponse.json(
        { error: "한 번에 최대 15개까지 분석 가능합니다." },
        { status: 400 },
      );
    }

    // 1) 자막 병렬 추출
    const videos: VideoAnalysis[] = await Promise.all(
      inputs.map(async (v) => {
        const videoId = extractVideoId(v.url);
        if (!videoId) {
          return {
            url: v.url,
            videoId: null,
            title: v.title,
            views: v.views,
            channel: v.channel,
            outlierScore: v.outlierScore,
            transcript: null,
            transcriptError: "videoId 추출 실패",
          };
        }
        try {
          const transcript = await tryFetchTranscript(videoId);
          return {
            url: v.url,
            videoId,
            title: v.title,
            views: v.views,
            channel: v.channel,
            outlierScore: v.outlierScore,
            transcript,
            transcriptError: transcript ? undefined : "자막 없음",
          };
        } catch (e) {
          return {
            url: v.url,
            videoId,
            title: v.title,
            views: v.views,
            channel: v.channel,
            outlierScore: v.outlierScore,
            transcript: null,
            transcriptError:
              e instanceof Error ? e.message : "자막 추출 실패",
          };
        }
      }),
    );

    const withTranscript = videos.filter((v) => !!v.transcript);
    if (withTranscript.length === 0) {
      return NextResponse.json(
        {
          error: "자막을 추출할 수 있는 영상이 하나도 없습니다.",
          videos,
        },
        { status: 200 },
      );
    }

    // 2) Gemini 분석
    const prompt = buildAnalysisPrompt(withTranscript);
    const ai = getGeminiClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SUMMARY_SCHEMA,
        },
      }),
    );
    const parsed = JSON.parse(res.text || "{}");

    return NextResponse.json({
      analyzedCount: withTranscript.length,
      skippedCount: videos.length - withTranscript.length,
      videos, // 자막 + 메타 정보 (UI에서 표시)
      analysis: parsed,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
