import { NextRequest, NextResponse } from "next/server";
import {
  searchShorts,
  getVideoStats,
  getChannelUploads,
  getRecentVideoIds,
  filterActualShorts,
  getTopComments,
  extractShoppingUrls,
  isProductReviewTitle,
  median,
  SearchItem,
} from "@/lib/youtube";
import {
  fetchYoutubeShoppingProducts,
  YoutubeShoppingProduct,
} from "@/lib/youtube-shopping";
import { channelBaselineCache } from "@/lib/cache";
import { hasCoupangKeys } from "@/lib/coupang";

export const maxDuration = 180;
export const runtime = "nodejs";

type VideoResult = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  thumbnail: string;
  views: number;
  publishedAt: string;
  descriptionPreview: string;
  topComments: string[];
  shoppingUrls: string[];
  shoppingProducts: YoutubeShoppingProduct[];
  channelMedian: number | null;
  viewRatio: number | null;
};

function truncate(s: string, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// 병렬 호출 동시성 제한 (YouTube watch 페이지 과다 요청 방지)
async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }).map(
    async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) break;
        out[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const { topic, searchKeyword, maxVideos = 50 } = await req.json();

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

    // 1. YouTube 쇼츠 검색 (최근 180일로 확대, 조회수 순)
    const publishedAfter = new Date(
      Date.now() - 180 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const searchMax = Math.min(50, Math.max(20, Number(maxVideos)));
    let searched: SearchItem[] = await searchShorts(
      youtubeKey,
      queryForYouTube,
      searchMax,
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

    const searchedCount = searched.length;

    // 2. 조회수 순 정렬 (제목 필터는 제거 — 제품 보기 태그 유무로만 판단)
    const ordered = [...searched].sort(
      (a, b) =>
        (stats[b.videoId]?.views || 0) - (stats[a.videoId]?.views || 0),
    );

    // 3. 각 영상의 "제품 보기" 태그 병렬 확인 (동시성 8)
    const enriched = await pMapLimit(ordered, 8, async (s) => {
      const info = stats[s.videoId];
      const [comments, shoppingProducts] = await Promise.all([
        getTopComments(youtubeKey, s.videoId, 5),
        fetchYoutubeShoppingProducts(s.videoId),
      ]);
      const allText = [info?.description || "", ...comments].join("\n\n");
      const urls = extractShoppingUrls(allText);
      const result: VideoResult = {
        videoId: s.videoId,
        channelId: s.channelId,
        channelTitle: s.channelTitle,
        title: info?.title || "",
        thumbnail: info?.thumbnail || "",
        views: info?.views || 0,
        publishedAt: info?.publishedAt?.slice(0, 10) || "",
        descriptionPreview: truncate(info?.description || "", 400),
        topComments: comments.slice(0, 3),
        shoppingUrls: urls,
        shoppingProducts,
        channelMedian: null,
        viewRatio: null,
      };
      return result;
    });

    // 4. "제품 보기" 태그가 있는 영상만 반환
    const withShopping = enriched.filter(
      (v) => v.shoppingProducts.length > 0,
    );

    const titleReviewCount = ordered.filter((s) =>
      isProductReviewTitle(stats[s.videoId]?.title || ""),
    ).length;

    // 5. 각 영상 채널의 쇼츠 중앙값 대비 조회수 비율 계산
    if (withShopping.length > 0) {
      const uniqueChannels = Array.from(
        new Set(withShopping.map((v) => v.channelId).filter(Boolean)),
      );
      try {
        const channelInfo = await getChannelUploads(
          youtubeKey,
          uniqueChannels,
        );
        const baselineMap: Record<string, number | null> = {};

        await pMapLimit(
          Object.entries(channelInfo),
          5,
          async ([chId, info]) => {
            const cached = channelBaselineCache.get(chId);
            if (cached !== undefined) {
              baselineMap[chId] = cached ? cached.median : null;
              return;
            }
            try {
              const recentIds = await getRecentVideoIds(
                youtubeKey,
                info.uploads,
                30,
              );
              if (!recentIds.length) {
                channelBaselineCache.set(chId, null);
                baselineMap[chId] = null;
                return;
              }
              const recentStats = await getVideoStats(youtubeKey, recentIds);
              const shortsViews = Object.values(recentStats)
                .filter((v) => v.isShorts && v.views > 0)
                .map((v) => v.views);
              if (shortsViews.length >= 5) {
                const entry = {
                  median: median(shortsViews),
                  max: Math.max(...shortsViews),
                  count: shortsViews.length,
                };
                channelBaselineCache.set(chId, entry);
                baselineMap[chId] = entry.median;
              } else {
                channelBaselineCache.set(chId, null);
                baselineMap[chId] = null;
              }
            } catch {
              baselineMap[chId] = null;
            }
          },
        );

        for (const v of withShopping) {
          const medianViews = baselineMap[v.channelId];
          if (medianViews && medianViews > 0) {
            v.channelMedian = Math.round(medianViews);
            v.viewRatio = Math.round((v.views / medianViews) * 10) / 10;
          }
        }
      } catch {
        // ignore baseline errors
      }
    }

    if (withShopping.length === 0) {
      return NextResponse.json(
        {
          error: `"${queryForYouTube}" 검색 결과 ${searchedCount}개 쇼츠 전부에 YouTube Shopping "제품 보기" 태그가 없습니다. 한국에서 이 기능을 설정한 크리에이터가 적을 수 있어요. 다른 키워드로 시도하거나, 쇼핑 태그가 흔한 카테고리(뷰티/패션/가전)로 바꿔보세요.`,
          filter: {
            searched: searchedCount,
            titleReviewMatches: titleReviewCount,
            inspected: enriched.length,
            noShoppingSkipped: enriched.length,
            returned: 0,
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
        searched: searchedCount,
        titleReviewMatches: titleReviewCount,
        inspected: enriched.length,
        noShoppingSkipped: enriched.length - withShopping.length,
        returned: withShopping.length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
