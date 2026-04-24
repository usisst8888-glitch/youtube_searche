/**
 * YouTube 영상의 공식 "제품 보기" (YouTube Shopping 제품 태그) 추출.
 *
 * YouTube Data API v3은 쇼핑 태그 정보를 노출하지 않아서,
 * watch 페이지 HTML 안의 ytInitialData JSON을 파싱해 product renderer들을 찾는다.
 * 페이지 구조가 바뀌면 깨질 수 있음 — 개인 프로젝트용.
 */

export type YoutubeShoppingProduct = {
  title: string;
  thumbnailUrl: string;
  price: string;
  merchantName: string;
  buyUrl: string;
  accessibilityText: string;
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

type Walkable =
  | { [k: string]: unknown }
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

function extractYtInitialData(html: string): unknown | null {
  // 다양한 래핑 패턴 대응
  const patterns = [
    /var\s+ytInitialData\s*=\s*({[\s\S]*?});\s*<\/script>/,
    /var\s+ytInitialData\s*=\s*({[\s\S]*?});\s*var\s+/,
    /ytInitialData\s*=\s*({[\s\S]*?});/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) {
      try {
        return JSON.parse(m[1]);
      } catch {
        // continue
      }
    }
  }
  return null;
}

function walkFindRenderers(
  node: Walkable,
  rendererKeys: Set<string>,
  out: { key: string; value: unknown }[] = [],
): { key: string; value: unknown }[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) walkFindRenderers(item as Walkable, rendererKeys, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (rendererKeys.has(key)) {
      out.push({ key, value: obj[key] });
    }
    walkFindRenderers(obj[key] as Walkable, rendererKeys, out);
  }
  return out;
}

type RenderText = { simpleText?: string; runs?: { text?: string }[] };

function txt(n: unknown): string {
  const x = n as RenderText | undefined;
  if (!x) return "";
  if (typeof x === "string") return x;
  if (typeof x.simpleText === "string") return x.simpleText;
  if (Array.isArray(x.runs))
    return x.runs.map((r) => r?.text || "").join("").trim();
  return "";
}

function pickThumb(n: unknown): string {
  const x = n as { thumbnails?: { url?: string; width?: number }[] } | undefined;
  const arr = x?.thumbnails || [];
  if (arr.length === 0) return "";
  const sorted = [...arr].sort(
    (a, b) => (b.width || 0) - (a.width || 0),
  );
  return sorted[0]?.url || "";
}

function extractBuyUrl(n: unknown): string {
  // productItemRenderer 에는 navigationEndpoint.urlEndpoint.url 가 있음
  const x = n as {
    navigationEndpoint?: {
      urlEndpoint?: { url?: string };
      commandMetadata?: {
        webCommandMetadata?: { url?: string };
      };
    };
    onTapCommand?: { urlEndpoint?: { url?: string } };
  };
  return (
    x?.navigationEndpoint?.urlEndpoint?.url ||
    x?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url ||
    x?.onTapCommand?.urlEndpoint?.url ||
    ""
  );
}

function parseProductRenderer(
  r: unknown,
): YoutubeShoppingProduct | null {
  const x = r as Record<string, unknown>;
  if (!x) return null;
  const title = txt(x.title);
  if (!title) return null;
  const thumb = pickThumb(x.thumbnail);
  const price = txt(x.price) || txt(x.displayPrice);
  const merchant = txt(x.merchantName) || txt(x.fromSource);
  const buyUrl = extractBuyUrl(x);
  const a11y = txt(x.accessibilityText) || title;
  return {
    title,
    thumbnailUrl: thumb,
    price,
    merchantName: merchant,
    buyUrl,
    accessibilityText: a11y,
  };
}

const SHOPPING_RENDERER_KEYS = new Set([
  "productItemRenderer",
  "productListItemRenderer",
  "productShelfLineItemRenderer",
  "shoppingProductCardRenderer",
  "merchandiseItemRenderer",
  "productCardRenderer",
  "productPreviewRenderer",
  "miniShoppingProductRenderer",
]);

export async function fetchYoutubeShoppingProducts(
  videoId: string,
): Promise<YoutubeShoppingProduct[]> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=ko&gl=KR&persist_hl=1`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const html = await res.text();

  const data = extractYtInitialData(html);
  if (!data) return [];

  const renderers = walkFindRenderers(
    data as Walkable,
    SHOPPING_RENDERER_KEYS,
  );

  const products: YoutubeShoppingProduct[] = [];
  const seen = new Set<string>();
  for (const { value } of renderers) {
    const p = parseProductRenderer(value);
    if (!p) continue;
    const key = `${p.title}|${p.buyUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    products.push(p);
  }
  return products;
}
