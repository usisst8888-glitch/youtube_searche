import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 120;
export const runtime = "nodejs";

const SCRAPE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

type ScrapedVideo = {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
};

/**
 * YouTube 검색 스크래핑 — API quota 안 씀.
 * ytInitialData JSON에서 videoRenderer를 재귀로 추출.
 */
type BingImage = {
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  title: string;
  siteName: string;
};

async function bingImageScrape(
  query: string,
  limit = 5,
  exclude: Set<string> = new Set(),
): Promise<BingImage[]> {
  const fetchCount = Math.max(15, limit + exclude.size + 5);
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(
    query,
  )}&form=HDRSC2&count=${Math.min(35, fetchCount)}`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": SCRAPE_UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }
  const matches = Array.from(html.matchAll(/m="({[^"]+})"/g));
  const out: BingImage[] = [];
  for (const m of matches) {
    if (out.length >= limit) break;
    try {
      const json = m[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&#39;/g, "'");
      const obj = JSON.parse(json) as {
        murl?: string;
        turl?: string;
        t?: string;
        purl?: string;
        desc?: string;
      };
      if (!obj.murl || exclude.has(obj.murl)) continue;
      let siteName = "";
      try {
        siteName = new URL(obj.purl || obj.murl).hostname.replace(
          /^www\./,
          "",
        );
      } catch {}
      out.push({
        imageUrl: obj.murl,
        thumbnailUrl: obj.turl || obj.murl,
        sourceUrl: obj.purl || obj.murl,
        title: obj.t || obj.desc || "",
        siteName: siteName || "Web",
      });
    } catch {}
  }
  return out;
}

function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const cause = e.cause;
  if (cause && typeof cause === "object") {
    const code = cause.code ? `[${cause.code}]` : "";
    return `${e.message} ${code} ${cause.message || ""}`.trim();
  }
  return e.message;
}

async function youtubeScrapeSearch(
  query: string,
  limit = 20,
  attempt = 1,
): Promise<ScrapedVideo[]> {
  const MAX_ATTEMPTS = 3;
  // sp=EgIYAQ%3D%3D = Shorts 필터 (URL-encoded)
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    query,
  )}&sp=EgIYAQ%253D%253D&hl=ko&gl=KR`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": SCRAPE_UA,
        "Accept-Language": "ko-KR,ko;q=0.9",
        // YouTube 쿠키 동의 페이지 우회 — yt-dlp 방식
        Cookie:
          "CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjMxMTA3LjA1X3AwGgJlbiACGgYIgLC_qgY",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(
        `[yt-scrape] HTTP ${res.status} for "${query}" (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      // 429 / 5xx 면 재시도
      if (
        attempt < MAX_ATTEMPTS &&
        (res.status === 429 || res.status >= 500)
      ) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        return youtubeScrapeSearch(query, limit, attempt + 1);
      }
      return [];
    }
    html = await res.text();
  } catch (e) {
    const detail = describeFetchError(e);
    console.warn(
      `[yt-scrape] fetch failed for "${query}" (attempt ${attempt}/${MAX_ATTEMPTS}): ${detail}`,
    );
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      return youtubeScrapeSearch(query, limit, attempt + 1);
    }
    return [];
  }
  const m = html.match(/var ytInitialData = (\{[\s\S]+?\});/);
  if (!m) {
    // YouTube가 consent wall (쿠키 동의 페이지) 보내거나 봇 감지된 경우 ytInitialData 없음
    const hasConsent = /consent\.youtube\.com|VqBxKZL/i.test(html);
    console.warn(
      `[yt-scrape] ytInitialData not found for "${query}" (html=${html.length}b, consent=${hasConsent})`,
    );
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }

  const results: ScrapedVideo[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }
    const obj = node as Record<string, unknown>;
    const renderer = obj.videoRenderer as
      | undefined
      | {
          videoId?: string;
          title?: { runs?: { text?: string }[] };
          ownerText?: { runs?: { text?: string }[] };
          shortBylineText?: { runs?: { text?: string }[] };
          thumbnail?: { thumbnails?: { url?: string }[] };
        };
    if (renderer && renderer.videoId && !seen.has(renderer.videoId)) {
      const videoId = renderer.videoId;
      const title = renderer.title?.runs?.[0]?.text || "";
      const channelTitle =
        renderer.ownerText?.runs?.[0]?.text ||
        renderer.shortBylineText?.runs?.[0]?.text ||
        "";
      const thumbs = renderer.thumbnail?.thumbnails || [];
      const thumbnail = thumbs[thumbs.length - 1]?.url || "";
      seen.add(videoId);
      if (videoId && title) {
        results.push({ videoId, title, channelTitle, thumbnail });
      }
    }
    for (const k of Object.keys(obj)) walk(obj[k]);
  };
  walk(data);
  return results.slice(0, limit);
}

type SceneIn = {
  index: number;
  text: string;
  emotion: string;
  durationSec?: number;
};

export type AutoShot = {
  sceneIndex: number;
  slot: number;
  role: string; // hook / emotion / context / action / reveal
  roleLabel: string;
  query: string;
  image: {
    imageUrl: string;
    sourceUrl: string;
    siteName: string;
    thumbnailUrl?: string;
    title: string;
    // 영상 클립 — 있으면 video, 없으면 image only
    videoId?: string;
    embedUrl?: string;
    watchUrl?: string;
  } | null;
};

const SHOTLIST_SCHEMA = {
  type: "object",
  properties: {
    shots: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slot: { type: "integer" },
          medium: { type: "string" },
          role: { type: "string" },
          roleLabel: { type: "string" },
          query: { type: "string" },
        },
        required: ["slot", "medium", "role", "roleLabel", "query"],
      },
    },
  },
  required: ["shots"],
};

async function generateSceneShotlist(
  scene: SceneIn,
  storyTopic: string,
  shotsCount: number,
  mainKeyword: string,
  imageSlots = 3,
  videoSlots = 2,
): Promise<
  {
    slot: number;
    role: string;
    roleLabel: string;
    query: string;
    medium: "image" | "video";
  }[]
> {
  try {
    const ai = getGeminiClient();
    const totalCount = imageSlots + videoSlots;
    const prompt = `당신은 한국 YouTube Shorts 편집자입니다.
한 씬을 분석해서 9:16 화면에서 ${totalCount}컷이 **순서대로** 지나갈 비주얼 시퀀스를 설계하세요.
앞 **${imageSlots}컷은 정지 이미지 (뉴스 사진/블로그)**, 뒤 **${videoSlots}컷은 YouTube 영상 클립**으로 가져옵니다.
각 컷마다 한국어 검색어를 짜주세요.

## 🚨 절대 규칙
**메인 키워드: "${mainKeyword}"**
모든 query는 반드시 메인 키워드를 포함해야 합니다.
"${mainKeyword}" 없이 일반적인 키워드만 (예: "놀란 표정", "라면 끓이기") 짜면 영상의 주제와 무관한 결과가 나와서 ❌입니다.

## 영상 컨텍스트
주제: ${storyTopic}

## 이번 씬
대본: "${scene.text}"
감정: ${scene.emotion}
길이: ${scene.durationSec || 5}초

## ${shotsCount}컷 구성 원칙

1. **각 컷은 서로 다른 역할** — 같은 종류 영상 반복 금지
2. 가능한 컷 역할:
   - "hook": 시각 후크 / 식욕 자극 / 음식 클로즈업
   - "emotion": 인물 표정·감정 (놀람·웃음·충격·궁금증)
   - "context": 장소·사물 맥락 (배경·환경·도구)
   - "action": 움직임·행동 (먹기·뛰기·잡기 등)
   - "reveal": 반전·정보 노출 (옛날 자료·증거·대비)
3. **순서**가 중요 — 0번이 가장 강한 후크 (썸네일급), 마지막이 마무리
4. **YouTube 한국어 검색용 키워드** — 한국 시청자가 진짜 검색할 만한 자연스러운 단어
   - ✅ 좋은 예: "짜파게티 먹방", "놀란 한국인", "요리 클로즈업", "라면 ASMR", "옛날 광고"
   - ❌ 나쁜 예: 영어 키워드, 추상 단어 (truth, secret), 너무 긴 구문
5. **2~5단어**, 한국 YouTube에서 결과 많이 나오는 키워드
6. 카테고리 키워드 활용 — "먹방", "리뷰", "ASMR", "실험", "광고", "리액션", "브이로그"

## 출력 필드
- slot: 0부터 시작 (앞 ${imageSlots}개 = 이미지, 뒤 ${videoSlots}개 = 영상)
- medium: "image" (slot 0..${imageSlots - 1}) 또는 "video" (slot ${imageSlots}..${totalCount - 1})
- role: 위 카테고리 중 하나
- roleLabel: 한국어 설명 (10~20자)
- query: **한국어** 검색어, **반드시 "${mainKeyword}" 포함**
  - image용: 정적 사진이 많이 나오는 키워드 (인물 사진, 표정, 장소 등)
  - video용: 영상 클립이 많이 나오는 키워드 (먹방, 리액션, 인터뷰 등)

## 좋은 예 — 메인 키워드 "진태현" (이미지 ${imageSlots}컷 + 영상 ${videoSlots}컷)
씬: "진태현이 결국 이혼숙려캠프를 떠난다"
→ shots: [
  {"slot":0, "medium":"image", "role":"hook", "roleLabel":"진태현 프로필 사진", "query":"진태현 프로필"},
  {"slot":1, "medium":"image", "role":"context", "roleLabel":"진태현 박시은 부부", "query":"진태현 박시은"},
  {"slot":2, "medium":"image", "role":"reveal", "roleLabel":"이혼숙려캠프 출연 사진", "query":"진태현 이혼숙려캠프"},
  {"slot":3, "medium":"video", "role":"emotion", "roleLabel":"진태현 인터뷰 영상", "query":"진태현 인터뷰"},
  {"slot":4, "medium":"video", "role":"action", "roleLabel":"진태현 방송 클립", "query":"진태현 방송"}
]

## ❌ 나쁜 예 (메인 키워드 빠짐 — 절대 금지)
{"query":"놀란 표정 한국인"}  ← "${mainKeyword}" 없음
{"query":"이혼숙려캠프 부부싸움"}  ← "${mainKeyword}" 없음

JSON 출력.`;

    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SHOTLIST_SCHEMA,
        },
      }),
    );
    const data = JSON.parse(res.text || "{}");
    const shots =
      (data.shots as {
        slot?: number;
        medium?: string;
        role?: string;
        roleLabel?: string;
        query?: string;
      }[]) || [];
    return shots
      .filter((s) => typeof s.query === "string" && !!s.query.trim())
      .slice(0, totalCount)
      .map((s, i) => {
        let query = s.query!.trim();
        if (
          mainKeyword &&
          !query.toLowerCase().includes(mainKeyword.toLowerCase())
        ) {
          query = `${mainKeyword} ${query}`;
        }
        const slot = typeof s.slot === "number" ? s.slot : i;
        // medium이 명시 안 됐거나 잘못된 경우 슬롯 위치로 결정
        const inferredMedium: "image" | "video" =
          slot < imageSlots ? "image" : "video";
        const medium: "image" | "video" =
          s.medium === "image" || s.medium === "video"
            ? s.medium
            : inferredMedium;
        return {
          slot,
          medium,
          role: (s.role || "context").trim(),
          roleLabel: (s.roleLabel || "").trim(),
          query,
        };
      });
  } catch {
    return [];
  }
}

async function youtubeSearchOne(
  query: string,
  excludeVideoIds: Set<string> = new Set(),
): Promise<AutoShot["image"]> {
  try {
    const searched = await youtubeScrapeSearch(query, 25);
    if (searched.length === 0) return null;

    // 중복 아닌 첫 영상
    const valid = searched.find((v) => !excludeVideoIds.has(v.videoId));
    if (!valid) return null;

    return {
      imageUrl: valid.thumbnail,
      sourceUrl: `https://www.youtube.com/shorts/${valid.videoId}`,
      siteName: valid.channelTitle
        ? `YouTube · ${valid.channelTitle}`
        : "YouTube",
      thumbnailUrl: valid.thumbnail,
      title: valid.title,
      videoId: valid.videoId,
      embedUrl: `https://www.youtube-nocookie.com/embed/${valid.videoId}`,
      watchUrl: `https://www.youtube.com/shorts/${valid.videoId}`,
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const mode: "all" | "scene" | "shot" = body.mode || "all";
    const scenes: SceneIn[] = body.scenes || [];
    const storyTopic: string = body.storyTopic || "";
    const mainKeyword: string = (body.mainKeyword || "").trim();
    const imageSlots: number = Math.max(0, Math.min(5, body.imageSlots ?? 3));
    const videoSlots: number = Math.max(0, Math.min(5, body.videoSlots ?? 2));
    // shotsPerScene = imageSlots + videoSlots (자동 계산)
    const shotsPerScene: number = imageSlots + videoSlots || 5;
    const sceneIndex: number | undefined = body.sceneIndex;
    const slot: number | undefined = body.slot;
    const customQuery: string | undefined = body.query;
    const excludeVideoIds: Set<string> = new Set(
      Array.isArray(body.excludeVideoIds)
        ? body.excludeVideoIds.filter(
            (s: unknown): s is string => typeof s === "string",
          )
        : [],
    );

    if (!Array.isArray(scenes) || scenes.length === 0) {
      return NextResponse.json(
        { error: "scenes 배열이 필요합니다." },
        { status: 400 },
      );
    }
    // 단일 컷 재검색
    if (mode === "shot") {
      if (sceneIndex === undefined || slot === undefined) {
        return NextResponse.json(
          { error: "sceneIndex, slot 필요" },
          { status: 400 },
        );
      }
      const scene = scenes.find((s) => s.index === sceneIndex);
      if (!scene) {
        return NextResponse.json(
          { error: `scene ${sceneIndex} 없음` },
          { status: 400 },
        );
      }

      let resolvedQuery = customQuery?.trim();
      let role = "context";
      let roleLabel = "";
      if (!resolvedQuery) {
        const list = await generateSceneShotlist(
          scene,
          storyTopic,
          shotsPerScene,
          mainKeyword,
          imageSlots,
          videoSlots,
        );
        const target =
          list.find((x) => x.slot === slot) || list[slot] || list[0];
        if (!target) {
          return NextResponse.json(
            { error: "shotlist 생성 실패" },
            { status: 500 },
          );
        }
        resolvedQuery = target.query;
        role = target.role;
        roleLabel = target.roleLabel;
      }
      const image = await youtubeSearchOne(resolvedQuery, excludeVideoIds);
      const shot: AutoShot = {
        sceneIndex,
        slot,
        role,
        roleLabel,
        query: resolvedQuery,
        image,
      };
      return NextResponse.json({ shots: [shot] });
    }

    const targetScenes =
      mode === "scene" && typeof sceneIndex === "number"
        ? scenes.filter((s) => s.index === sceneIndex)
        : scenes;

    const shotlistPerScene = await Promise.all(
      targetScenes.map(async (s) => {
        const list = await generateSceneShotlist(
          s,
          storyTopic,
          shotsPerScene,
          mainKeyword,
          imageSlots,
          videoSlots,
        );
        return { sceneIndex: s.index, list };
      }),
    );

    // 씬별로 query별 검색 결과를 미리 다 가져오고, 슬롯에 unique 배정 (한 씬 내 중복 영상 방지)
    // YouTube 동시 요청 제한 — 차단/실패 줄이려고 동시 2개로
    const CONCURRENCY = 2;
    async function searchInBatches(
      queries: string[],
    ): Promise<ScrapedVideo[][]> {
      const out: ScrapedVideo[][] = new Array(queries.length);
      let i = 0;
      const workers = Array.from({
        length: Math.min(CONCURRENCY, queries.length),
      }).map(async () => {
        while (true) {
          const idx = i++;
          if (idx >= queries.length) break;
          try {
            out[idx] = await youtubeScrapeSearch(queries[idx], 25);
          } catch {
            out[idx] = [];
          }
        }
      });
      await Promise.all(workers);
      return out;
    }

    const results: AutoShot[] = [];
    // 모든 씬에서 이미 사용한 Bing 이미지 URL — 씬 간 중복도 방지
    const globalUsedImageUrls = new Set<string>();
    for (const { sceneIndex: si, list } of shotlistPerScene) {
      // medium별로 분리
      const videoItems = list.filter((it) => it.medium === "video");
      const imageItems = list.filter((it) => it.medium === "image");

      // 영상 검색 (YouTube)
      const videoLists = await searchInBatches(
        videoItems.map((it) => it.query),
      );
      const usedVideoIds = new Set<string>(excludeVideoIds);
      const videoResultByItem = new Map<typeof list[0], ScrapedVideo | null>();
      for (let i = 0; i < videoItems.length; i++) {
        const item = videoItems[i];
        const videos = videoLists[i];
        const valid = videos.find((v) => !usedVideoIds.has(v.videoId));
        if (valid) usedVideoIds.add(valid.videoId);
        videoResultByItem.set(item, valid || null);
      }

      // 이미지 검색 (Bing) — 씬 내 + 씬 간 중복 회피
      const imageResultByItem = new Map<typeof list[0], BingImage | null>();
      const usedImageInScene = new Set<string>();
      for (const item of imageItems) {
        const exclude = new Set([
          ...globalUsedImageUrls,
          ...usedImageInScene,
        ]);
        const imgs = await bingImageScrape(item.query, 5, exclude);
        const pick = imgs[0] || null;
        if (pick) {
          usedImageInScene.add(pick.imageUrl);
          globalUsedImageUrls.add(pick.imageUrl);
        }
        imageResultByItem.set(item, pick);
      }

      // 원래 슬롯 순서대로 결과 push
      for (const item of list) {
        if (item.medium === "video") {
          const v = videoResultByItem.get(item) || null;
          results.push({
            sceneIndex: si,
            slot: item.slot,
            role: item.role,
            roleLabel: item.roleLabel,
            query: item.query,
            image: v
              ? {
                  imageUrl: v.thumbnail,
                  sourceUrl: `https://www.youtube.com/shorts/${v.videoId}`,
                  siteName: v.channelTitle
                    ? `YouTube · ${v.channelTitle}`
                    : "YouTube",
                  thumbnailUrl: v.thumbnail,
                  title: v.title,
                  videoId: v.videoId,
                  embedUrl: `https://www.youtube-nocookie.com/embed/${v.videoId}`,
                  watchUrl: `https://www.youtube.com/shorts/${v.videoId}`,
                }
              : null,
          });
        } else {
          const img = imageResultByItem.get(item) || null;
          results.push({
            sceneIndex: si,
            slot: item.slot,
            role: item.role,
            roleLabel: item.roleLabel,
            query: item.query,
            image: img
              ? {
                  imageUrl: img.imageUrl,
                  sourceUrl: img.sourceUrl,
                  siteName: img.siteName,
                  thumbnailUrl: img.thumbnailUrl,
                  title: img.title || item.roleLabel,
                }
              : null,
          });
        }
      }
    }

    return NextResponse.json({ shots: results });
  } catch (e) {
    console.error("[auto-scene-shots] error:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "서버 오류",
        stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
      },
      { status: 500 },
    );
  }
}
