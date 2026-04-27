import { NextRequest, NextResponse } from "next/server";
import ytdl from "@distube/ytdl-core";

export const runtime = "nodejs";
export const maxDuration = 180;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const MAX_BYTES = 80 * 1024 * 1024; // 80MB

function normalizeYoutubeUrl(input: string): string | null {
  // youtube.com/shorts/<id> 도 watch URL로 정규화
  const shortsMatch = input.match(
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  );
  if (shortsMatch) return `https://www.youtube.com/watch?v=${shortsMatch[1]}`;
  if (ytdl.validateURL(input)) return input;
  return null;
}

async function downloadYoutube(url: string): Promise<Buffer> {
  const info = await ytdl.getInfo(url);
  // mp4 + audio 포함 형식 우선
  let format = ytdl.chooseFormat(info.formats, {
    quality: "highest",
    filter: (f) =>
      Boolean(f.hasVideo && f.hasAudio && (f.container === "mp4" || f.mimeType?.includes("mp4"))),
  });
  // 없으면 가장 좋은 video-only 픽
  if (!format) {
    format = ytdl.chooseFormat(info.formats, {
      quality: "highestvideo",
      filter: "videoonly",
    });
  }
  if (!format) {
    throw new Error("재생 가능한 포맷을 찾지 못했습니다.");
  }
  const stream = ytdl(url, { format });
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BYTES) {
      throw new Error("영상이 너무 큽니다 (>80MB)");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function downloadGeneric(url: string): Promise<{ buf: Buffer; ct: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: url.includes("tiktok") ? "https://www.tiktok.com/" : undefined,
      Accept: "video/*,*/*;q=0.8",
    } as HeadersInit,
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`upstream ${res.status}`);
  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_BYTES) throw new Error("영상이 너무 큽니다 (>80MB)");
  const ct = res.headers.get("content-type") || "video/mp4";
  return { buf: Buffer.from(ab), ct };
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url || !/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: "url 파라미터 필요" }, { status: 400 });
  }
  try {
    let buf: Buffer;
    let ct = "video/mp4";

    const ytUrl = normalizeYoutubeUrl(url);
    if (ytUrl) {
      buf = await downloadYoutube(ytUrl);
    } else {
      // TikTok playUrl 또는 기타 직접 영상 URL
      const r = await downloadGeneric(url);
      buf = r.buf;
      ct = r.ct;
    }

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": ct,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "다운로드 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
