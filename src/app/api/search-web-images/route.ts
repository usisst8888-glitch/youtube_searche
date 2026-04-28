import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type WebImage = {
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  title: string;
  siteName: string;
};

/**
 * Bing 이미지 검색 결과 페이지를 서버에서 직접 가져와서 이미지 데이터 추출.
 * Bing은 a.iusc 요소의 m="{json}" 속성에 이미지 메타를 인라인 임베드함 → 파싱 가능.
 * API 키 없음, 등록 없음.
 */
async function bingImageSearch(
  query: string,
  limit: number,
  excludeUrls: Set<string> = new Set(),
): Promise<WebImage[]> {
  // 중복 회피용으로 충분히 많이 가져옴
  const fetchCount = Math.min(35, Math.max(15, limit + excludeUrls.size + 5));
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(
    query,
  )}&form=HDRSC2&count=${fetchCount}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`Bing ${res.status}`);
  const html = await res.text();

  // <a class="iusc" m="{...json...}"> 패턴 — m 속성의 JSON에 모든 메타 들어있음
  const matches = Array.from(html.matchAll(/m="({[^"]+})"/g));
  const out: WebImage[] = [];
  for (const m of matches) {
    if (out.length >= limit) break;
    try {
      // HTML 엔티티 디코드
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
      if (!obj.murl) continue;
      if (excludeUrls.has(obj.murl)) continue; // 중복 회피
      // hostname 추출
      let siteName = "";
      try {
        siteName = new URL(obj.purl || obj.murl).hostname.replace(/^www\./, "");
      } catch {}
      out.push({
        imageUrl: obj.murl,
        thumbnailUrl: obj.turl || obj.murl,
        sourceUrl: obj.purl || obj.murl,
        title: obj.t || obj.desc || "",
        siteName: siteName || "Web",
      });
    } catch {
      // 파싱 실패하면 건너뛰기
    }
  }

  return out;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const query: string = (body.query || "").trim();
    const limit: number = Math.max(1, Math.min(20, body.limit || 5));
    const exclude: string[] = Array.isArray(body.exclude)
      ? body.exclude.filter((s: unknown): s is string => typeof s === "string")
      : [];

    if (!query) {
      return NextResponse.json(
        { error: "query가 필요합니다." },
        { status: 400 },
      );
    }

    const images = await bingImageSearch(query, limit, new Set(exclude));
    return NextResponse.json({ query, images });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "검색 실패" },
      { status: 500 },
    );
  }
}
