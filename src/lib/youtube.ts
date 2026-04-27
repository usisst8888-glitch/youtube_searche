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
  description: string;
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
  order: "relevance" | "viewCount" | "date" | "rating" | "title" = "relevance",
): Promise<SearchItem[]> {
  const results: SearchItem[] = [];
  let pageToken = "";
  while (results.length < max) {
    const params: Record<string, string> = {
      part: "snippet",
      type: "video",
      videoDuration: "short",
      maxResults: String(Math.min(50, max - results.length)),
      order,
    };
    if (region) params.regionCode = region;
    if (lang) params.relevanceLanguage = lang;
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
        description: item.snippet.description || "",
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

export async function getTopComments(
  apiKey: string,
  videoId: string,
  max = 3,
): Promise<string[]> {
  try {
    const url = new URL(`${YT_BASE}/commentThreads`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("order", "relevance");
    url.searchParams.set("maxResults", String(max));
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", apiKey);
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];
    return items
      .map(
        (it: {
          snippet?: {
            topLevelComment?: { snippet?: { textDisplay?: string } };
          };
        }) => it?.snippet?.topLevelComment?.snippet?.textDisplay || "",
      )
      .filter((t: string) => t.length > 0);
  } catch {
    return [];
  }
}

const SHOP_URL_RE =
  /https?:\/\/(?:[\w-]+\.)*(?:coupang\.com|link\.coupang\.com|smartstore\.naver\.com|shopping\.naver\.com|brand\.naver\.com|11st\.co\.kr|gmarket\.co\.kr|auction\.co\.kr|wemakeprice\.com|tmon\.co\.kr|aliexpress\.com|amazon\.(?:com|co\.jp)|ohou\.se|musinsa\.com|29cm\.co\.kr|kakao\.com|tistory\.com)[^\s)\]]*/gi;

const GENERIC_URL_RE = /https?:\/\/[^\s)\]]+/gi;

export function extractShoppingUrls(text: string): string[] {
  if (!text) return [];
  const shop = Array.from(new Set(text.match(SHOP_URL_RE) || []));
  if (shop.length > 0) return shop;
  // fallback: any URL if no known shop
  const all = Array.from(new Set(text.match(GENERIC_URL_RE) || []));
  return all;
}

// 제목에 이 중 하나가 있어야 "제품 리뷰/추천 쇼츠"로 인정
// (유튜브 검색 결과에서 제목만 보고 결정적으로 판정)
const PRODUCT_TITLE_MARKERS = [
  // 템/꿀템 계열
  /꿀템|찐템|찐찐템|필수템|추천템|인생템|갓템|잇템|아이템/i,
  // 리뷰/후기/언박싱
  /리뷰|후기|솔직후기|내돈내산|언박싱|개봉기|써보니|사용기/i,
  // 비교/랭킹/리스트
  /\bVS\b|\bvs\b|TOP\s*\d|BEST\s*\d|\d+\s*가지|\d+\s*개|\d+\s*템|순위|비교/i,
  // 추천/가성비
  /추천|가성비|갓성비|가심비/i,
  // 광고/협찬 명시
  /광고|협찬|유료광고|제품협찬/i,
];

export function isProductReviewTitle(title: string): boolean {
  if (!title) return false;
  return PRODUCT_TITLE_MARKERS.some((re) => re.test(title));
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
