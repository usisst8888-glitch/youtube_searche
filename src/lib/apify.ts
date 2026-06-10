// Apify HTTP API 래퍼 — npm dep 없이 raw fetch로 호출
// 참고: https://docs.apify.com/api/v2

const APIFY_API_BASE = "https://api.apify.com/v2";
// 공식 Instagram Scraper actor (URL slash → tilde)
// https://apify.com/apify/instagram-scraper
const INSTAGRAM_ACTOR_ID = "apify~instagram-scraper";

function getToken(): string {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN이 .env.local에 설정되지 않았습니다.");
  return t;
}

// ── Instagram Scraper 입력 타입 ─────────────────────────────────────────
export type InstagramScraperInput = {
  /** ["https://www.instagram.com/{username}/", ...] */
  directUrls: string[];
  /** 프로필당 최대 가져올 포스트 수 (cap) */
  resultsLimit: number;
  /** 보통 "posts" — 프로필의 포스트들 */
  resultsType?: "posts" | "details" | "stories" | "comments";
  /** 부모(프로필) 정보 같이 박아주는 옵션 */
  addParentData?: boolean;
  /** 특정 날짜 이후만 (지원 actor 버전에 따라) */
  onlyPostsNewerThan?: string;
  /** 결제 cap 안전장치 */
  maxRequestRetries?: number;
};

// ── Instagram Scraper 출력 타입 (필요한 필드만) ─────────────────────────
// Apify 응답 구조가 actor 버전마다 약간 달라서 optional 위주로 받음
export type InstagramScraperPost = {
  inputUrl?: string;
  ownerUsername?: string;
  ownerFullName?: string;
  shortCode?: string;
  url?: string;
  type?: string;             // "Image" | "Video" | "Sidecar"
  productType?: string;      // "clips" 면 Reel
  timestamp?: string;        // ISO
  caption?: string;
  hashtags?: string[];
  mentions?: string[];
  likesCount?: number;
  commentsCount?: number;
  videoViewCount?: number;
  videoPlayCount?: number;
  displayUrl?: string;
  videoUrl?: string;
  images?: string[];
  childPosts?: { displayUrl?: string; videoUrl?: string; type?: string }[];
};

// ── Apify run 정보 ──────────────────────────────────────────────────────
export type ApifyRunInfo = {
  id: string;
  actId: string;
  status:
    | "READY"
    | "RUNNING"
    | "SUCCEEDED"
    | "FAILED"
    | "TIMING-OUT"
    | "TIMED-OUT"
    | "ABORTING"
    | "ABORTED";
  defaultDatasetId?: string;
  startedAt?: string;
  finishedAt?: string;
};

// ── Apify webhook 설정 (선택) ───────────────────────────────────────────
export type ApifyWebhook = {
  eventTypes: string[];
  requestUrl: string;
  payloadTemplate?: string;
};

// ───────────────────────────────────────────────────────────────────────
// 비동기 run 시작 — 즉시 응답, run 끝나면 webhook (또는 polling으로 status 확인)
// ───────────────────────────────────────────────────────────────────────
export async function startInstagramScraperRun(
  input: InstagramScraperInput,
  webhooks?: ApifyWebhook[],
): Promise<ApifyRunInfo> {
  const token = getToken();
  const url = new URL(`${APIFY_API_BASE}/acts/${INSTAGRAM_ACTOR_ID}/runs`);
  url.searchParams.set("token", token);
  if (webhooks && webhooks.length > 0) {
    url.searchParams.set("webhooks", JSON.stringify(webhooks));
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify run start failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  return json.data as ApifyRunInfo;
}

// ── run 상태 폴링 ────────────────────────────────────────────────────────
export async function getRunStatus(runId: string): Promise<ApifyRunInfo> {
  const token = getToken();
  const url = `${APIFY_API_BASE}/actor-runs/${runId}?token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Apify run status fetch failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data as ApifyRunInfo;
}

// ── run 완료 후 결과 데이터셋 가져오기 ──────────────────────────────────
export async function getDatasetItems<T = InstagramScraperPost>(
  datasetId: string,
): Promise<T[]> {
  const token = getToken();
  const url = `${APIFY_API_BASE}/datasets/${datasetId}/items?token=${token}&clean=true&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Apify dataset fetch failed: ${res.status}`);
  }
  return (await res.json()) as T[];
}

// ───────────────────────────────────────────────────────────────────────
// 동기 실행 — run 끝날 때까지 기다린 후 데이터셋 결과를 한 번에 반환
// (Vercel Hobby의 60s timeout 안에 끝나야 하는 작은 작업용)
// ───────────────────────────────────────────────────────────────────────
export async function runInstagramScraperSync(
  input: InstagramScraperInput,
  opts: { timeoutSec?: number } = {},
): Promise<InstagramScraperPost[]> {
  const token = getToken();
  const url = new URL(
    `${APIFY_API_BASE}/acts/${INSTAGRAM_ACTOR_ID}/run-sync-get-dataset-items`,
  );
  url.searchParams.set("token", token);
  url.searchParams.set("clean", "true");
  url.searchParams.set("format", "json");
  if (opts.timeoutSec) {
    url.searchParams.set("timeout", String(opts.timeoutSec));
  }
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apify run-sync failed: ${res.status} ${text}`);
  }
  return (await res.json()) as InstagramScraperPost[];
}

// ───────────────────────────────────────────────────────────────────────
// 헬퍼 — 인스타 URL/username 파싱
// ───────────────────────────────────────────────────────────────────────
export function normalizeProfileToUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 이미 URL이면 그대로 (slash 보정만)
  const urlMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)\/?/i,
  );
  if (urlMatch) return `https://www.instagram.com/${urlMatch[1]}/`;

  // @username 또는 username
  const handle = trimmed.replace(/^@/, "");
  if (/^[A-Za-z0-9_.]+$/.test(handle)) {
    return `https://www.instagram.com/${handle}/`;
  }
  return null;
}

export function extractUsernameFromUrl(url: string): string | null {
  const m = url.match(
    /instagram\.com\/([A-Za-z0-9_.]+)\/?/i,
  );
  return m ? m[1] : null;
}

// ───────────────────────────────────────────────────────────────────────
// 헬퍼 — Apify 응답 post를 우리 DB 행으로 변환
// ───────────────────────────────────────────────────────────────────────
export type NormalizedPost = {
  shortcode: string;
  username: string;
  url: string;
  posted_at: string;
  post_type: "reel" | "carousel" | "image" | "video" | "unknown";
  view_count: number | null;
  like_count: number | null;
  comment_count: number | null;
  caption: string;
  thumbnail_url: string;
  media_urls: { type: string; url: string }[];
  hashtags: string[];
  mentions: string[];
};

export function normalizePost(
  p: InstagramScraperPost,
): NormalizedPost | null {
  const shortcode = p.shortCode;
  const username = p.ownerUsername;
  if (!shortcode || !username) return null;

  const url =
    p.url || `https://www.instagram.com/p/${shortcode}/`;
  const postedAt = p.timestamp;
  if (!postedAt) return null;

  // 타입 매핑
  let postType: NormalizedPost["post_type"] = "unknown";
  const t = (p.type || "").toLowerCase();
  const productType = (p.productType || "").toLowerCase();
  if (productType === "clips" || t === "video") {
    // Reel은 productType=clips, 그게 아닌 video는 일반 동영상
    postType = productType === "clips" ? "reel" : "video";
  } else if (t === "sidecar") {
    postType = "carousel";
  } else if (t === "image") {
    postType = "image";
  }

  // media URLs
  const mediaUrls: { type: string; url: string }[] = [];
  if (p.childPosts && p.childPosts.length > 0) {
    for (const c of p.childPosts) {
      if (c.videoUrl) mediaUrls.push({ type: "video", url: c.videoUrl });
      else if (c.displayUrl)
        mediaUrls.push({ type: "image", url: c.displayUrl });
    }
  } else if (p.videoUrl) {
    mediaUrls.push({ type: "video", url: p.videoUrl });
  } else if (p.displayUrl) {
    mediaUrls.push({ type: "image", url: p.displayUrl });
  }

  const views =
    typeof p.videoPlayCount === "number"
      ? p.videoPlayCount
      : typeof p.videoViewCount === "number"
        ? p.videoViewCount
        : null;

  return {
    shortcode,
    username,
    url,
    posted_at: postedAt,
    post_type: postType,
    view_count: views,
    like_count: typeof p.likesCount === "number" ? p.likesCount : null,
    comment_count:
      typeof p.commentsCount === "number" ? p.commentsCount : null,
    caption: p.caption || "",
    thumbnail_url: p.displayUrl || "",
    media_urls: mediaUrls,
    hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
    mentions: Array.isArray(p.mentions) ? p.mentions : [],
  };
}
