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
};

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
): Promise<SearchItem[]> {
  const results: SearchItem[] = [];
  let pageToken = "";
  while (results.length < max) {
    const params: Record<string, string> = {
      part: "snippet",
      q: keyword,
      type: "video",
      videoDuration: "short",
      maxResults: String(Math.min(50, max - results.length)),
      order: "relevance",
      regionCode: region,
      relevanceLanguage: lang,
    };
    if (publishedAfter) params.publishedAfter = publishedAfter;
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
): Promise<Record<string, { uploads: string; name: string }>> {
  const info: Record<string, { uploads: string; name: string }> = {};
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    if (batch.length === 0) continue;
    const data = await ytFetch(
      "channels",
      {
        part: "contentDetails,snippet",
        id: batch.join(","),
      },
      apiKey,
    );
    for (const item of data.items || []) {
      info[item.id] = {
        uploads: item.contentDetails.relatedPlaylists.uploads,
        name: item.snippet.title,
      };
    }
  }
  return info;
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
