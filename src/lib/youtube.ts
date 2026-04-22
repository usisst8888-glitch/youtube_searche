const DURATION_RE = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;

export function parseDurationSeconds(duration: string): number {
  if (!duration) return 0;
  const m = DURATION_RE.exec(duration);
  if (!m) return 0;
  const h = parseInt(m[1] || "0", 10);
  const min = parseInt(m[2] || "0", 10);
  const s = parseInt(m[3] || "0", 10);
  return h * 3600 + min * 60 + s;
}

export function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export const SHORTS_MAX_SEC = 180;

export type SearchItem = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
};

export type VideoStats = {
  views: number;
  likes: number;
  comments: number;
  title: string;
  publishedAt: string;
  durationSec: number;
  isShorts: boolean;
  thumbnail: string;
};

export type OutlierResult = {
  channelName: string;
  title: string;
  views: number;
  channelMedian: number;
  outlierScore: number;
  durationSec: number;
  likes: number;
  comments: number;
  publishedAt: string;
  url: string;
  thumbnail: string;
  subscriberCount: number;
  subscriberHidden: boolean;
};

export type ChannelInfo = {
  uploads: string;
  name: string;
  subscriberCount: number;
  subscriberHidden: boolean;
};

export const VIDEO_CATEGORIES_KR: { id: string; name: string }[] = [
  { id: "", name: "전체 (카테고리 필터 없음)" },
  { id: "1", name: "영화 & 애니메이션" },
  { id: "2", name: "자동차" },
  { id: "10", name: "음악" },
  { id: "15", name: "동물" },
  { id: "17", name: "스포츠" },
  { id: "19", name: "여행 & 이벤트" },
  { id: "20", name: "게임" },
  { id: "22", name: "인물 & 블로그" },
  { id: "23", name: "코미디" },
  { id: "24", name: "엔터테인먼트" },
  { id: "25", name: "뉴스 & 정치" },
  { id: "26", name: "노하우 & 스타일" },
  { id: "27", name: "교육" },
  { id: "28", name: "과학 & 기술" },
  { id: "29", name: "비영리 & 사회운동" },
];

const YT_BASE = "https://www.googleapis.com/youtube/v3";

async function ytFetch(
  path: string,
  params: Record<string, string>,
  apiKey: string,
) {
  const url = new URL(`${YT_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    let msg = `YouTube API ${res.status}`;
    try {
      const parsed = JSON.parse(text);
      msg = parsed.error?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export async function searchShorts(
  apiKey: string,
  keyword: string,
  max: number,
  region: string,
  lang: string,
  publishedAfter?: string,
  videoCategoryId?: string,
): Promise<SearchItem[]> {
  const results: SearchItem[] = [];
  let pageToken = "";
  while (results.length < max) {
    const params: Record<string, string> = {
      part: "snippet",
      type: "video",
      videoDuration: "short",
      maxResults: String(Math.min(50, max - results.length)),
      order: "relevance",
      regionCode: region,
      relevanceLanguage: lang,
    };
    if (keyword) params.q = keyword;
    if (publishedAfter) params.publishedAfter = publishedAfter;
    if (videoCategoryId) params.videoCategoryId = videoCategoryId;
    if (pageToken) params.pageToken = pageToken;
    const data = await ytFetch("search", params, apiKey);
    for (const item of data.items || []) {
      results.push({
        videoId: item.id.videoId,
        channelId: item.snippet.channelId,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
      });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return results;
}

export async function getVideoStats(
  apiKey: string,
  videoIds: string[],
): Promise<Record<string, VideoStats>> {
  const stats: Record<string, VideoStats> = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    if (batch.length === 0) continue;
    const data = await ytFetch(
      "videos",
      {
        part: "statistics,snippet,contentDetails",
        id: batch.join(","),
      },
      apiKey,
    );
    for (const item of data.items || []) {
      const dur = parseDurationSeconds(item.contentDetails.duration);
      const thumbs = item.snippet.thumbnails || {};
      const thumb =
        thumbs.medium?.url || thumbs.default?.url || thumbs.high?.url || "";
      stats[item.id] = {
        views: parseInt(item.statistics?.viewCount || "0", 10),
        likes: parseInt(item.statistics?.likeCount || "0", 10),
        comments: parseInt(item.statistics?.commentCount || "0", 10),
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
        durationSec: dur,
        isShorts: dur > 0 && dur <= SHORTS_MAX_SEC,
        thumbnail: thumb,
      };
    }
  }
  return stats;
}

export async function getChannelUploads(
  apiKey: string,
  channelIds: string[],
): Promise<Record<string, ChannelInfo>> {
  const info: Record<string, ChannelInfo> = {};
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    if (batch.length === 0) continue;
    const data = await ytFetch(
      "channels",
      {
        part: "contentDetails,snippet,statistics",
        id: batch.join(","),
      },
      apiKey,
    );
    for (const item of data.items || []) {
      const hidden = item.statistics?.hiddenSubscriberCount ?? false;
      info[item.id] = {
        uploads: item.contentDetails.relatedPlaylists.uploads,
        name: item.snippet.title,
        subscriberCount: hidden
          ? 0
          : parseInt(item.statistics?.subscriberCount || "0", 10),
        subscriberHidden: hidden,
      };
    }
  }
  return info;
}

export const DEFAULT_EXCLUDE_KEYWORDS = [
  "뉴스",
  "news",
  "방송",
  "공식",
  "official",
  "KBS",
  "MBC",
  "SBS",
  "JTBC",
  "YTN",
  "MBN",
  "TV조선",
  "채널A",
  "연합",
  "일보",
  "신문",
  "CNN",
  "BBC",
  "NHK",
];

export function isExcludedChannel(
  channelName: string,
  keywords: string[],
): boolean {
  if (!channelName) return false;
  const lower = channelName.toLowerCase();
  return keywords.some((kw) => {
    const trimmed = kw.trim();
    if (!trimmed) return false;
    return lower.includes(trimmed.toLowerCase());
  });
}

export async function verifyIsShort(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: "HEAD",
      redirect: "manual",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function filterActualShorts<T extends { videoId: string }>(
  items: T[],
): Promise<T[]> {
  const checks = await Promise.all(
    items.map(async (item) => ({
      item,
      isShort: await verifyIsShort(item.videoId),
    })),
  );
  return checks.filter((c) => c.isShort).map((c) => c.item);
}

export async function getRecentVideoIds(
  apiKey: string,
  playlistId: string,
  max: number,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = "";
  while (ids.length < max) {
    const params: Record<string, string> = {
      part: "contentDetails",
      playlistId,
      maxResults: String(Math.min(50, max - ids.length)),
    };
    if (pageToken) params.pageToken = pageToken;
    const data = await ytFetch("playlistItems", params, apiKey);
    for (const item of data.items || []) {
      ids.push(item.contentDetails.videoId);
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return ids;
}
