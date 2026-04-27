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

function koreanRatio(s: string): number {
  const kor = s.match(/[ㄱ-힝]/g)?.length || 0;
  const nonSpace = s.replace(/\s/g, "").length;
  if (nonSpace === 0) return 0;
  return kor / nonSpace;
}

async function searchYoutubeShorts(
  query: string,
  limit = 2,
  region = "",
  lang = "",
): Promise<SceneAsset[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  try {
    // 모든 시간대, 두 가지 정렬(relevance + viewCount)로 풀 합쳐서 더 많이 가져옴
    const [byRelevance, byViews] = await Promise.all([
      searchShorts(key, query, 50, region, lang, undefined, undefined, "relevance").catch(() => []),
      searchShorts(key, query, 50, region, lang, undefined, undefined, "viewCount").catch(() => []),
    ]);

    const dedup = new Map<string, (typeof byRelevance)[number]>();
    for (const s of [...byRelevance, ...byViews]) {
      if (!dedup.has(s.videoId)) dedup.set(s.videoId, s);
    }
    let searched = Array.from(dedup.values());
    if (searched.length === 0) return [];

    const stats = await getVideoStats(
      key,
      searched.map((s) => s.videoId),
    );

    // 한국 채널만 배제 (90% 이상 한글일 때만, 매우 관대)
    searched = searched.filter((s) => {
      const channel = s.channelTitle || "";
      return !hasKoreanChars(channel) || koreanRatio(channel) < 0.9;
    });

    // 정렬: 조회수 순 (인기 영상 우선)
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

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    videoQueries: {
      type: "array",
      items: { type: "string" },
    },
    imageQueries: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["videoQueries", "imageQueries"],
};

async function extractSearchQueries(
  sceneText: string,
  productName: string,
): Promise<{ videoQueries: string[]; imageQueries: string[] }> {
  try {
    const ai = getGeminiClient();
    const prompt = `당신은 쇼츠 편집용 **영상·이미지 검색어 설계자**입니다.
씬 대본이 화면에 나올 때 **시청자가 봐야 할 장면**을 찾기 위한 검색어를 뽑습니다.

## 씬 대본 (이걸 그대로 검색하면 안 됨 — 구어체 대사라서)
"${sceneText}"

## 제품명
"${productName}"

## 과제

### 1) videoQueries (YouTube Shorts 검색용)
- **2~3개 생성**. 가능한 **짧고 일반적인** 키워드로.
- 제품명 중심 (2~4단어)
- **구절 금지** ("Korean X cookie review" 같은 건 ❌). 단순 명사 조합만.
- 한국어/영어 섞어도 OK (외국 크리에이터도 brand 이름으로는 검색됨)

### 2) imageQueries (구글 이미지 검색용, 전세계 OK)
- **2~3개 한국어**
- 다양한 앵글: 포장지 / 클로즈업 / 단면 / 사용 장면 / 광고 이미지 등
- 각 4~10자, 제품명 포함

## 예시

대본: "바삭한 튀김과 부드러운 크림의 조합"
제품: "홈런볼"
→ videoQueries: ["홈런볼", "homerun ball snack", "홈런볼 단면"]
→ imageQueries: ["홈런볼 단면", "홈런볼 크림", "홈런볼 쪼갠 모습"]

대본: "여러분 이 동그란 모양 그냥 만든 건 줄 알았어요?"
제품: "홈런볼"
→ videoQueries: ["홈런볼", "homerun ball", "홈런볼 해태"]
→ imageQueries: ["홈런볼 해태", "홈런볼 클로즈업", "홈런볼 포장지"]

**짧고 단순하게. 실제 유튜브 검색창에 사람이 치는 스타일로.**

JSON으로 반환.`;

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: QUERY_SCHEMA,
        },
      }),
    );
    const text = response.text;
    if (!text) throw new Error("empty");
    const parsed = JSON.parse(text);
    const videoQueries = (parsed.videoQueries || [])
      .filter((s: unknown): s is string => typeof s === "string" && !!s.trim())
      .slice(0, 3);
    const imageQueries = (parsed.imageQueries || [])
      .filter((s: unknown): s is string => typeof s === "string" && !!s.trim())
      .slice(0, 3);
    return {
      videoQueries: videoQueries.length > 0 ? videoQueries : [productName],
      imageQueries: imageQueries.length > 0 ? imageQueries : [productName],
    };
  } catch {
    return {
      videoQueries: [productName || sceneText.slice(0, 20)],
      imageQueries: [productName || sceneText.slice(0, 20)],
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      sceneText,
      productName,
      emotion,
      region = "",
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

    // 1) LLM으로 시각적 검색어 추출 (영상용 복수, 이미지용 복수)
    const { videoQueries, imageQueries } = await extractSearchQueries(
      sceneText,
      productName || "",
    );

    const videoQueryList =
      videoQueries.length > 0 ? videoQueries : [productName || sceneText];
    const imageQueryList =
      imageQueries.length > 0 ? imageQueries : [productName || sceneText];

    // 2) 영상: 각 쿼리로 소량씩 뽑아서 합치기 (국제 커버리지)
    const ytPerQuery = Math.max(
      1,
      Math.ceil(ytLimit / videoQueryList.length),
    );
    const tkPerQuery = Math.max(
      1,
      Math.ceil(tiktokLimit / videoQueryList.length),
    );
    const imgPerQuery = Math.max(
      1,
      Math.ceil(imgLimit / imageQueryList.length),
    );

    const [ytGrouped, imgGrouped, tkGrouped] = await Promise.all([
      ytLimit > 0
        ? Promise.all(
            videoQueryList.map((q) =>
              searchYoutubeShorts(q, ytPerQuery, region, lang),
            ),
          )
        : Promise.resolve([] as SceneAsset[][]),
      imgLimit > 0
        ? Promise.all(
            imageQueryList.map((q) => findWebImages(q, imgPerQuery)),
          )
        : Promise.resolve([] as SceneAsset[][]),
      tiktokLimit > 0
        ? Promise.all(
            videoQueryList.map((q) => searchTiktok(q, tkPerQuery, lang)),
          )
        : Promise.resolve([] as SceneAsset[][]),
    ]);

    const dedupeKey = (a: SceneAsset): string => {
      if (a.kind === "youtube-short") return `yt:${a.videoId}`;
      if (a.kind === "web-image") return `img:${a.imageUrl}`;
      return `tt:${a.videoId}`;
    };

    const takeUnique = (groups: SceneAsset[][], cap: number): SceneAsset[] => {
      const seen = new Set<string>();
      const out: SceneAsset[] = [];
      for (const g of groups) {
        for (const a of g) {
          const k = dedupeKey(a);
          if (seen.has(k)) continue;
          seen.add(k);
          out.push(a);
          if (out.length >= cap) return out;
        }
      }
      return out;
    };

    const youtube = takeUnique(ytGrouped as SceneAsset[][], ytLimit);
    const images = takeUnique(imgGrouped as SceneAsset[][], imgLimit);
    const tiktok = takeUnique(tkGrouped as SceneAsset[][], tiktokLimit);

    const flat: SceneAsset[] = [...youtube, ...tiktok, ...images];

    return NextResponse.json({
      sceneText,
      emotion,
      videoQueries: videoQueryList,
      imageQueries: imageQueryList,
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
