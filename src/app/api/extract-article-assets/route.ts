import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 90;
export const runtime = "nodejs";

// 한국 뉴스 사이트가 봇 차단하는 케이스 많음 — 여러 UA + 헤더 조합 시도
const FETCH_PROFILES: { name: string; ua: string; extra: Record<string, string> }[] = [
  {
    name: "desktop-chrome",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    extra: {
      "Sec-Ch-Ua":
        '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"Windows"',
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
    },
  },
  {
    name: "desktop-safari",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    extra: {},
  },
  {
    name: "mobile-iphone",
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    extra: {},
  },
  {
    name: "google-bot",
    ua: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    extra: {},
  },
];

async function fetchHtmlWithFallback(
  url: string,
): Promise<{ html: string; profile: string } | { error: string; attempts: string[] }> {
  const attempts: string[] = [];
  // Referer는 도메인별 정책 회피용 (Naver/Google에서 온 척)
  const refererCandidates = [
    "https://www.google.com/",
    "https://search.naver.com/",
    "https://www.daum.net/",
    "",
  ];
  for (const profile of FETCH_PROFILES) {
    for (const referer of refererCandidates) {
      try {
        const headers: Record<string, string> = {
          "User-Agent": profile.ua,
          "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          ...profile.extra,
        };
        if (referer) headers["Referer"] = referer;
        const res = await fetch(url, {
          headers,
          redirect: "follow",
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const html = await res.text();
          if (html && html.length > 500) {
            console.log(
              `[extract-article] ✅ ${profile.name} + referer=${referer || "none"} → ${html.length} bytes`,
            );
            return { html, profile: `${profile.name}+${referer || "none"}` };
          }
          attempts.push(
            `${profile.name}+${referer || "none"}: empty (${html.length}b)`,
          );
          continue;
        }
        attempts.push(
          `${profile.name}+${referer || "none"}: HTTP ${res.status}`,
        );
      } catch (e) {
        attempts.push(
          `${profile.name}+${referer || "none"}: ${e instanceof Error ? e.message : "unknown"}`,
        );
      }
    }
  }
  console.log(
    `[extract-article] ❌ all attempts failed for ${url}:\n  ${attempts.join("\n  ")}`,
  );
  return { error: attempts[attempts.length - 1] || "unknown", attempts };
}

type ArticleImage = {
  url: string;
  alt: string;
  source: "og" | "body";
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractImagesFromHtml(html: string, baseUrl: string): ArticleImage[] {
  const out: ArticleImage[] = [];

  // og:image / twitter:image
  const ogPatterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image|og:image:url)["']/gi,
  ];
  for (const re of ogPatterns) {
    for (const m of html.matchAll(re)) {
      out.push({
        url: decodeHtmlEntities(m[1]),
        alt: "og:image",
        source: "og",
      });
    }
  }

  // <img src="..." alt="...">
  const imgRe =
    /<img[^>]*?(?:\s(?:src|data-src|data-original)=["']([^"']+)["'])[^>]*?(?:\salt=["']([^"']*)["'])?[^>]*>/gi;
  for (const m of html.matchAll(imgRe)) {
    const url = decodeHtmlEntities(m[1] || "");
    const alt = decodeHtmlEntities((m[2] || "").trim());
    if (!url) continue;
    out.push({ url, alt, source: "body" });
  }

  // 또 다른 패턴 — alt 가 src 보다 앞에 있는 경우
  const imgReAltFirst =
    /<img[^>]*?\salt=["']([^"']*)["'][^>]*?\s(?:src|data-src|data-original)=["']([^"']+)["'][^>]*>/gi;
  for (const m of html.matchAll(imgReAltFirst)) {
    const url = decodeHtmlEntities(m[2] || "");
    const alt = decodeHtmlEntities((m[1] || "").trim());
    if (!url) continue;
    out.push({ url, alt, source: "body" });
  }

  // 절대 URL로 변환
  const resolved = out.map((img) => {
    try {
      const abs = new URL(img.url, baseUrl).toString();
      return { ...img, url: abs };
    } catch {
      return img;
    }
  });

  // 노이즈 필터 (아이콘·로고·작은 사진)
  const filtered = resolved.filter((img) => {
    const u = img.url.toLowerCase();
    if (!/^https?:\/\//.test(u)) return false;
    if (/\.(svg|gif|ico)(\?|#|$)/.test(u)) return false;
    if (
      /(?:^|\/)(?:icon|favicon|sprite|emoji|avatar|profile|btn|button|logo|share|sns|loading|spinner|placeholder|ad|banner|gnb|footer|header)[^\/]*\.(png|jpg|jpeg|webp)/i.test(
        u,
      )
    )
      return false;
    // 작은 사이즈 쿼리 파라미터
    const sizeMatch =
      u.match(/[?&](?:w|width|size)=([0-9]+)/) ||
      u.match(/_(\d+)x(\d+)\./) ||
      null;
    if (sizeMatch) {
      const px = parseInt(sizeMatch[1], 10);
      if (px > 0 && px < 200) return false;
    }
    return true;
  });

  // URL 기준 중복 제거
  const seen = new Set<string>();
  const unique: ArticleImage[] = [];
  for (const img of filtered) {
    if (seen.has(img.url)) continue;
    seen.add(img.url);
    unique.push(img);
  }

  return unique;
}

async function assignImagesToScenes(
  images: ArticleImage[],
  scenes: { index: number; text: string }[],
): Promise<Record<number, string[]>> {
  if (images.length === 0 || scenes.length === 0) return {};

  // 이미지 너무 많으면 상위만 (Gemini 토큰 절약)
  const limitedImages = images.slice(0, 30);

  try {
    const ai = getGeminiClient();
    const prompt = `당신은 한국 쇼츠 편집자입니다. 기사에서 추출한 이미지를 씬 대본에 가장 어울리는 곳에 배정하세요.

## 씬 대본 (${scenes.length}개)
${scenes.map((s) => `씬 ${s.index}: "${s.text}"`).join("\n")}

## 이미지 풀 (${limitedImages.length}개)
${limitedImages.map((img, i) => `[${i}] alt: "${img.alt}" | url: ${img.url.slice(-80)}`).join("\n")}

## 규칙
- 각 이미지를 가장 잘 어울리는 1개 씬에 배정 (alt 텍스트와 씬 대본의 의미적 연관성 기준)
- 한 씬에 여러 이미지 OK
- 어울리는 씬이 정말 없으면 그 이미지는 배정에서 빼도 OK
- og:image (보통 대표 사진)는 첫 씬에 우선 배정

JSON 출력.`;

    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              assignments: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    imageIndex: { type: "integer" },
                    sceneIndex: { type: "integer" },
                  },
                  required: ["imageIndex", "sceneIndex"],
                },
              },
            },
            required: ["assignments"],
          },
        },
      }),
    );
    const data = JSON.parse(res.text || "{}");
    const result: Record<number, string[]> = {};
    for (const a of data.assignments || []) {
      if (
        typeof a.imageIndex !== "number" ||
        typeof a.sceneIndex !== "number"
      )
        continue;
      const img = limitedImages[a.imageIndex];
      if (!img) continue;
      if (!result[a.sceneIndex]) result[a.sceneIndex] = [];
      if (!result[a.sceneIndex].includes(img.url)) {
        result[a.sceneIndex].push(img.url);
      }
    }
    return result;
  } catch {
    // fallback: 라운드로빈
    const result: Record<number, string[]> = {};
    limitedImages.forEach((img, i) => {
      const sceneIdx = scenes[i % scenes.length].index;
      if (!result[sceneIdx]) result[sceneIdx] = [];
      result[sceneIdx].push(img.url);
    });
    return result;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const url: string = (body.url || "").trim();
    const scenes: { index: number; text: string }[] = Array.isArray(
      body.scenes,
    )
      ? body.scenes
      : [];

    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json(
        { error: "유효한 URL이 필요합니다." },
        { status: 400 },
      );
    }

    console.log(`[extract-article] requesting URL: ${url}`);
    const fetchResult = await fetchHtmlWithFallback(url);
    if ("error" in fetchResult) {
      return NextResponse.json(
        {
          error: `기사 가져오기 실패: ${fetchResult.error}`,
          attempts: fetchResult.attempts,
          url,
        },
        { status: 502 },
      );
    }
    const html = fetchResult.html;

    const images = extractImagesFromHtml(html, url);
    if (images.length === 0) {
      return NextResponse.json({ images: [], byScene: {}, total: 0 });
    }

    const byScene =
      scenes.length > 0 ? await assignImagesToScenes(images, scenes) : {};

    return NextResponse.json({
      images,
      byScene,
      total: images.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
