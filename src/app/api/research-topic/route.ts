import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  searchShorts,
  getVideoStats,
  filterActualShorts,
  SearchItem,
  VideoStats,
} from "@/lib/youtube";
import {
  searchCoupangProducts,
  coupangSearchUrl,
  CoupangProduct,
  hasCoupangKeys,
} from "@/lib/coupang";

export const maxDuration = 120;
export const runtime = "nodejs";

type ExtractedProduct = {
  name: string;
  category: string;
  context: string;
};

type ProductWithSources = ExtractedProduct & {
  sources: { videoId: string; title: string; views: number }[];
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
        },
        required: ["name", "category", "context"],
      },
    },
  },
  required: ["products"],
};

async function extractProductsFromVideo(
  videoId: string,
  title: string,
): Promise<ExtractedProduct[]> {
  const ai = getGeminiClient();
  const prompt = `당신은 한국 유튜브 쇼츠에서 등장/언급되는 **소비재 제품**을 식별하는 전문가입니다.

영상 제목: "${title}"
영상 URL: https://www.youtube.com/watch?v=${videoId}

첨부된 영상을 시청/청취하고 **쿠팡에서 검색 가능한 구체적인 소비재**를 추출하세요.

추출 기준:
✅ 가전, 생활용품, 식품, 화장품, 패션, 문구, 주방, 건강용품 등 소비재
✅ 브랜드명이 드러나면 브랜드+제품명 형태 (예: "다이슨 V15", "닥터자르트 세럼")
✅ 브랜드 모를 땐 카테고리명 + 특징 (예: "무선청소기", "홍삼 스틱")
❌ 일반 사물 (의자, 집, 하늘) 제외
❌ 서비스/장소 (카페, 은행) 제외
❌ 사람/동물 제외

각 제품에 대해:
- name: 쿠팡에서 검색 가능한 제품명
- category: 대분류 (가전 / 생활용품 / 식품 / 화장품 / 패션 등)
- context: 영상에서 어떻게 등장하는지 한 줄 (예: "썸네일에 중앙 배치", "3초 구간에 클로즈업")

JSON 형식으로 반환. 제품 0~5개, 많으면 상위 5개만.`;

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

    // 1. YouTube 쇼츠 검색 (최근 90일, 조회수 순)
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

    // 2. 각 쇼츠 병렬 분석 → 제품 추출
    const perVideo = await Promise.all(
      topShorts.map(async (s) => {
        const title = stats[s.videoId]?.title || "";
        const products = await extractProductsFromVideo(s.videoId, title);
        return {
          videoId: s.videoId,
          title,
          views: stats[s.videoId]?.views || 0,
          products,
        };
      }),
    );

    // 3. 제품 중복 제거 + 소스 영상 누적
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
            sources: [],
            coupang: null,
            coupangSearchUrl: coupangSearchUrl(p.name),
          });
        }
        const entry = productMap.get(key)!;
        if (!entry.sources.find((x) => x.videoId === v.videoId)) {
          entry.sources.push({
            videoId: v.videoId,
            title: v.title,
            views: v.views,
          });
        }
      }
    }

    // 등장 횟수 순 정렬 (많이 나올수록 트렌딩)
    const unique = Array.from(productMap.values()).sort(
      (a, b) => b.sources.length - a.sources.length,
    );

    // 4. 쿠팡 검색 병렬 (키 있을 때만)
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
