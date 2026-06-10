import { NextRequest, NextResponse } from "next/server";
import {
  extractVideoId,
  tryFetchTranscriptSegments,
  type TranscriptSegment,
} from "@/lib/youtube-transcript";
import { getGeminiClient, FLASH_FULL_MODEL, withRetry } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

// 매우 긴 영상에 대비한 상한 — Flash가 1M 컨텍스트를 받긴 하지만 비용·지연 통제용
const MAX_TRANSCRIPT_CHARS = 120_000; // 대략 90분 분량 한국어 자막
const MIN_TRANSCRIPT_CHARS = 200;

// ── 메타데이터 ────────────────────────────────────────────────────────────
type VideoMeta = {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  thumbnail: string;
  durationSec: number;
  publishedAt: string;
  views: number;
  description: string;
};

function parseIsoDurationSec(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (
    parseInt(m[1] || "0", 10) * 3600 +
    parseInt(m[2] || "0", 10) * 60 +
    parseInt(m[3] || "0", 10)
  );
}

async function fetchVideoMeta(videoId: string): Promise<VideoMeta | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");
  const params = new URLSearchParams({
    part: "snippet,contentDetails,statistics",
    id: videoId,
    key: apiKey,
  });
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params}`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const item = data.items?.[0];
  if (!item) return null;
  const thumbs = item.snippet.thumbnails || {};
  return {
    videoId,
    title: item.snippet.title || "",
    channel: item.snippet.channelTitle || "",
    channelId: item.snippet.channelId || "",
    thumbnail:
      thumbs.maxres?.url ||
      thumbs.standard?.url ||
      thumbs.high?.url ||
      thumbs.medium?.url ||
      thumbs.default?.url ||
      "",
    durationSec: parseIsoDurationSec(item.contentDetails?.duration || ""),
    publishedAt: item.snippet.publishedAt || "",
    views: parseInt(item.statistics?.viewCount || "0", 10),
    description: item.snippet.description || "",
  };
}

// ── 자막 포맷팅 ──────────────────────────────────────────────────────────
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * 자막 segments를 LLM에 보내기 좋은 [mm:ss] line 형태로 합침.
 * 너무 짧은 segments는 인접한 것끼리 묶어 줄 수를 줄임 (≈ 4~8초 단위).
 */
function formatTranscriptForLLM(segments: TranscriptSegment[]): {
  text: string;
  truncated: boolean;
} {
  const CHUNK_TARGET_SEC = 6;
  const lines: string[] = [];
  let buf: TranscriptSegment[] = [];
  let bufStart = 0;
  let bufLen = 0;

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf
      .map((s) => s.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) lines.push(`[${fmtTime(bufStart)}] ${text}`);
    buf = [];
    bufLen = 0;
  };

  for (const seg of segments) {
    if (buf.length === 0) bufStart = seg.offsetSec;
    buf.push(seg);
    bufLen += seg.durationSec || 0;
    if (bufLen >= CHUNK_TARGET_SEC) flush();
  }
  flush();

  let text = lines.join("\n");
  let truncated = false;
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    text = text.slice(0, MAX_TRANSCRIPT_CHARS) + "\n…(이후 생략)";
    truncated = true;
  }
  return { text, truncated };
}

// ── Gemini 프롬프트 / 스키마 ─────────────────────────────────────────────
const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    oneLineSummary: { type: "string" },
    coreMessage: { type: "string" },
    topicTags: { type: "array", items: { type: "string" } },
    keyTakeaways: { type: "array", items: { type: "string" } },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          title: { type: "string" },
          summary: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
        },
        required: ["startSec", "endSec", "title", "summary", "keyPoints"],
      },
    },
    keyQuotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          atSec: { type: "number" },
          why: { type: "string" },
        },
        required: ["quote", "atSec", "why"],
      },
    },
    targetAudience: { type: "string" },
    actionItems: { type: "array", items: { type: "string" } },
    studyOutline: { type: "string" },
  },
  required: [
    "oneLineSummary",
    "coreMessage",
    "topicTags",
    "keyTakeaways",
    "chapters",
    "keyQuotes",
    "targetAudience",
    "actionItems",
    "studyOutline",
  ],
};

function buildPrompt(meta: VideoMeta, transcript: string): string {
  return `당신은 유튜브 롱폼 영상을 빠르게 흡수해서 **공부 노트**처럼 정리하는 분석가예요.
아래는 한 영상의 메타데이터와 자막(타임스탬프 포함)이에요. 영상을 보지 않은 사람도 핵심을 잡을 수 있게 정리해 주세요.

## 영상 메타
- 제목: ${meta.title}
- 채널: ${meta.channel}
- 길이: ${fmtTime(meta.durationSec)} (${meta.durationSec}초)
- 조회수: ${meta.views.toLocaleString()}
- 게시일: ${meta.publishedAt?.slice(0, 10) || "—"}

## 자막 (각 줄 앞 [mm:ss]는 그 구간 시작 시각)
"""
${transcript}
"""

## 출력 규칙
- 모든 텍스트는 **한국어 요체** (~예요/~죠/~네요). "~다/~습니다" 금지.
- **자막에서 실제로 다룬 내용만** 쓰세요. 채널/제목으로 추측해서 지어내지 마세요.
- 챕터의 startSec/endSec/atSec는 **자막 줄 앞 [mm:ss]의 초 값과 일치**시켜요.
- 영상 길이에 맞춰 챕터 수를 정해요 — 보통 **5~10개**, 짧으면 더 적게.

## 채워야 할 필드
- **oneLineSummary**: 이 영상이 뭐에 대한 건지 **한 줄** (140자 이내, 트위터 길이). 호기심 자극 ❌, 정보 압축 ⭕.
- **coreMessage**: 영상이 결국 말하려는 **핵심 메시지/결론** 2~3줄. "그래서 뭐가 결론인지"가 분명히 드러나게.
- **topicTags**: 이 영상의 토픽/카테고리 태그 3~7개 (예: ["주식", "테슬라", "투자 전략"]).
- **keyTakeaways**: 시청자가 가져갈 **핵심 인사이트** 5~7개. 각 항목 한 문장. 막연한 일반론 ❌, 영상에서 실제로 나온 주장/팩트만.
- **chapters**: 시간 순 챕터. 토픽이 바뀌는 지점에서 끊어요.
  - startSec/endSec: 자막 타임스탬프 기준 초 단위 정수
  - title: 8~16자 짧은 챕터 제목
  - summary: 그 챕터에서 무슨 얘기를 했는지 2~3줄
  - keyPoints: 그 챕터의 핵심 포인트 2~5개 (각 한 문장)
- **keyQuotes**: 영상에서 가장 인상적/중요한 발언 3~5개.
  - quote: 자막에 실제로 등장한 표현 그대로(살짝 다듬는 건 OK, 의미 변형 ❌)
  - atSec: 등장 시각
  - why: 왜 이게 중요한지 한 줄
- **targetAudience**: 어떤 사람이 보면 좋은 영상인지 1줄.
- **actionItems**: 시청자가 **바로 실행 가능한 액션** 0~5개 (없으면 빈 배열). 영상이 실용 가이드/튜토리얼이 아니면 비어도 OK.
- **studyOutline**: 노션/옵시디언에 그대로 붙여넣을 **마크다운 outline**. 다음 형식 권장:
  \`\`\`
  # ${meta.title}
  - 한 줄 요약: …
  - 핵심 메시지: …

  ## 챕터
  ### [mm:ss] 챕터 제목
  - 요점 1
  - 요점 2

  ## 핵심 인사이트
  - …

  ## 인용
  > "…" — [mm:ss]
  \`\`\`
  (실제 \\n 줄바꿈 포함된 마크다운 문자열로 출력)`;
}

// ── POST 핸들러 ──────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const url = (body?.url as string | undefined)?.trim();
    if (!url) {
      return NextResponse.json(
        { error: "url이 필요해요." },
        { status: 400 },
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "유튜브 URL에서 영상 ID를 추출하지 못했어요." },
        { status: 400 },
      );
    }

    // 1) 메타데이터
    const meta = await fetchVideoMeta(videoId);
    if (!meta) {
      return NextResponse.json(
        { error: "영상 정보를 불러오지 못했어요. URL을 확인해 주세요." },
        { status: 404 },
      );
    }

    // 2) 자막 (타임스탬프 포함)
    const segments = await tryFetchTranscriptSegments(videoId, meta.durationSec);
    if (!segments || segments.length === 0) {
      return NextResponse.json(
        {
          error:
            "이 영상에서 자막을 가져오지 못했어요. 자막이 꺼져있거나 비공개일 수 있어요.",
          videoMeta: meta,
        },
        { status: 422 },
      );
    }

    const { text: transcriptForLLM, truncated } = formatTranscriptForLLM(segments);
    if (transcriptForLLM.length < MIN_TRANSCRIPT_CHARS) {
      return NextResponse.json(
        {
          error: "자막이 너무 짧아서 요약하기 어려워요.",
          videoMeta: meta,
        },
        { status: 422 },
      );
    }

    // 3) Gemini 요약
    const prompt = buildPrompt(meta, transcriptForLLM);
    const ai = getGeminiClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_FULL_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SUMMARY_SCHEMA,
        },
      }),
    );

    const raw = res.text;
    if (!raw) {
      return NextResponse.json(
        { error: "요약 응답이 비어있어요." },
        { status: 500 },
      );
    }
    const summary = JSON.parse(raw);

    // chapters / quotes의 초 값을 메타 길이로 clamp
    const clamp = (n: unknown): number => {
      const v = typeof n === "number" ? n : Number(n) || 0;
      return Math.max(0, Math.min(meta.durationSec, Math.round(v)));
    };
    if (Array.isArray(summary.chapters)) {
      summary.chapters = summary.chapters.map(
        (c: { startSec: number; endSec: number; [k: string]: unknown }) => ({
          ...c,
          startSec: clamp(c.startSec),
          endSec: clamp(c.endSec),
        }),
      );
    }
    if (Array.isArray(summary.keyQuotes)) {
      summary.keyQuotes = summary.keyQuotes.map(
        (q: { atSec: number; [k: string]: unknown }) => ({
          ...q,
          atSec: clamp(q.atSec),
        }),
      );
    }

    return NextResponse.json({
      videoMeta: meta,
      transcriptStats: {
        segments: segments.length,
        chars: transcriptForLLM.length,
        truncated,
      },
      summary,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
