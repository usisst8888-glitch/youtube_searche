import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const ALLOWED_PREFIXES = [
  "https://",
  "http://",
];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url 파라미터 필요" }, { status: 400 });
  }
  if (!ALLOWED_PREFIXES.some((p) => url.startsWith(p))) {
    return NextResponse.json({ error: "잘못된 URL" }, { status: 400 });
  }
  // 일부 사이트는 hotlink 보호 — 자기 도메인 referer 필요
  let referer: string | undefined;
  try {
    const u = new URL(url);
    if (u.hostname.includes("jjalbang.today")) {
      referer = "https://www.jjalbang.today/";
    }
  } catch {}

  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "image/*,audio/*,video/*,*/*;q=0.8",
        ...(referer ? { Referer: referer } : {}),
      },
      redirect: "follow",
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: upstream.status },
      );
    }
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: "파일이 너무 큽니다 (>50MB)" },
        { status: 413 },
      );
    }
    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    return new NextResponse(buf, {
      headers: {
        "Content-Type": ct,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "프록시 오류";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
