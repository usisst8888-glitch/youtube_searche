import { YoutubeTranscript } from "youtube-transcript";

export function extractVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  return null;
}

export async function tryFetchTranscript(
  videoId: string,
): Promise<string | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(videoId, {
      lang: "ko",
    });
    if (segments.length === 0) return null;
    return segments.map((s) => s.text).join(" ");
  } catch {
    try {
      const segments = await YoutubeTranscript.fetchTranscript(videoId);
      if (segments.length === 0) return null;
      return segments.map((s) => s.text).join(" ");
    } catch {
      return null;
    }
  }
}
