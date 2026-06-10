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

export type TranscriptSegment = {
  text: string;
  offsetSec: number;
  durationSec: number;
};

/**
 * 타임스탬프 포함 segments 반환.
 * youtube-transcript 내부적으로 두 경로(InnerTube=ms, XML fallback=sec)를 쓰는데
 * 어느 쪽이 응답해도 초 단위로 정규화해서 돌려준다.
 * videoDurationSec를 넘기면 단위 판정이 더 정확.
 */
export async function tryFetchTranscriptSegments(
  videoId: string,
  videoDurationSec?: number,
): Promise<TranscriptSegment[] | null> {
  const fetchOne = async (
    lang?: string,
  ): Promise<{ text: string; offset: number; duration: number }[] | null> => {
    try {
      const r = lang
        ? await YoutubeTranscript.fetchTranscript(videoId, { lang })
        : await YoutubeTranscript.fetchTranscript(videoId);
      return r.length === 0 ? null : r;
    } catch {
      return null;
    }
  };
  const raw = (await fetchOne("ko")) ?? (await fetchOne());
  if (!raw) return null;

  const maxOff = raw.reduce((m, s) => Math.max(m, s.offset), 0);
  // ms로 추정 — 알려진 길이의 5배 넘거나, 절대값이 10시간 초과면 ms
  const looksMs = videoDurationSec
    ? maxOff > videoDurationSec * 5
    : maxOff > 36000;
  const div = looksMs ? 1000 : 1;

  return raw.map((s) => ({
    text: s.text,
    offsetSec: s.offset / div,
    durationSec: s.duration / div,
  }));
}
