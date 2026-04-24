import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  searchShorts,
  getVideoStats,
  filterActualShorts,
} from "@/lib/youtube";

export const maxDuration = 90;
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

type SceneAsset =
  | {
      kind: "youtube-short";
      videoId: string;
      title: string;
      thumbnail: string;
      views: number;
      channel: string;
      embedUrl: string;
      watchUrl: string;
    }
  | {
      kind: "web-image";
      imageUrl: string;
      sourceUrl: string;
      title?: string;
      siteName?: string;
    }
  | {
      kind: "tiktok";
      videoId: string;
      coverUrl: string;
      title: string;
      author: string;
      playUrl?: string;
      watchUrl: string;
    };

function extractUrlsFromText(text: string): string[] {
  const re = /https?:\/\/[^\s)\]"'<>]+/gi;
  return Array.from(new Set(text.match(re) || []));
}

function extractGroundingUrls(response: unknown): string[] {
  const out: string[] = [];
  try {
    const obj = response as {
      candidates?: {
        groundingMetadata?: {
          groundingChunks?: { web?: { uri?: string } }[];
        };
      }[];
    };
    const chunks =
      obj.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    for (const c of chunks) {
      const u = c?.web?.uri;
      if (u) out.push(u);
    }
  } catch {}
  return Array.from(new Set(out));
}

function extractOg(html: string) {
  const pick = (re: RegExp) => html.match(re)?.[1];
  const imageUrl =
    pick(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    ) ||
    pick(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ) ||
    pick(
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    );
  const title =
    pick(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) || pick(/<title>([^<]+)<\/title>/i);
  const siteName = pick(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  );
  return { imageUrl, title, siteName };
}

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

function hasKoreanChars(s: string): boolean {
  return /[ㄱ-힝]/.test(s);
}

async function searchYoutubeShorts(
  query: string,
  limit = 2,
  region = "US",
  lang = "en",
): Promise<SceneAsset[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  try {
    const published = new Date(
      Date.now() - 365 * 24 * 60 * 60 * 1000,
    ).toISOString();
    let searched = await searchShorts(key, query, 30, region, lang, published);
    if (searched.length === 0) return [];
    const stats = await getVideoStats(
      key,
      searched.map((s) => s.videoId),
    );
    searched = searched.filter((s) => stats[s.videoId]?.isShorts);
    searched = await filterActualShorts(searched);

    // 🚫 한국 영상 배제: 채널명 또는 영상 제목이 한글 주도인 경우
    searched = searched.filter((s) => {
      const title = stats[s.videoId]?.title || "";
      const channel = s.channelTitle || "";
      const mostlyKoreanTitle =
        hasKoreanChars(title) &&
        (title.match(/[ㄱ-힝]/g)?.length || 0) >
          title.replace(/\s/g, "").length * 0.3;
      const mostlyKoreanChannel =
        hasKoreanChars(channel) &&
        (channel.match(/[ㄱ-힝]/g)?.length || 0) >
          channel.replace(/\s/g, "").length * 0.3;
      return !mostlyKoreanTitle && !mostlyKoreanChannel;
    });

    const sorted = [...searched].sort(
      (a, b) =>
        (stats[b.videoId]?.views || 0) - (stats[a.videoId]?.views || 0),
    );
    return sorted.slice(0, limit).map<SceneAsset>((s) => ({
      kind: "youtube-short",
      videoId: s.videoId,
      title: stats[s.videoId]?.title || "",
      thumbnail: stats[s.videoId]?.thumbnail || "",
      views: stats[s.videoId]?.views || 0,
      channel: s.channelTitle,
      embedUrl: `https://www.youtube.com/embed/${s.videoId}`,
      watchUrl: `https://www.youtube.com/shorts/${s.videoId}`,
    }));
  } catch {
    return [];
  }
}

async function googleCseImageSearch(
  query: string,
  limit: number,
): Promise<SceneAsset[]> {
  const key = process.env.GOOGLE_CSE_KEY || process.env.YOUTUBE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!key || !cx) return [];
  try {
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", query);
    url.searchParams.set("searchType", "image");
    url.searchParams.set("num", String(Math.min(10, limit)));
    url.searchParams.set("safe", "active");
    const res = await fetch(url.toString());
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data.items || []) as {
      link?: string;
      image?: { thumbnailLink?: string; contextLink?: string };
      title?: string;
      displayLink?: string;
    }[];
    return items.slice(0, limit).map<SceneAsset>((it) => ({
      kind: "web-image",
      imageUrl: it.link || "",
      sourceUrl: it.image?.contextLink || it.link || "",
      title: it.title,
      siteName: it.displayLink,
    }));
  } catch {
    return [];
  }
}

async function findWebImages(
  query: string,
  limit = 3,
): Promise<SceneAsset[]> {
  // 1) Google Custom Search (이미지 검색) — 키 있을 때 우선
  const cseResults = await googleCseImageSearch(query, limit * 2);
  if (cseResults.length >= limit) {
    return cseResults.slice(0, limit);
  }

  // 2) Fallback: Gemini가 Google 검색 → 페이지 URL → og:image 파싱
  try {
    const ai = getGeminiClient();
    const prompt = `Search Google for pages that contain clear images of "${query}".
Any country, any language (Korean sites, blogs, shopping pages, news, etc. all OK).
Return 10 page URLs, one per line. Each page must visibly show the subject.`;
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { tools: [{ googleSearch: {} }] },
      }),
    );
    const urls = Array.from(
      new Set([
        ...extractGroundingUrls(response),
        ...extractUrlsFromText(response.text || ""),
      ]),
    )
      .filter((u) => /^https?:\/\//.test(u))
      .slice(0, 15);

    const pages = await pMapLimit(urls, 6, async (url) => {
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": UA,
            "Accept-Language": "ko-KR,ko;q=0.9",
            Accept: "text/html,application/xhtml+xml",
          },
          redirect: "follow",
        });
        if (!res.ok) return null;
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("html")) return null;
        const html = await res.text();
        const og = extractOg(html);
        if (!og.imageUrl) return null;
        return {
          kind: "web-image" as const,
          imageUrl: og.imageUrl,
          sourceUrl: url,
          title: og.title,
          siteName: og.siteName,
        };
      } catch {
        return null;
      }
    });

    const seen = new Set<string>();
    for (const p of cseResults) seen.add(p.kind === "web-image" ? p.imageUrl : "");
    const unique: SceneAsset[] = [...cseResults];
    for (const p of pages) {
      if (!p || seen.has(p.imageUrl)) continue;
      seen.add(p.imageUrl);
      unique.push(p);
      if (unique.length >= limit) break;
    }
    return unique.slice(0, limit);
  } catch {
    return cseResults.slice(0, limit);
  }
}

async function searchTiktok(
  query: string,
  limit = 2,
  lang = "en",
): Promise<SceneAsset[]> {
  // TikTok은 anti-bot이 강해서 불안정. 시도는 하되 실패해도 조용히 빈 배열.
  try {
    const url = `https://www.tiktok.com/search/video?q=${encodeURIComponent(
      query,
    )}&lang=${lang}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();

    const match = html.match(
      /<script[^>]+id=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script>/,
    );
    if (!match) return [];
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      return [];
    }

    // 구조: data.default.scope.SearchVideo.items[] or similar
    // 버전마다 다름 — 재귀로 videoData 패턴 찾기
    const results: SceneAsset[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const n of node) walk(n);
        return;
      }
      const obj = node as Record<string, unknown>;
      // TikTok item 패턴
      if (
        typeof obj.id === "string" &&
        obj.video &&
        typeof obj.video === "object"
      ) {
        const v = obj.video as {
          cover?: string;
          originCover?: string;
          playAddr?: string;
        };
        const author = (obj.author as { uniqueId?: string })?.uniqueId || "";
        const desc = (obj.desc as string) || "";
        if (v.cover && results.length < limit) {
          results.push({
            kind: "tiktok",
            videoId: obj.id as string,
            coverUrl: v.originCover || v.cover,
            title: desc,
            author,
            playUrl: v.playAddr,
            watchUrl: `https://www.tiktok.com/@${author}/video/${obj.id}`,
          });
        }
      }
      for (const k of Object.keys(obj)) walk(obj[k]);
    };
    walk(data);
    return results;
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      sceneText,
      productName,
      emotion,
      region = "US",
      lang = "en",
      ytLimit = 2,
      imgLimit = 3,
      tiktokLimit = 2,
    } = await req.json();

    if (!sceneText || typeof sceneText !== "string") {
      return NextResponse.json(
        { error: "sceneText가 필요합니다." },
        { status: 400 },
      );
    }

    // 검색 쿼리: 씬 텍스트 + 상품명
    const query = [productName, sceneText]
      .filter(Boolean)
      .join(" ")
      .slice(0, 80);
    const productQuery = productName || query;

    const [youtube, images, tiktok] = await Promise.all([
      ytLimit > 0
        ? searchYoutubeShorts(query, ytLimit, region, lang)
        : Promise.resolve([] as SceneAsset[]),
      imgLimit > 0
        ? findWebImages(productQuery, imgLimit)
        : Promise.resolve([] as SceneAsset[]),
      tiktokLimit > 0
        ? searchTiktok(query, tiktokLimit, lang)
        : Promise.resolve([] as SceneAsset[]),
    ]);

    const flat: SceneAsset[] = [...youtube, ...tiktok, ...images];

    return NextResponse.json({
      sceneText,
      emotion,
      query,
      assets: flat,
      countsBySource: {
        youtube: youtube.length,
        "web-image": images.length,
        tiktok: tiktok.length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
