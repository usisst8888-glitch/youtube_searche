import crypto from "crypto";

const BASE = "https://api-gateway.coupang.com";

export type CoupangProduct = {
  productId: number;
  productName: string;
  productImage: string;
  productPrice: number;
  productUrl: string;
  categoryName?: string;
  isRocket?: boolean;
  isFreeShipping?: boolean;
};

export function hasCoupangKeys(): boolean {
  return !!(
    process.env.COUPANG_ACCESS_KEY && process.env.COUPANG_SECRET_KEY
  );
}

function formatDatetime(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function signRequest(method: string, pathWithQuery: string): string {
  const accessKey = process.env.COUPANG_ACCESS_KEY!;
  const secretKey = process.env.COUPANG_SECRET_KEY!;
  const [path, query = ""] = pathWithQuery.split("?");

  const datetime = formatDatetime();
  const message = datetime + method + path + query;
  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("hex");

  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

export function coupangSearchUrl(keyword: string): string {
  return `https://www.coupang.com/np/search?q=${encodeURIComponent(keyword)}`;
}

export async function searchCoupangProducts(
  keyword: string,
  limit = 3,
): Promise<CoupangProduct[] | null> {
  if (!hasCoupangKeys()) return null;

  const path = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";
  const query = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;
  const url = `${BASE}${path}?${query}`;
  const auth = signRequest("GET", `${path}?${query}`);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: auth,
      },
    });

    if (!res.ok) {
      return null;
    }

    const json = await res.json();
    const items = (json?.data?.productData || json?.data || []) as {
      productId: number;
      productName: string;
      productImage: string;
      productPrice: number;
      productUrl: string;
      categoryName?: string;
      isRocket?: boolean;
      isFreeShipping?: boolean;
    }[];

    return items.map((p) => ({
      productId: p.productId,
      productName: p.productName,
      productImage: p.productImage,
      productPrice: p.productPrice,
      productUrl: p.productUrl,
      categoryName: p.categoryName,
      isRocket: p.isRocket,
      isFreeShipping: p.isFreeShipping,
    }));
  } catch {
    return null;
  }
}
