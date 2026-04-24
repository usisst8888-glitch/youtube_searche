import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  searchShorts,
  getVideoStats,
  filterActualShorts,
  getTopComments,
  extractShoppingUrls,
  SearchItem,
  VideoStats,
} from "@/lib/youtube";
import {
  searchCoupangProducts,
  coupangSearchUrl,
  CoupangProduct,
  hasCoupangKeys,
} from "@/lib/coupang";

export const maxDuration = 180;
export const runtime = "nodejs";

type ExtractedProduct = {
  name: string;
  category: string;
  context: string;
  productUrls: string[];
  source: string;
};

type ProductWithSources = ExtractedProduct & {
  sources: {
    videoId: string;
    title: string;
    views: number;
    urls: string[];
  }[];
  coupang: CoupangProduct[] | null;
  coupangSearchUrl: string;
};

const PRODUCT_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    products: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          context: { type: "string" },
          productUrls: { type: "array", items: { type: "string" } },
          source: { type: "string" },
        },
        required: ["name", "category", "context", "productUrls", "source"],
      },
    },
  },
  required: ["products"],
};

function buildExtractPrompt(args: {
  videoId: string;
  title: string;
  description: string;
  topComments: string[];
  foundUrls: string[];
}): string {
  const { videoId, title, description, topComments, foundUrls } = args;
  return `당신은 한국 유튜브 쇼츠에서 **실제 판매되는 소비재 제품**을 추출하는 전문가입니다.

## 영상 정보

영상 제목: "${title}"

영상 URL: https://www.youtube.com/watch?v=${videoId}

영상 설명(description):
"""
${description || "(설명 없음)"}
"""

상단 댓글 (고정 댓글일 가능성 높음, 제품 정보/링크 자주 포함됨):
"""
${
  topComments.length
    ? topComments.map((c, i) => `[댓글 ${i + 1}] ${c}`).join("\n\n")
    : "(댓글 없음)"
}
"""

자동 추출된 URL 목록 (설명/댓글에서):
${foundUrls.length ? foundUrls.map((u) => `- ${u}`).join("\n") : "(URL 없음)"}

## 과제

위 정보를 바탕으로 영상에 등장/언급되는 **쿠팡 등에서 검색 가능한 구체적 제품**을 추출하세요.

## 🎯 추출 우선순위 (반드시 지킬 것)

1. **설명(description)에 제품명·링크가 있으면 최우선.** 정확도 가장 높음.
2. **상단 댓글에 제품명·링크가 있으면 두 번째.** (고정 댓글 = 크리에이터 공식 정보)
3. 1·2에 없으면 첨부된 영상을 시청/시각 분석하여 추출

## 각 제품 출력 형식

- **name**: 구체적 제품명 (브랜드+모델 우선)
  - 좋은 예: "다이슨 V15 Detect Slim", "닥터자르트 세라마이딘 크림"
  - 나쁜 예: "무선청소기", "크림" (너무 일반적)
  - 설명/댓글에 정확한 제품명이 있으면 **그대로** 사용
- **category**: 대분류 (가전 / 생활용품 / 식품 / 화장품 / 패션 / 문구 / 주방 등)
- **context**: 영상에서 어떻게 등장하는지 한 줄
- **productUrls**: 설명/댓글에서 발견된 **해당 제품 판매 링크** (쿠팡/스마트스토어/11번가 등)
  - 자동 추출 URL 목록에서 이 제품에 해당하는 것만 골라 넣기
  - 없으면 빈 배열 []
- **source**: "description" (설명에서), "comment" (댓글에서), "visual" (영상 시각 분석), "mixed" 중 하나

## 필터

✅ 가전, 생활용품, 식품, 화장품, 패션, 문구, 주방, 건강, 펫용품 등
❌ 일반 사물 (의자, 집, 하늘)
❌ 서비스/장소 (카페, 은행)
❌ 사람/동물
❌ 추상 개념

JSON으로 반환. 제품 0~5개. 중복 없이.`;
}

async function extractProductsFromVideo(
  videoId: string,
  title: string,
  description: string,
  topComments: string[],
): Promise<ExtractedProduct[]> {
  const ai = getGeminiClient();

  const allText = [
    description,
    ...topComments,
  ].join("\n\n");
  const foundUrls = extractShoppingUrls(allText);

  const prompt = buildExtractPrompt({
    videoId,
    title,
    description,
    topComments,
    foundUrls,
  });

  try {
    const parts: Part[] = [
      {
        fileData: {
          fileUri: `https://www.youtube.com/watch?v=${videoId}`,
          mimeType: "video/*",
        },
      },
      { text: prompt },
    ];
    const contents: Content[] = [{ role: "user", parts }];

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: PRODUCT_EXTRACT_SCHEMA,
        },
      }),
    );

    const text = response.text;
    if (!text) return [];
    const parsed = JSON.parse(text);
    return (parsed.products || []) as ExtractedProduct[];
  } catch {
    return [];
  }
}

function normalizeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[().,\-_/]/g, "");
}

export async function POST(req: NextRequest) {
  try {
    const { topic, maxVideos = 10 } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: "topic이 필요합니다." },
        { status: 400 },
      );
    }

    const youtubeKey = process.env.YOUTUBE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!youtubeKey || !geminiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY / GEMINI_API_KEY 가 필요합니다." },
        { status: 500 },
      );
    }

    // 1. YouTube 쇼츠 검색
    const publishedAfter = new Date(
      Date.now() - 90 * 24 * 60 * 60 * 1000,
    ).toISOString();
    let searched: SearchItem[] = await searchShorts(
      youtubeKey,
      topic,
      30,
      "KR",
      "ko",
      publishedAfter,
    );
    if (searched.length === 0) {
      return NextResponse.json(
        { error: "해당 주제로 YouTube 검색 결과가 없습니다." },
        { status: 404 },
      );
    }

    const stats = await getVideoStats(
      youtubeKey,
      searched.map((s) => s.videoId),
    );
    searched = searched.filter((s) => stats[s.videoId]?.isShorts);
    searched = await filterActualShorts(searched);

    const topShorts = [...searched]
      .sort(
        (a, b) =>
          (stats[b.videoId]?.views || 0) - (stats[a.videoId]?.views || 0),
      )
      .slice(0, Math.min(20, Math.max(3, Number(maxVideos))));

    if (topShorts.length === 0) {
      return NextResponse.json(
        { error: "실제 쇼츠가 없습니다." },
        { status: 404 },
      );
    }

    // 2. 각 쇼츠 분석 (병렬): description + 댓글 + URL + 영상 → 제품 추출
    const perVideo = await Promise.all(
      topShorts.map(async (s) => {
        const info = stats[s.videoId];
        const title = info?.title || "";
        const description = info?.description || "";
        const comments = await getTopComments(youtubeKey, s.videoId, 3);
        const products = await extractProductsFromVideo(
          s.videoId,
          title,
          description,
          comments,
        );
        const urls = extractShoppingUrls(
          [description, ...comments].join("\n\n"),
        );
        return {
          videoId: s.videoId,
          title,
          views: info?.views || 0,
          urls,
          products,
        };
      }),
    );

    // 3. 제품 중복 제거 + 소스 누적
    const productMap = new Map<string, ProductWithSources>();
    for (const v of perVideo) {
      for (const p of v.products) {
        if (!p.name?.trim()) continue;
        const key = normalizeKey(p.name);
        if (!productMap.has(key)) {
          productMap.set(key, {
            name: p.name,
            category: p.category,
            context: p.context,
            productUrls: p.productUrls || [],
            source: p.source,
            sources: [],
            coupang: null,
            coupangSearchUrl: coupangSearchUrl(p.name),
          });
        }
        const entry = productMap.get(key)!;
        const merged = new Set([...entry.productUrls, ...(p.productUrls || [])]);
        entry.productUrls = Array.from(merged);
        if (!entry.sources.find((x) => x.videoId === v.videoId)) {
          entry.sources.push({
            videoId: v.videoId,
            title: v.title,
            views: v.views,
            urls: v.urls,
          });
        }
      }
    }

    const unique = Array.from(productMap.values()).sort(
      (a, b) => b.sources.length - a.sources.length,
    );

    // 4. 쿠팡 검색 (키 있을 때만)
    const withCoupang = await Promise.all(
      unique.map(async (p) => {
        const coupang = await searchCoupangProducts(p.name, 3);
        return { ...p, coupang };
      }),
    );

    const videoStats: Record<
      string,
      Pick<VideoStats, "title" | "views" | "thumbnail">
    > = {};
    for (const s of topShorts) {
      const v = stats[s.videoId];
      if (v) {
        videoStats[s.videoId] = {
          title: v.title,
          views: v.views,
          thumbnail: v.thumbnail,
        };
      }
    }

    return NextResponse.json({
      topic,
      products: withCoupang,
      videos: videoStats,
      coupangEnabled: hasCoupangKeys(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
