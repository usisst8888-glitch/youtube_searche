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
앞 **${imageSlots}컷은 정지 이미지**, 뒤 **${videoSlots}컷은 YouTube 영상 클립**으로 가져옵니다.

## 영상 컨텍스트
주제: ${storyTopic}
메인 키워드: ${mainKeyword || "(없음)"}

## 이번 씬
대본: "${scene.text}"
감정: ${scene.emotion}
길이: ${scene.durationSec || 5}초

## 🎯 검색어 짜는 핵심 원칙

**1순위 — 씬 텍스트에 등장하는 구체적 사물/명사를 직접 검색**
씬 대본에 "인삼", "지황", "연꽃", "에센스 병", "화장품 패키지" 같은 **구체적 시각 명사**가 있으면 그걸 그대로 검색어로 쓰세요. 메인 키워드("${mainKeyword}") 안 붙여도 됩니다.

✅ 씬: "인삼, 지황, 연꽃 같은 다섯 가지 원료를 배합했어요"
   → 컷 query: "인삼", "지황 한약재", "연꽃 클로즈업", "한방 원료" — **구체적 사물**
   → 메인 키워드 ("${mainKeyword}") 강제 X

✅ 씬: "조선시대 궁중 비법에서 시작됐어요"
   → 컷 query: "조선시대 궁궐", "한방 약초", "전통 화장품"

**2순위 — 구체적 사물이 없으면 메인 키워드 + 일반 명사**
씬이 추상적이거나 인물/감정 위주면 메인 키워드를 붙이세요.

✅ 씬: "그런데 진짜 이상한 건..."
   → "${mainKeyword} 광고", "${mainKeyword} 리뷰", "놀란 표정"

## 컷 역할 카테고리
- "hook": 식욕 자극 / 클로즈업
- "emotion": 인물 표정·감정
- "context": 장소·사물 맥락
- "action": 움직임·행동
- "reveal": 반전·정보 노출

## 검색어 작성 규칙
- 한국 시청자가 진짜 검색할 자연스러운 단어
- ✅ "인삼 클로즈업", "연꽃 사진", "한약재 전시"
- ❌ 영어 키워드, 추상 단어 (truth, secret), 너무 긴 구문
- 2~5단어, 한국 YouTube/Bing에서 결과 풍부한 키워드

## 출력 필드
- slot: 0부터 시작 (앞 ${imageSlots}개 = 이미지, 뒤 ${videoSlots}개 = 영상)
- medium: "image" 또는 "video"
- role: hook / emotion / context / action / reveal
- roleLabel: 한국어 설명 (10~20자)
- query: 한국어 검색어 (구체 사물 우선, 없으면 메인 키워드)

## 좋은 예 — 윤조에센스 씬 (구체 명사 등장)
씬: "인삼, 지황, 연꽃 같은 다섯 가지 원료를 최적의 비율로 배합했어요"
메인 키워드: 윤조에센스
→ shots: [
  {"slot":0, "medium":"image", "role":"hook", "roleLabel":"인삼 클로즈업", "query":"인삼 클로즈업"},
  {"slot":1, "medium":"image", "role":"context", "roleLabel":"지황 한약재", "query":"지황 한약재"},
  {"slot":2, "medium":"image", "role":"context", "roleLabel":"연꽃 사진", "query":"연꽃"},
  {"slot":3, "medium":"image", "role":"reveal", "roleLabel":"한방 화장품 원료", "query":"한방 화장품 원료"},
  {"slot":4, "medium":"image", "role":"context", "roleLabel":"에센스 병", "query":"화장품 에센스 병"}
]
※ "${mainKeyword}"가 query에 없어도 OK — 씬에 나온 구체 명사("인삼")가 우선

## 좋은 예 — 진태현 씬 (구체 명사 적음, 인물 위주)
씬: "진태현이 결국 떠난다네요... 다들 충격이에요"
메인 키워드: 진태현
→ shots: [
  {"slot":0, "medium":"image", "role":"hook", "roleLabel":"진태현 프로필", "query":"진태현 프로필"},
  {"slot":1, "medium":"image", "role":"emotion", "roleLabel":"충격받은 표정", "query":"충격 표정"},
  ...
]

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
        const query = s.query!.trim();
        // 메인 키워드 강제 prepend는 제거 — 씬에 등장하는 구체 명사 우선 정책
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
