import { NextRequest, NextResponse } from "next/server";
import {
  searchShorts,
  getVideoStats,
  filterActualShorts,
  getTopComments,
  extractShoppingUrls,
  isProductReviewTitle,
  SearchItem,
} from "@/lib/youtube";
import {
  fetchYoutubeShoppingProducts,
  YoutubeShoppingProduct,
} from "@/lib/youtube-shopping";
import { hasCoupangKeys } from "@/lib/coupang";

export const maxDuration = 180;
export const runtime = "nodejs";

type VideoResult = {
  videoId: string;
  title: string;
  thumbnail: string;
  views: number;
  publishedAt: string;
  descriptionPreview: string;
  topComments: string[];
  shoppingUrls: string[];
  shoppingProducts: YoutubeShoppingProduct[];
};

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export async function POST(req: NextRequest) {
  try {
    const { topic, searchKeyword, maxVideos = 15 } = await req.json();

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
    if (!youtubeKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY가 필요합니다." },
        { status: 500 },
      );
    }

    // 1. YouTube 쇼츠 검색 (최근 90일, 조회수 순)
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

    // 2. 제목 필터 (제품 리뷰 쇼츠 힌트)
    const reviewOnly = searched.filter((s) =>
      isProductReviewTitle(stats[s.videoId]?.title || ""),
    );

    // 제목 필터로 너무 많이 걸러지면 원본도 포함 (아래에서 쇼핑 태그로 재필터링)
    const baseList = reviewOnly.length >= 3 ? reviewOnly : searched;
    const filteredByTitleCount = searched.length - reviewOnly.length;

    const maxV = Math.min(25, Math.max(5, Number(maxVideos)));
    const candidates = [...baseList]
      .sort(
        (a, b) =>
          (stats[b.videoId]?.views || 0) - (stats[a.videoId]?.views || 0),
      )
      .slice(0, maxV);

    // 3. 각 영상의 "제품 보기" (YouTube Shopping 태그) 가져오기
    //    + 부수 데이터 (설명/댓글/URL)
    const enriched = await Promise.all(
      candidates.map(async (s) => {
        const info = stats[s.videoId];
        const [comments, shoppingProducts] = await Promise.all([
          getTopComments(youtubeKey, s.videoId, 5),
          fetchYoutubeShoppingProducts(s.videoId),
        ]);
        const allText = [info?.description || "", ...comments].join("\n\n");
        const urls = extractShoppingUrls(allText);
        const result: VideoResult = {
          videoId: s.videoId,
          title: info?.title || "",
          thumbnail: info?.thumbnail || "",
          views: info?.views || 0,
          publishedAt: info?.publishedAt?.slice(0, 10) || "",
          descriptionPreview: truncate(info?.description || "", 400),
          topComments: comments.slice(0, 3),
          shoppingUrls: urls,
          shoppingProducts,
        };
        return result;
      }),
    );

    // 4. "제품 보기" 태그가 있는 영상만 반환 (핵심 필터)
    const withShopping = enriched.filter(
      (v) => v.shoppingProducts.length > 0,
    );
    const noShoppingCount = enriched.length - withShopping.length;

    if (withShopping.length === 0) {
      return NextResponse.json(
        {
          error:
            "\"제품 보기\" (YouTube Shopping) 태그가 있는 영상을 찾지 못했습니다. 다른 키워드로 시도해보세요.",
          filter: {
            searched: searched.length,
            titleFiltered: filteredByTitleCount,
            inspected: enriched.length,
            withShopping: 0,
          },
        },
        { status: 404 },
      );
    }

    withShopping.sort((a, b) => b.views - a.views);

    return NextResponse.json({
      topic,
      searchKeyword: queryForYouTube,
      videos: withShopping,
      coupangEnabled: hasCoupangKeys(),
      filter: {
        searched: searched.length,
        titleFiltered: filteredByTitleCount,
        inspected: enriched.length,
        noShoppingSkipped: noShoppingCount,
        returned: withShopping.length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
