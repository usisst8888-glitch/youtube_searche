import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 120;
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

type FetchedImage = {
  sourceUrl: string;
  imageUrl: string;
  dataUrl: string;
  siteName?: string;
  title?: string;
};

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
  } catch {
    // noop
  }
  return Array.from(new Set(out));
}

function extractUrlsFromText(text: string): string[] {
  const re = /https?:\/\/[^\s)\]"'<>]+/gi;
  return Array.from(new Set(text.match(re) || []));
}

function extractOgImage(html: string): {
  imageUrl?: string;
  siteName?: string;
  title?: string;
} {
  const pick = (re: RegExp) => {
    const m = html.match(re);
    return m ? m[1] : undefined;
  };
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
  const siteName = pick(
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i,
  );
  const title =
    pick(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) || pick(/<title>([^<]+)<\/title>/i);
  return { imageUrl, siteName, title };
}

async function fetchPageHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchImageAsDataUrl(
  imageUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, {
      headers: { "User-Agent": UA, Accept: "image/*" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "image/jpeg";
    if (!ct.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) return null; // 8MB cap
    const base64 = Buffer.from(buf).toString("base64");
    return `data:${ct};base64,${base64}`;
  } catch {
    return null;
  }
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

export async function POST(req: NextRequest) {
  try {
    const { productName, max = 6 } = await req.json();
    if (!productName || typeof productName !== "string") {
      return NextResponse.json(
        { error: "productName이 필요합니다." },
        { status: 400 },
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const ai = getGeminiClient();
    const prompt = `한국에서 "${productName}" 제품의 **공식 판매 페이지 또는 상세 페이지 URL** 10개를 알려주세요.

우선순위:
1. 쿠팡 제품 페이지 (coupang.com/vp/products/...)
2. 네이버 스마트스토어 (smartstore.naver.com)
3. 공식 브랜드몰
4. 11번가, 지마켓, 옥션 등
5. 네이버 쇼핑 검색 결과

반드시 **제품 이미지가 포함된 실제 판매/상세 페이지**여야 합니다.
리뷰 블로그, 뉴스, 영상은 제외.

각 URL을 한 줄씩 나열만 해주세요. 설명 불필요.`;

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { tools: [{ googleSearch: {} }] },
      }),
    );

    // URL 추출 (groundingMetadata + 응답 텍스트 양쪽에서)
    const groundingUrls = extractGroundingUrls(response);
    const textUrls = extractUrlsFromText(response.text || "");
    const candidateUrls = Array.from(
      new Set([...groundingUrls, ...textUrls]),
    ).filter((u) => /^https?:\/\//.test(u));

    if (candidateUrls.length === 0) {
      return NextResponse.json(
        { error: "검색 결과 URL이 없습니다." },
        { status: 404 },
      );
    }

    // 각 URL → og:image 추출 → 이미지 다운로드
    const maxUrls = Math.min(20, candidateUrls.length);
    const pageResults = await pMapLimit(
      candidateUrls.slice(0, maxUrls),
      6,
      async (url) => {
        const html = await fetchPageHtml(url);
        if (!html) return null;
        const og = extractOgImage(html);
        if (!og.imageUrl) return null;
        return { sourceUrl: url, ...og };
      },
    );

    const withImages = pageResults.filter(
      (r): r is { sourceUrl: string; imageUrl: string; siteName?: string; title?: string } =>
        r !== null && !!r.imageUrl,
    );

    // 이미지 URL 중복 제거
    const seen = new Set<string>();
    const deduped = withImages.filter((r) => {
      if (seen.has(r.imageUrl)) return false;
      seen.add(r.imageUrl);
      return true;
    });

    const maxReturn = Math.min(20, Math.max(1, Number(max)));
    const target = deduped.slice(0, maxReturn);

    const downloaded: FetchedImage[] = [];
    const results = await pMapLimit(target, 4, async (r) => {
      const dataUrl = await fetchImageAsDataUrl(r.imageUrl);
      if (!dataUrl) return null;
      return {
        sourceUrl: r.sourceUrl,
        imageUrl: r.imageUrl,
        dataUrl,
        siteName: r.siteName,
        title: r.title,
      } satisfies FetchedImage;
    });

    for (const r of results) {
      if (r) downloaded.push(r);
    }

    if (downloaded.length === 0) {
      return NextResponse.json(
        {
          error: "이미지를 다운로드하지 못했습니다.",
          triedUrls: candidateUrls.slice(0, 5),
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      productName,
      images: downloaded,
      totalCandidates: candidateUrls.length,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
