import { NextRequest, NextResponse } from "next/server";
import {
  searchShorts,
  getVideoStats,
  getChannelUploads,
  getRecentVideoIds,
  filterActualShorts,
  isExcludedChannel,
  DEFAULT_EXCLUDE_KEYWORDS,
  median,
  OutlierResult,
} from "@/lib/youtube";

export const maxDuration = 60;
export const runtime = "nodejs";

const CHANNEL_FETCH = 50;
const MIN_SHORTS_FOR_BASELINE = 5;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      keyword = "",
      searchMax = 50,
      outlierThreshold = 3.0,
      region = "KR",
      language = "ko",
      publishedWithinDays = 90,
      excludeKeywords,
      videoCategoryId = "",
      maxSubscribers = 0,
    } = body;

    const excludeList: string[] = Array.isArray(excludeKeywords)
      ? excludeKeywords
      : DEFAULT_EXCLUDE_KEYWORDS;

    const maxSubs = Math.max(0, Number(maxSubscribers) || 0);

    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "서버에 YOUTUBE_API_KEY가 설정되지 않았습니다. .env.local 또는 Vercel 환경변수를 확인하세요.",
        },
        { status: 500 },
      );
    }
    if (!keyword && !videoCategoryId) {
      return NextResponse.json(
        { error: "키워드 또는 카테고리 중 하나는 선택하세요." },
        { status: 400 },
      );
    }

    const days = Number(publishedWithinDays);
    const publishedAfter =
      days > 0
        ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

    let searched = await searchShorts(
      apiKey,
      keyword,
      Math.min(100, Math.max(1, Number(searchMax))),
      region,
      language,
      publishedAfter,
      videoCategoryId || undefined,
    );

    if (searched.length === 0) {
      return NextResponse.json({
        total: 0,
        outlierCount: 0,
        threshold: outlierThreshold,
        results: [],
        message: "검색 결과가 없습니다.",
      });
    }

    searched = searched.filter(
      (s) => !isExcludedChannel(s.channelTitle, excludeList),
    );

    const searchedStats = await getVideoStats(
      apiKey,
      searched.map((s) => s.videoId),
    );
    searched = searched.filter((s) => searchedStats[s.videoId]?.isShorts);
    searched = await filterActualShorts(searched);

    if (searched.length === 0) {
      return NextResponse.json({
        total: 0,
        outlierCount: 0,
        threshold: outlierThreshold,
        results: [],
        message: "실제 쇼츠 영상이 없습니다 (필터 적용 후).",
      });
    }

    const uniqueChannels = Array.from(
      new Set(searched.map((s) => s.channelId)),
    );
    const channelInfo = await getChannelUploads(apiKey, uniqueChannels);

    const channelInfoFiltered: typeof channelInfo = {};
    for (const [chId, info] of Object.entries(channelInfo)) {
      if (maxSubs > 0) {
        if (info.subscriberHidden) continue;
        if (info.subscriberCount > maxSubs) continue;
      }
      channelInfoFiltered[chId] = info;
    }

    const baseline: Record<
      string,
      { median: number; max: number; count: number }
    > = {};

    await Promise.all(
      Object.entries(channelInfoFiltered).map(async ([chId, info]) => {
        try {
          const recentIds = await getRecentVideoIds(
            apiKey,
            info.uploads,
            CHANNEL_FETCH,
          );
          if (!recentIds.length) return;
          const recentStats = await getVideoStats(apiKey, recentIds);
          const shortsViews = Object.values(recentStats)
            .filter((v) => v.isShorts && v.views > 0)
            .map((v) => v.views);
          if (shortsViews.length >= MIN_SHORTS_FOR_BASELINE) {
            baseline[chId] = {
              median: median(shortsViews),
              max: Math.max(...shortsViews),
              count: shortsViews.length,
            };
          }
        } catch {
          // skip channel on error
        }
      }),
    );

    const rows: OutlierResult[] = searched
      .filter(
        (s) =>
          baseline[s.channelId] && baseline[s.channelId].median > 0,
      )
      .map((s) => {
        const stats = searchedStats[s.videoId];
        const b = baseline[s.channelId];
        const ch = channelInfo[s.channelId];
        return {
          channelName: s.channelTitle,
          title: stats.title,
          views: stats.views,
          channelMedian: Math.round(b.median),
          outlierScore: Math.round((stats.views / b.median) * 100) / 100,
          durationSec: stats.durationSec,
          likes: stats.likes,
          comments: stats.comments,
          publishedAt: s.publishedAt.slice(0, 10),
          url: `https://youtube.com/shorts/${s.videoId}`,
          thumbnail: stats.thumbnail,
          subscriberCount: ch?.subscriberCount ?? 0,
          subscriberHidden: ch?.subscriberHidden ?? false,
        };
      })
      .sort((a, b) => b.outlierScore - a.outlierScore);

    const outlierCount = rows.filter(
      (r) => r.outlierScore >= outlierThreshold,
    ).length;

    return NextResponse.json({
      total: rows.length,
      outlierCount,
      threshold: outlierThreshold,
      results: rows,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
