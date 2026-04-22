import { NextRequest, NextResponse } from "next/server";
import {
  searchShorts,
  getVideoStats,
  getChannelUploads,
  getRecentVideoIds,
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
      apiKey,
      keyword,
      searchMax = 50,
      outlierThreshold = 3.0,
      region = "KR",
      language = "ko",
    } = body;

    if (!apiKey || !keyword) {
      return NextResponse.json(
        { error: "API 키와 키워드를 입력하세요." },
        { status: 400 },
      );
    }

    let searched = await searchShorts(
      apiKey,
      keyword,
      Math.min(50, Math.max(1, Number(searchMax))),
      region,
      language,
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

    const searchedStats = await getVideoStats(
      apiKey,
      searched.map((s) => s.videoId),
    );
    searched = searched.filter((s) => searchedStats[s.videoId]?.isShorts);

    if (searched.length === 0) {
      return NextResponse.json({
        total: 0,
        outlierCount: 0,
        threshold: outlierThreshold,
        results: [],
        message: "3분 이하 쇼츠가 없습니다.",
      });
    }

    const uniqueChannels = Array.from(
      new Set(searched.map((s) => s.channelId)),
    );
    const channelInfo = await getChannelUploads(apiKey, uniqueChannels);

    const baseline: Record<
      string,
      { median: number; max: number; count: number }
    > = {};

    await Promise.all(
      Object.entries(channelInfo).map(async ([chId, info]) => {
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
