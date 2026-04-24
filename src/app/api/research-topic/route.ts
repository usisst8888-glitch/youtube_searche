import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  searchShorts,
  getVideoStats,
  filterActualShorts,
  getTopComments,
  extractShoppingUrls,
  productSignalScore,
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
  return `당신은 한국 유튜브 쇼츠 **영상에 실제로 보이는 제품**을 추출하는 전문가입니다.

## 영상 정보

영상 제목: "${title}"

영상 URL: https://www.youtube.com/watch?v=${videoId}

영상 설명(description) — **참고용만**, 여기에만 언급된 제품은 절대 추출하지 말 것:
"""
${description || "(설명 없음)"}
"""

상단 댓글 — **참고용만**:
"""
${
  topComments.length
    ? topComments.map((c, i) => `[댓글 ${i + 1}] ${c}`).join("\n\n")
    : "(댓글 없음)"
}
"""

자동 추출된 URL 목록 (설명/댓글, 참고용):
${foundUrls.length ? foundUrls.map((u) => `- ${u}`).join("\n") : "(URL 없음)"}

## 🎯 가장 중요한 원칙 — **영상에 시각적으로 보이는 제품만 추출**

**반드시 지켜야 할 규칙:**
1. ✅ 첨부된 YouTube 영상을 시청하고, **화면에 실제로 등장하는 제품**만 추출
2. ❌ 설명(description)이나 댓글에만 언급된 제품은 **절대 추출하지 마세요**
   - description에 10개 제품 링크가 있어도, 영상에 안 나오는 건 무시
   - 댓글 광고 링크/제휴 링크도 무시
3. ✅ description/댓글은 **영상에 보이는 제품의 정확한 브랜드·모델명을 확인**할 때만 사용
   - 예: 영상에 무선청소기가 보이는데, description에 "다이슨 V15 Detect Slim"이라고 써있으면 그 이름 사용
4. ❌ 영상에 제품이 하나도 안 보이면 빈 배열 반환

## 각 제품 출력 형식

- **name**: 구체적 제품명 (브랜드+모델 우선, description에서 확인 가능하면 그대로)
  - 좋은 예: "다이슨 V15 Detect Slim", "닥터자르트 세라마이딘 크림"
  - 나쁜 예: "무선청소기", "크림" (너무 일반적 — 브랜드 확인 안 되면 차라리 빼기)
- **category**: 대분류 (가전 / 생활용품 / 식품 / 화장품 / 패션 / 문구 / 주방 등)
- **context**: 영상 속 **몇 초 구간/어떤 장면**에 나오는지 구체적으로 한 줄
  - 예: "0~3초 썸네일에 클로즈업", "5초 구간 책상 위에 놓여있음"
- **productUrls**: description/댓글에 이 제품의 판매 링크가 있으면 넣기, 없으면 []
- **source**: 항상 "visual" (이 과제는 시각 기반 추출만)

## 필터

✅ 가전, 생활용품, 식품, 화장품, 패션, 문구, 주방, 건강, 펫용품 등
❌ 일반 사물 (의자, 집, 하늘)
❌ 서비스/장소 (카페, 은행)
❌ 사람/동물
❌ 추상 개념
❌ description/댓글에만 있고 영상에 안 보이는 제품

JSON으로 반환. 제품 0~5개. 영상에 제품이 없으면 빈 배열.`;
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
    const { topic, searchKeyword, maxVideos = 10 } = await req.json();

    if (!topic || typeof topic !== "string") {
      return NextResponse.json(
        { error: "topic이 필요합니다." },
        { status: 400 },
      );
    }
    const queryForYouTube: string =
      typeof searchKeyword === "string" && searchKeyword.trim()
        ? searchKeyword.trim()
        : topic;

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
      queryForYouTube,
      30,
      "KR",
      "ko",
      publishedAfter,
    );
    if (searched.length === 0) {
      return NextResponse.json(
        {
          error: `"${queryForYouTube}"로 YouTube 검색 결과가 없습니다. 더 짧은 키워드로 시도해보세요.`,
        },
        { status: 404 },
      );
    }

    const stats = await getVideoStats(
      youtubeKey,
      searched.map((s) => s.videoId),
    );
    searched = searched.filter((s) => stats[s.videoId]?.isShorts);
    searched = await filterActualShorts(searched);

    // 사전 필터: title/description에 쇼핑 신호 있는 영상만 우선
    const scoredShorts = searched.map((s) => {
      const v = stats[s.videoId];
      return {
        item: s,
        views: v?.views || 0,
        score: productSignalScore(v?.title || "", v?.description || ""),
      };
    });

    const hasSignal = scoredShorts
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || b.views - a.views);

    const maxV = Math.min(20, Math.max(3, Number(maxVideos)));
    let topShorts: SearchItem[];
    let filteredOutCount = 0;

    if (hasSignal.length >= 3) {
      // 신호 있는 영상만 사용
      topShorts = hasSignal.slice(0, maxV).map((x) => x.item);
      filteredOutCount = searched.length - hasSignal.length;
    } else {
      // 신호가 너무 적으면 조회수 fallback (결과 보장)
      topShorts = scoredShorts
        .sort((a, b) => b.score - a.score || b.views - a.views)
        .slice(0, maxV)
        .map((x) => x.item);
    }

    if (topShorts.length === 0) {
      return NextResponse.json(
        { error: "분석할 쇼츠가 없습니다." },
        { status: 404 },
      );
    }

    // 2. 각 쇼츠 분석 (병렬): description + 댓글 + URL + 영상 → 제품 추출
    const perVideoAll = await Promise.all(
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

    // 사후 필터: 제품이 0개 추출된 영상은 제외
    const perVideo = perVideoAll.filter((v) => v.products.length > 0);
    const zeroProductCount = perVideoAll.length - perVideo.length;

    // 3. 제품 중복 제거 + 소스 누적 (visual 출처만 허용)
    const productMap = new Map<string, ProductWithSources>();
    for (const v of perVideo) {
      for (const p of v.products) {
        if (!p.name?.trim()) continue;
        // 영상에 실제 보이는 제품만 통과 (visual / mixed 허용, description·comment 배제)
        const src = (p.source || "").toLowerCase();
        if (!(src.includes("visual") || src === "mixed")) continue;
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
    for (const v of perVideo) {
      const info = stats[v.videoId];
      if (info) {
        videoStats[v.videoId] = {
          title: info.title,
          views: info.views,
          thumbnail: info.thumbnail,
        };
      }
    }

    return NextResponse.json({
      topic,
      products: withCoupang,
      videos: videoStats,
      coupangEnabled: hasCoupangKeys(),
      filter: {
        prefilteredOut: filteredOutCount,
        analyzed: topShorts.length,
        zeroProductSkipped: zeroProductCount,
        kept: perVideo.length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
