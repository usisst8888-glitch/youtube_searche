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

## 🎯 가장 중요한 원칙 — **"주연 제품"만 추출**

이 영상이 **제품 리뷰/꿀템 추천 영상**이라면, 영상의 **중심 소재가 되는 제품** 1~2개만 추출합니다.
만약 이 영상이 제품 중심이 아니라 일반 브이로그/장면 소개라면, **빈 배열**을 반환하세요.

### 반드시 지켜야 할 규칙
1. ✅ 영상의 **주제·주연**이 되는 제품만 추출 (크리에이터가 대놓고 소개·리뷰하는 제품)
2. ❌ 배경에 스쳐지나가는 일상 소품은 **절대 금지**
   - 예: 도시락, 물통, 주차 정산기, 의자, 일반 가구, 핸드폰 등 배경 소품 → ❌
3. ❌ **영상당 최대 2개**. 제품이 더 보여도 가장 중심적인 것만.
4. ❌ 설명·댓글에만 언급되고 영상에 안 나오는 건 금지
5. ✅ description/댓글은 **영상에 보이는 주연 제품의 브랜드명·모델명 확인용**으로만 참고

### 주연 vs 배경 판단 기준
- **주연**: 영상에서 클로즈업 / 사용 동작 시연 / 화면 중앙에 여러 번 / 크리에이터가 설명
- **배경**: 화면 귀퉁이 / 한 번 스쳐지나감 / 설명 없음 / 다른 주연 옆에 놓여있을 뿐

## 각 제품 출력 형식

- **name**: 구체적 제품명 (브랜드+모델 우선)
  - 좋은 예: "다이슨 V15 Detect Slim", "코베아 원터치 텐트"
  - 나쁜 예: "텐트", "크림", "도시락" (일반 사물·너무 포괄적)
- **category**: 대분류 (가전 / 생활용품 / 식품 / 화장품 / 패션 / 문구 / 주방 등)
- **context**: 이 제품이 왜 **주연**인지 한 줄 (영상 속 역할·클로즈업 여부)
- **productUrls**: description/댓글에 이 제품의 판매 링크가 있으면 넣기, 없으면 []
- **source**: 항상 "visual"

## 필터

✅ 가전, 생활용품, 식품, 화장품, 패션, 문구, 주방, 건강, 펫용품 중 주연 제품
❌ 배경 소품, 일상 잡화
❌ 일반 사물 / 서비스 / 장소 / 사람 / 동물
❌ description/댓글에만 있고 영상에 안 보이는 것

**영상이 제품 리뷰가 아니면 빈 배열 []. 주연 제품 1~2개만. 3개 이상 금지.**

JSON 반환.`;
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

    // 사전 필터: 제목에 강한 제품 신호(꿀템/TOP/VS 등)가 있거나,
    // 설명에 쇼핑 URL이 있는 영상만 통과 (score >= 3)
    const MIN_SCORE = 3;
    const scoredShorts = searched.map((s) => {
      const v = stats[s.videoId];
      return {
        item: s,
        views: v?.views || 0,
        score: productSignalScore(v?.title || "", v?.description || ""),
      };
    });

    const strong = scoredShorts
      .filter((x) => x.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || b.views - a.views);

    const maxV = Math.min(20, Math.max(3, Number(maxVideos)));
    let topShorts: SearchItem[];
    let filteredOutCount = 0;

    if (strong.length >= 3) {
      // 강한 제품 신호 있는 영상만
      topShorts = strong.slice(0, maxV).map((x) => x.item);
      filteredOutCount = searched.length - strong.length;
    } else {
      // 너무 적으면 약한 신호도 포함 (score > 0)
      const anySignal = scoredShorts
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || b.views - a.views);
      if (anySignal.length >= 3) {
        topShorts = anySignal.slice(0, maxV).map((x) => x.item);
        filteredOutCount = searched.length - anySignal.length;
      } else {
        topShorts = scoredShorts
          .sort((a, b) => b.score - a.score || b.views - a.views)
          .slice(0, maxV)
          .map((x) => x.item);
      }
    }

    if (topShorts.length === 0) {
      return NextResponse.json(
        { error: "분석할 쇼츠가 없습니다." },
        { status: 404 },
      );
    }

    // 2. 각 쇼츠 분석 (병렬): description + 댓글 + URL + 영상 → 제품 추출
    const MAX_PRODUCTS_PER_VIDEO = 2;
    const perVideoAll = await Promise.all(
      topShorts.map(async (s) => {
        const info = stats[s.videoId];
        const title = info?.title || "";
        const description = info?.description || "";
        const comments = await getTopComments(youtubeKey, s.videoId, 3);
        const rawProducts = await extractProductsFromVideo(
          s.videoId,
          title,
          description,
          comments,
        );
        // 영상당 최대 2개 (프롬프트 불복 안전장치)
        const products = rawProducts.slice(0, MAX_PRODUCTS_PER_VIDEO);
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
