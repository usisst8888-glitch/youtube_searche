import { NextRequest, NextResponse } from "next/server";
import {
  extractVideoId,
  tryFetchTranscriptSegments,
  type TranscriptSegment,
} from "@/lib/youtube-transcript";
import { getGeminiClient, FLASH_FULL_MODEL, withRetry } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_URLS = 6;
const MAX_PER_VIDEO_CHARS = 60_000; // 1시간 영상은 보통 8~15k자라 충분
const MIN_TRANSCRIPT_CHARS = 200;

// ── 메타데이터 ────────────────────────────────────────────────────────────
type VideoMeta = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec: number;
  publishedAt: string;
  views: number;
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

async function fetchVideoMetaBatch(
  videoIds: string[],
): Promise<Record<string, VideoMeta>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error("YOUTUBE_API_KEY가 설정되지 않았습니다.");
  if (videoIds.length === 0) return {};
  const params = new URLSearchParams({
    part: "snippet,contentDetails,statistics",
    id: videoIds.join(","),
    key: apiKey,
  });
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?${params}`,
  );
  if (!res.ok) return {};
  const data = await res.json();
  const out: Record<string, VideoMeta> = {};
  for (const item of data.items || []) {
    const thumbs = item.snippet.thumbnails || {};
    out[item.id] = {
      videoId: item.id,
      title: item.snippet.title || "",
      channel: item.snippet.channelTitle || "",
      thumbnail:
        thumbs.high?.url ||
        thumbs.medium?.url ||
        thumbs.default?.url ||
        "",
      durationSec: parseIsoDurationSec(item.contentDetails?.duration || ""),
      publishedAt: item.snippet.publishedAt || "",
      views: parseInt(item.statistics?.viewCount || "0", 10),
    };
  }
  return out;
}

// ── 자막 포맷 ────────────────────────────────────────────────────────────
function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function formatTranscript(segments: TranscriptSegment[]): {
  text: string;
  truncated: boolean;
} {
  const CHUNK_SEC = 10; // playbook 추출은 study노트보다 더 듬성듬성해도 OK
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
    if (bufLen >= CHUNK_SEC) flush();
  }
  flush();
  let text = lines.join("\n");
  let truncated = false;
  if (text.length > MAX_PER_VIDEO_CHARS) {
    text = text.slice(0, MAX_PER_VIDEO_CHARS) + "\n…(이후 생략)";
    truncated = true;
  }
  return { text, truncated };
}

// ── Stage 1: 영상별 골든 모먼트 추출 스키마 ──────────────────────────────
const PER_VIDEO_SCHEMA = {
  type: "object",
  properties: {
    brief: { type: "string" },
    mainTopic: { type: "string" },
    contentStyle: { type: "string" },
    topThemes: { type: "array", items: { type: "string" } },
    shortableMoments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          title: { type: "string" },
          hookLine: { type: "string" },
          payoff: { type: "string" },
          why: { type: "string" },
        },
        required: ["startSec", "endSec", "title", "hookLine", "payoff", "why"],
      },
    },
    hookPatterns: { type: "array", items: { type: "string" } },
    retentionPatterns: { type: "array", items: { type: "string" } },
  },
  required: [
    "brief",
    "mainTopic",
    "contentStyle",
    "topThemes",
    "shortableMoments",
    "hookPatterns",
    "retentionPatterns",
  ],
};

function buildPerVideoPrompt(meta: VideoMeta, transcript: string): string {
  return `당신은 **쇼츠 황금 모먼트 헌터**예요. 롱폼 영상을 보고 "여기를 자르면 쇼츠로 떡상한다" 싶은 30~60초 구간을 골라내는 게 일이에요.

## 영상 메타
- 제목: ${meta.title}
- 채널: ${meta.channel} · 조회수 ${meta.views.toLocaleString()}
- 길이: ${fmtTime(meta.durationSec)}

## 자막 (각 줄 앞 [mm:ss]는 그 구간 시작 시각, 정확히 그 초 값을 써요)
"""
${transcript}
"""

## 채워야 할 필드
- **brief**: 이 영상이 뭘 다루는지 2~3줄 요약 (요체)
- **mainTopic**: 메인 토픽 한 줄
- **contentStyle**: 화법/톤 (예: "차분한 다큐 톤", "에너지 폭발 토크", "농담 섞은 정보형")
- **topThemes**: 영상의 핵심 주제 3~5개 (한 단어~두 어절)
- **shortableMoments**: **30~60초 길이의 쇼츠로 자를 만한 순간 5~10개**. 진짜 강한 것만 골라요.
  - startSec/endSec: 자막 [mm:ss] 초 값. endSec - startSec는 30~60 권장
  - title: 이 모먼트의 한 줄 제목 (호기심 자극)
  - hookLine: 쇼츠 첫 1~3초에 그대로 쓸 후크 문장 — 0.5초 만에 스크롤 멈추게
  - payoff: 후크 다음 그 모먼트가 무엇을 보여주거나 말하는지 1~2줄
  - why: 왜 이게 쇼츠로 터질 거 같은지 한 줄 (반전/의외성/감정/유용성 등 angle 명시)
- **hookPatterns**: 이 영상이 시청자를 끌어들이는 방법 (예: "숫자 박기", "충격적 질문", "예상 깨기") 3~5개
- **retentionPatterns**: 이탈 방지 패턴 (예: "다음 정보 떡밥 던지기", "중간 질문") 3~5개

## 규칙
- 모든 텍스트는 한국어 요체 (~예요/~죠).
- 자막에 실제로 나온 내용만 사용. 추측·각색 금지.
- startSec/endSec은 자막 [mm:ss] 초 값과 일치시켜요.
- 평범한 정보 나열 구간은 모먼트로 뽑지 말 것 — "충격/반전/디테일/감정" 중 하나 이상이 있어야 해요.`;
}

type PerVideoOutput = {
  brief: string;
  mainTopic: string;
  contentStyle: string;
  topThemes: string[];
  shortableMoments: {
    startSec: number;
    endSec: number;
    title: string;
    hookLine: string;
    payoff: string;
    why: string;
  }[];
  hookPatterns: string[];
  retentionPatterns: string[];
};

// ── Stage 2: 집계 → 플레이북 스키마 ──────────────────────────────────────
const PLAYBOOK_SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string" },
    commonPatterns: {
      type: "object",
      properties: {
        sharedThemes: { type: "array", items: { type: "string" } },
        hookFormula: { type: "string" },
        structureTemplate: { type: "string" },
        toneStyle: { type: "string" },
        pacing: { type: "string" },
      },
      required: [
        "sharedThemes",
        "hookFormula",
        "structureTemplate",
        "toneStyle",
        "pacing",
      ],
    },
    ideaBank: {
      type: "array",
      items: {
        type: "object",
        properties: {
          rank: { type: "number" },
          title: { type: "string" },
          hook: { type: "string" },
          structure: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stage: { type: "string" },
                beat: { type: "string" },
                durationSec: { type: "number" },
              },
              required: ["stage", "beat", "durationSec"],
            },
          },
          retentionTactics: { type: "array", items: { type: "string" } },
          estimatedDurationSec: { type: "number" },
          sourceVideoIndex: { type: "number" },
          sourceStartSec: { type: "number" },
          whyItHits: { type: "string" },
          difficulty: { type: "string" },
        },
        required: [
          "rank",
          "title",
          "hook",
          "structure",
          "retentionTactics",
          "estimatedDurationSec",
          "sourceVideoIndex",
          "sourceStartSec",
          "whyItHits",
          "difficulty",
        ],
      },
    },
    productionPlaybook: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "number" },
          title: { type: "string" },
          detail: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          timeEstimate: { type: "string" },
        },
        required: ["step", "title", "detail", "tools", "timeEstimate"],
      },
    },
    hookTemplates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          template: { type: "string" },
          example: { type: "string" },
          whenToUse: { type: "string" },
        },
        required: ["template", "example", "whenToUse"],
      },
    },
    contentAngles: { type: "array", items: { type: "string" } },
    actionChecklist: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: [
    "overview",
    "commonPatterns",
    "ideaBank",
    "productionPlaybook",
    "hookTemplates",
    "contentAngles",
    "actionChecklist",
    "warnings",
  ],
};

function buildPlaybookPrompt(
  perVideos: { meta: VideoMeta; analysis: PerVideoOutput }[],
  context: { niche?: string; audience?: string },
): string {
  const blocks = perVideos
    .map(
      (v, i) => `## 영상 ${i} — "${v.meta.title}" (${v.meta.channel})
- 메인 토픽: ${v.analysis.mainTopic}
- 화법: ${v.analysis.contentStyle}
- 핵심 주제: ${v.analysis.topThemes.join(", ")}
- 후크 패턴: ${v.analysis.hookPatterns.join(" / ")}
- retention 패턴: ${v.analysis.retentionPatterns.join(" / ")}
- 골든 모먼트:
${v.analysis.shortableMoments
  .map(
    (m) =>
      `  - [${fmtTime(m.startSec)}~${fmtTime(m.endSec)}] ${m.title}\n    후크: "${m.hookLine}"\n    payoff: ${m.payoff}\n    터질 이유: ${m.why}`,
  )
  .join("\n")}`,
    )
    .join("\n\n");

  const ctx = [
    context.niche ? `- 내 채널 니치: ${context.niche}` : "",
    context.audience ? `- 타겟 시청자: ${context.audience}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `당신은 **쇼츠 알고리즘 코치**예요. 아래 레퍼런스 ${perVideos.length}개 영상을 분석해서, 사용자가 **지금 당장 쇼츠를 만들 수 있는 실전 플레이북**을 짜요.

${ctx ? `## 사용자 컨텍스트\n${ctx}\n` : ""}
## 레퍼런스 영상 추출 결과
${blocks}

## 채워야 할 필드 (모두 한국어 요체)

### overview
이 ${perVideos.length}개 영상에서 발견한 **떡상 공식을 한 문단**으로 요약 (3~5줄). "이 영상들이 공통적으로 잘하는 것 = 당신이 따라야 할 것".

### commonPatterns (영상들의 공통 패턴)
- sharedThemes: 영상들이 공통으로 다루는 테마 3~6개
- hookFormula: 공통 후크 공식을 1~2줄 (예: "충격적 숫자 + 의문문")
- structureTemplate: 영상들의 공통 구조 (예: "후크(3s) → 갈등(15s) → 디테일(20s) → 반전(15s)")
- toneStyle: 공통 톤
- pacing: 평균 페이싱 (빠름/중간/느림, 컷 변화 빈도 등)

### ideaBank — **쇼츠 아이디어 8~12개** (가장 중요)
레퍼런스 영상에서 직접 영감 받은 **구체적인 쇼츠 기획안**. rank는 1부터 (강추 순).
- rank: 순위 (1이 최고 우선)
- title: 쇼츠 제목 (20자 내외, 어그로/궁금증)
- hook: 첫 1~3초 후크 문장 (그대로 TTS/자막으로 박을 수 있게)
- structure: 4단계 비트 — { stage: "배경"/"디테일"/"문제"/"반전", beat: "이 단계에서 뭘 보여줄지", durationSec: 보통 8 }
- retentionTactics: 이탈 방지 전술 2~4개
- estimatedDurationSec: 총 길이 (30~60s 권장)
- sourceVideoIndex: 어느 영상에서 영감 받았는지 (0부터)
- sourceStartSec: 그 영상의 어느 시점에서 따왔는지 (초)
- whyItHits: 왜 이게 떡상할지 1~2줄
- difficulty: "쉬움" / "보통" / "어려움" — 제작 난이도

### productionPlaybook — **제작 단계 6~8개**
사용자가 오늘 따라할 수 있는 단계별 가이드.
- step: 1부터
- title: 단계 제목 (예: "1. 골든 모먼트 클립 잘라내기")
- detail: 무엇을 어떻게 하는지 2~3줄
- tools: 추천 도구/툴 (예: ["CapCut", "FFmpeg", "이 플랫폼의 영상→대본 메뉴"])
- timeEstimate: 소요 시간 (예: "10~15분")

### hookTemplates — **재사용 가능한 후크 템플릿 5~8개**
- template: 빈칸 채우기 형식 (예: "이거 진짜 아무도 모르는데, [숫자]명 중 [숫자]명이 [동사]해요")
- example: 실제 예시 한 줄
- whenToUse: 어떤 상황에 쓰면 좋은지

### contentAngles — **시도해볼 만한 콘텐츠 앵글 5~8개**
레퍼런스에서 보이지만 사용자가 본인 톤으로 변주할 수 있는 각도. 한 줄씩.

### actionChecklist — **오늘 당장 할 일 5~8개**
순서대로 체크해 나갈 수 있는 todo. "오늘 안에 끝낼 수 있는 작업" 단위로.

### warnings — **주의할 점 2~5개**
이 패턴으로 갔을 때 자칫하면 망하는 지점 (예: "후크가 약하면 1초 안에 이탈", "정보만 나열하면 끝까지 안 봄").

## 절대 규칙
- ideaBank의 sourceVideoIndex와 sourceStartSec은 위 레퍼런스의 실제 [mm:ss]와 일치
- 일반론·당연한 소리 ❌. 위 레퍼런스에서 실제로 본 패턴만 사용.
- 모든 텍스트 요체. "~다/~습니다" 금지.`;
}

// ── 한 영상 풀 파이프라인 (메타 + 자막 + 추출) ─────────────────────────
type VideoResult =
  | { ok: true; meta: VideoMeta; analysis: PerVideoOutput; segments: number }
  | {
      ok: false;
      url: string;
      videoId: string | null;
      meta: VideoMeta | null;
      reason: string;
    };

async function analyzeOneVideo(
  url: string,
  meta: VideoMeta | null,
): Promise<VideoResult> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return {
      ok: false,
      url,
      videoId: null,
      meta: null,
      reason: "URL에서 영상 ID 추출 실패",
    };
  }
  if (!meta) {
    return {
      ok: false,
      url,
      videoId,
      meta: null,
      reason: "영상 메타데이터 조회 실패 (비공개/삭제 여부 확인)",
    };
  }
  const segments = await tryFetchTranscriptSegments(videoId, meta.durationSec);
  if (!segments || segments.length === 0) {
    return {
      ok: false,
      url,
      videoId,
      meta,
      reason: "자막 없음 (자막 꺼져있거나 비공개)",
    };
  }
  const { text } = formatTranscript(segments);
  if (text.length < MIN_TRANSCRIPT_CHARS) {
    return {
      ok: false,
      url,
      videoId,
      meta,
      reason: "자막이 너무 짧음",
    };
  }
  const ai = getGeminiClient();
  const res = await withRetry(() =>
    ai.models.generateContent({
      model: FLASH_FULL_MODEL,
      contents: [
        { role: "user", parts: [{ text: buildPerVideoPrompt(meta, text) }] },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: PER_VIDEO_SCHEMA,
      },
    }),
  );
  const raw = res.text;
  if (!raw) {
    return { ok: false, url, videoId, meta, reason: "LLM 응답 비어있음" };
  }
  const analysis = JSON.parse(raw) as PerVideoOutput;
  // 초 값을 영상 길이로 clamp
  const clampSec = (n: unknown): number => {
    const v = typeof n === "number" ? n : Number(n) || 0;
    return Math.max(0, Math.min(meta.durationSec, Math.round(v)));
  };
  analysis.shortableMoments = (analysis.shortableMoments || []).map((m) => ({
    ...m,
    startSec: clampSec(m.startSec),
    endSec: clampSec(m.endSec),
  }));
  return { ok: true, meta, analysis, segments: segments.length };
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
    const rawUrls = Array.isArray(body?.urls) ? (body.urls as unknown[]) : [];
    const urls = rawUrls
      .map((u) => (typeof u === "string" ? u.trim() : ""))
      .filter(Boolean);
    const niche =
      typeof body?.niche === "string"
        ? (body.niche as string).trim() || undefined
        : undefined;
    const audience =
      typeof body?.audience === "string"
        ? (body.audience as string).trim() || undefined
        : undefined;

    if (urls.length === 0) {
      return NextResponse.json(
        { error: "최소 1개 이상의 유튜브 URL이 필요해요." },
        { status: 400 },
      );
    }
    if (urls.length > MAX_URLS) {
      return NextResponse.json(
        { error: `URL은 최대 ${MAX_URLS}개까지 가능해요.` },
        { status: 400 },
      );
    }

    // 1) 모든 영상 메타데이터를 한 번에 batch 호출
    const videoIds = urls
      .map((u) => extractVideoId(u))
      .filter((v): v is string => !!v);
    const metaMap = await fetchVideoMetaBatch(videoIds);

    // 2) Stage 1 — 영상별 골든 모먼트 추출 (병렬)
    const stage1: VideoResult[] = await Promise.all(
      urls.map((url) => {
        const vid = extractVideoId(url);
        const meta = vid ? metaMap[vid] || null : null;
        return analyzeOneVideo(url, meta).catch((e): VideoResult => ({
          ok: false,
          url,
          videoId: vid,
          meta,
          reason: e instanceof Error ? e.message : "분석 실패",
        }));
      }),
    );

    const successes = stage1.filter(
      (r): r is Extract<VideoResult, { ok: true }> => r.ok,
    );
    const failures = stage1.filter(
      (r): r is Extract<VideoResult, { ok: false }> => !r.ok,
    );

    if (successes.length === 0) {
      return NextResponse.json(
        {
          error: "분석할 수 있는 영상이 없어요. 자막 가능 여부를 확인해주세요.",
          perVideo: stage1.map((r, i) => ({
            index: i,
            ok: r.ok,
            title: r.ok ? r.meta.title : r.meta?.title || "",
            url: r.ok ? `https://youtu.be/${r.meta.videoId}` : r.url,
            reason: r.ok ? null : r.reason,
          })),
        },
        { status: 422 },
      );
    }

    // 3) Stage 2 — 플레이북 생성
    const ai = getGeminiClient();
    const playbookRes = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_FULL_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              {
                text: buildPlaybookPrompt(
                  successes.map((s) => ({ meta: s.meta, analysis: s.analysis })),
                  { niche, audience },
                ),
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: PLAYBOOK_SCHEMA,
        },
      }),
    );
    const playbookRaw = playbookRes.text;
    if (!playbookRaw) {
      return NextResponse.json(
        { error: "플레이북 생성 응답이 비어있어요." },
        { status: 500 },
      );
    }
    const playbook = JSON.parse(playbookRaw);

    // ideaBank의 sourceVideoIndex / sourceStartSec 안전성 보정
    if (Array.isArray(playbook.ideaBank)) {
      playbook.ideaBank = playbook.ideaBank.map(
        (idea: {
          sourceVideoIndex: number;
          sourceStartSec: number;
          [k: string]: unknown;
        }) => {
          const idx = Math.max(
            0,
            Math.min(successes.length - 1, Math.round(idea.sourceVideoIndex)),
          );
          const target = successes[idx];
          const clamped = Math.max(
            0,
            Math.min(
              target.meta.durationSec,
              Math.round(idea.sourceStartSec || 0),
            ),
          );
          return {
            ...idea,
            sourceVideoIndex: idx,
            sourceStartSec: clamped,
          };
        },
      );
    }

    return NextResponse.json({
      perVideo: stage1.map((r, i) => {
        if (r.ok) {
          return {
            index: i,
            ok: true,
            videoId: r.meta.videoId,
            title: r.meta.title,
            channel: r.meta.channel,
            thumbnail: r.meta.thumbnail,
            durationSec: r.meta.durationSec,
            views: r.meta.views,
            brief: r.analysis.brief,
            mainTopic: r.analysis.mainTopic,
            shortableMomentsCount: r.analysis.shortableMoments.length,
            shortableMoments: r.analysis.shortableMoments,
          };
        }
        return {
          index: i,
          ok: false,
          videoId: r.videoId,
          title: r.meta?.title || "",
          channel: r.meta?.channel || "",
          thumbnail: r.meta?.thumbnail || "",
          url: r.url,
          reason: r.reason,
        };
      }),
      // ideaBank가 어느 영상에서 왔는지 매핑할 수 있게, 성공 영상 인덱스를 노출
      successVideoIds: successes.map((s) => s.meta.videoId),
      successVideoTitles: successes.map((s) => s.meta.title),
      stats: {
        total: urls.length,
        analyzed: successes.length,
        failed: failures.length,
      },
      playbook,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
