import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;
export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0.0.0 Safari/537.36";

const JJAL_BASE = "https://www.jjalbang.today";

export type JjalItem = {
  num: string;
  title: string;
  ext: "mp4" | "gif" | "webm";
  mediaUrl: string; // 절대 URL — mp4/gif/webm 본체
  thumbnailUrl: string; // jpg 미리보기
  watchUrl: string; // jjalview 페이지
  tags: string[];
  tag: string; // 검색에 사용된 태그
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absoluteUrl(p: string): string {
  if (!p) return "";
  // 일부 항목은 lc_imgurl이 /_data/로 시작 — 외부에서는 /files/로 가야 함
  let normalized = p.replace(/^\/?_data\//, "/files/");
  if (!normalized.startsWith("/") && !/^https?:\/\//.test(normalized)) {
    normalized = `/${normalized}`;
  }
  if (/^https?:\/\//.test(normalized)) return normalized;
  return `${JJAL_BASE}${normalized}`;
}

async function fetchPage(
  tag: string,
  page: number,
  sort: "def" | "best",
): Promise<unknown[]> {
  const url = `${JJAL_BASE}/ajax/jjalbang_list_5177.php?tag=${encodeURIComponent(
    tag,
  )}&page=${page}&mode=tag&sort=${sort}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: `${JJAL_BASE}/tag/${encodeURIComponent(tag)}`,
      "X-Requested-With": "XMLHttpRequest",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  return Array.isArray(data) ? data : [];
}

function parseItem(raw: unknown, tag: string): JjalItem | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const ext = String(obj.lc_ext_type || "").toLowerCase();
  if (ext !== "mp4" && ext !== "gif" && ext !== "webm") return null;
  const imgurl = String(obj.lc_imgurl || "");
  if (!imgurl) return null;
  const num = String(obj.lc_num || "");
  const title = decodeHtmlEntities(String(obj.lc_keyword || "")).trim();
  const mediaUrl = absoluteUrl(imgurl);
  // mp4/webm/gif 모두 본체 URL을 그대로 사용 — 브라우저 <video> 가 첫 프레임을 자동 poster로 표시
  const thumbnailUrl = mediaUrl;
  // list_jjal HTML 안에서 태그 추출
  const listHtml = String(obj.list_jjal || "");
  const tagMatches = Array.from(
    listHtml.matchAll(/href='\/tag\/([^']+)'/g),
  ).map((m) => decodeURIComponent(m[1]));
  const tags = Array.from(new Set(tagMatches));

  return {
    num,
    title: title || tag,
    ext: ext as JjalItem["ext"],
    mediaUrl,
    thumbnailUrl,
    watchUrl: `${JJAL_BASE}/jjalview/${num}`,
    tags,
    tag,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tag: string = (body.tag || "").trim();
    const limit: number = Math.max(1, Math.min(30, body.limit || 8));
    const exclude: string[] = Array.isArray(body.exclude)
      ? body.exclude.filter(
          (s: unknown): s is string => typeof s === "string",
        )
      : [];
    const sort: "def" | "best" =
      body.sort === "best" ? "best" : "def";

    if (!tag) {
      return NextResponse.json(
        { error: "tag가 필요합니다." },
        { status: 400 },
      );
    }

    const seen = new Set(exclude);
    const out: JjalItem[] = [];
    // 페이지 여러 개 시도 (한 페이지당 8~16개, mp4/gif/webm만 필터되면 적게 나옴)
    for (let page = 1; page <= 5 && out.length < limit; page++) {
      const items = await fetchPage(tag, page, sort);
      if (items.length === 0) break;
      for (const raw of items) {
        const it = parseItem(raw, tag);
        if (!it) continue;
        if (seen.has(it.mediaUrl) || seen.has(it.num)) continue;
        seen.add(it.mediaUrl);
        out.push(it);
        if (out.length >= limit) break;
      }
    }

    return NextResponse.json({ tag, items: out });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "검색 실패" },
      { status: 500 },
    );
  }
}
