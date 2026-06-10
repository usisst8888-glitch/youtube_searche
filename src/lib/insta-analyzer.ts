// 인스타 영상 → Gemini로 (1) 전사 (2) 어그로 제목 (3) 4씬 쇼츠 대본
// (4) 샤오홍슈/도우인 검색용 제품 키워드 추출
//
// 인스타 reel은 보통 ~10MB 이내라 inline data 로 처리. 더 큰 영상이 들어오면
// MAX_VIDEO_BYTES 에서 거절.

import type { Part } from "@google/genai";
import { getGeminiClient, FLASH_FULL_MODEL, withRetry } from "@/lib/gemini";

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB 상한

// ── Gemini 응답 스키마 ──────────────────────────────────────────────────
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    transcript: { type: "string" },
    videoSummary: { type: "string" },
    videoTitle: { type: "string" },
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
    productKeywords: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          lang: { type: "string" }, // 'ko' | 'zh'
          note: { type: "string" },
        },
        required: ["keyword", "lang"],
      },
    },
  },
  required: [
    "transcript",
    "videoSummary",
    "videoTitle",
    "storyPremise",
    "newScenes",
    "productKeywords",
  ],
};

// ── 프롬프트 ────────────────────────────────────────────────────────────
function buildPrompt(captionHint: string): string {
  return `당신은 한국 쇼츠/릴스 **retention 마스터**이자 영상 분석가입니다.
첨부된 영상은 인스타그램 릴스/포스트 한 편입니다.
이걸 끝까지 시청하고 아래 5가지를 동시에 뽑아주세요.

${captionHint ? `## 인스타 caption (참고만 — 영상 내용이 우선):\n${captionHint}\n` : ""}

## 1) transcript — 영상에서 들리는 말을 **그대로 받아쓰기**
- 영상 안의 내레이션/대사/자막을 시간 순서대로 한국어로 옮길 것.
- 화면 자막(텍스트 오버레이)이 따로 보이면 [자막] 표기로 같이 적기.
- 말이 없으면 [무음] / 배경음만이면 [BGM] 으로 표기.
- 외국어가 들리면 그대로 적은 뒤 괄호 안에 한국어 번역.
- 200~600자.

## 2) videoSummary — 영상 한 줄 요약 (객관적)
- 무슨 영상인지 1~2문장 요체. 본 것만 사실대로.

## 3) videoTitle — 어그로 후크 제목 (자극적)
- 한국 YouTube Shorts 만렙 어그로 룰:
  - 본문의 가장 자극적 단어 하나만 떼다 인물/주제 옆에 박기 (오해 유도)
  - 끝에 \`???\` 또는 \`...\` 로 봉인
  - 30~60자. 인물/숫자/자극단어 3박자
  - 정직한 묘사·뉴스체 ❌. "~의 진실/비밀" 안전한 제목 ❌
- 영상에 인물이 없으면 핵심 소재(제품/사건/상황)를 인물 자리에 넣기.

## 4) newScenes — 영상을 본떠 **새로 만든** 4씬 쇼츠 대본
- 정확히 4씬 (index 0~3). durationSec 8. 총 32초.
- 각 씬 65~95자. 모든 문장 **요체 (반말존대)** — \`~다 / ~습니다\` 금지.
- emotion = "배경" / "디테일" / "문제" / "반전" 순서.
- 씬 1은 **0.5초 후킹** — 가장 충격적 순간을 맨 앞에.
- 씬 1~3 끝은 cliffhanger, 씬 4는 반전 종료 (CTA 금지).
- storyPremise: 4단계를 어떻게 풀지 2~3줄 요체.

## 5) productKeywords — 샤오홍슈/도우인 검색용 키워드 (가장 중요)
- 이 영상에 나오는 **제품/제품군/소재**를 식별하고, 중국 플랫폼에서 비슷한 영상을 찾을 수 있는 검색어를 뽑을 것.
- 한국어 키워드 **3개** + 중국어(简体) 키워드 **3개**, 총 6개.
- 너무 일반적(예: "화장품")이면 ❌. 구체적인 제품군/카테고리/특징어로:
  - 예) "리들샷 앰플", "더모 글로우 토너", "보들레이 베이지 립", "鸭嘴夹 美甲", "椭圆刷 高光"
- note 필드에는 왜 이 키워드를 골랐는지 짧게 (선택).
- lang: 'ko' 또는 'zh'.
- 한국어 키워드는 한국어로, 중국어 키워드는 简体 中文로.

## 출력 JSON 키
transcript, videoSummary, videoTitle, storyPremise, newScenes, productKeywords`;
}

// ── 정규화 헬퍼 ─────────────────────────────────────────────────────────
function koreanizeYoche(s: string): string {
  // 가장 흔한 ~습니다/~ㅂ니다 → ~요로 강제 변환 (얕은 후처리)
  return s
    .replace(/합니다(?=[^가-힣])/g, "해요")
    .replace(/입니다(?=[^가-힣])/g, "이에요")
    .replace(/없습니다(?=[^가-힣])/g, "없어요")
    .replace(/있습니다(?=[^가-힣])/g, "있어요")
    .replace(/됩니다(?=[^가-힣])/g, "돼요")
    .replace(/같습니다(?=[^가-힣])/g, "같아요");
}

// ── 메인 ────────────────────────────────────────────────────────────────
export type AnalysisResult = {
  transcript: string;
  videoSummary: string;
  videoTitle: string;
  storyPremise: string;
  scenes: {
    index: number;
    text: string;
    emotion: string;
    durationSec: number;
  }[];
  productKeywords: { keyword: string; lang: "ko" | "zh"; note?: string }[];
  model: string;
};

/** 인스타 CDN에서 영상을 다운받아 buffer로 반환 (referer 필요) */
export async function downloadInstaVideo(
  videoUrl: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const upstream = await fetch(videoUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      Referer: "https://www.instagram.com/",
      Accept: "video/*,*/*;q=0.8",
    },
    redirect: "follow",
  });
  if (!upstream.ok) {
    throw new Error(`영상 다운로드 실패: ${upstream.status}`);
  }
  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.byteLength > MAX_VIDEO_BYTES) {
    throw new Error(
      `영상이 너무 큽니다 (${Math.round(buffer.byteLength / 1024 / 1024)}MB > ${
        MAX_VIDEO_BYTES / 1024 / 1024
      }MB)`,
    );
  }
  const mimeType =
    upstream.headers.get("content-type")?.split(";")[0]?.trim() || "video/mp4";
  return { buffer, mimeType };
}

/** 영상 buffer를 Gemini에 inline 전송 → 분석 결과 반환 */
export async function analyzeInstaVideoFromBuffer(
  buffer: Buffer,
  mimeType: string,
  captionHint: string = "",
): Promise<AnalysisResult> {
  const ai = getGeminiClient();
  const videoPart: Part = {
    inlineData: { mimeType, data: buffer.toString("base64") },
  };

  const res = await withRetry(() =>
    ai.models.generateContent({
      model: FLASH_FULL_MODEL,
      contents: [
        {
          role: "user",
          parts: [videoPart, { text: buildPrompt(captionHint) }],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: ANALYSIS_SCHEMA,
      },
    }),
  );

  const text = res.text;
  if (!text) throw new Error("Gemini 응답이 비어있습니다.");

  const parsed = JSON.parse(text) as {
    transcript?: string;
    videoSummary?: string;
    videoTitle?: string;
    storyPremise?: string;
    newScenes?: {
      index?: number;
      text?: string;
      emotion?: string;
      durationSec?: number;
    }[];
    productKeywords?: { keyword?: string; lang?: string; note?: string }[];
  };

  const scenes = (parsed.newScenes || []).map((sc, i) => ({
    index: typeof sc.index === "number" ? sc.index : i,
    text: koreanizeYoche(sc.text || ""),
    emotion: sc.emotion || "",
    durationSec: typeof sc.durationSec === "number" ? sc.durationSec : 8,
  }));

  const keywords = (parsed.productKeywords || [])
    .map((k) => ({
      keyword: (k.keyword || "").trim(),
      lang: (k.lang === "zh" ? "zh" : "ko") as "ko" | "zh",
      note: k.note,
    }))
    .filter((k) => k.keyword.length > 0);

  return {
    transcript: (parsed.transcript || "").trim(),
    videoSummary: koreanizeYoche((parsed.videoSummary || "").trim()),
    videoTitle: (parsed.videoTitle || "").trim(),
    storyPremise: koreanizeYoche((parsed.storyPremise || "").trim()),
    scenes,
    productKeywords: keywords,
    model: FLASH_FULL_MODEL,
  };
}

// ── 인스타 shortcode 파서 (별도 페이지에서 URL 받을 때) ────────────────
export function extractShortcodeFromUrl(url: string): string | null {
  // https://www.instagram.com/{p|reel|tv}/{shortcode}/
  const m = url.match(
    /instagram\.com\/(?:p|reel|tv|reels)\/([A-Za-z0-9_-]+)/i,
  );
  return m ? m[1] : null;
}
