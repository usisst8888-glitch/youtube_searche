// 댓글 본문에서 타임스탬프 추출 + 자막 정규화.

// 시:분:초 또는 분:초 패턴.
// - lookbehind/lookahead로 인접 글자만 검사 (글자를 소비하지 않음 → 인접 타임스탬프 안전)
// - 앞뒤로 ":" 가 더 붙은 경우는 매칭 X (예: "1:05:30" 안의 "1:05"가 별도로 잡히지 않도록)
// - 초는 항상 2자리, 분은 1~2자리. 시는 1~2자리 + 옵션.
const TIMESTAMP_RE = /(?<![0-9:])(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?![0-9:])/g;

const HUMOR_TAGS = [
  "ㅋㅋ", "ㅎㅎ", "개웃", "소름", "미쳤", "ㄷㄷ", "오진", "ㅠㅠ",
  "ㄹㅇ", "대박", "레전드", "ㅁㅊ", "와씨", "쩐다", "킹받", "찐",
];

export type RawComment = {
  text?: string;
  like_count?: number;
  likeCount?: number;
  author?: string;
  author_id?: string;
};

export type CommentSignal = {
  second: number;
  commentText: string;
  likeCount: number;
  weight: number;
  tags: string[];
  author: string;
};

export type SubtitleSegment = { start: number; end: number; text: string };

function parseTimestampsFromText(text: string, videoDurationSec: number): number[] {
  const seen = new Set<number>();
  const seconds: number[] = [];
  for (const m of text.matchAll(TIMESTAMP_RE)) {
    const h = m[1] ? parseInt(m[1], 10) : 0;
    const mi = parseInt(m[2], 10);
    const s = parseInt(m[3], 10);
    if (Number.isNaN(h) || Number.isNaN(mi) || Number.isNaN(s)) continue;
    if (s >= 60) continue;
    if (mi >= 60) continue; // 분은 항상 0~59 (시:분:초 형식이면 시 그룹이 시간 담당)
    if (h >= 24) continue;
    const total = h * 3600 + mi * 60 + s;
    if (total <= 0) continue;
    if (videoDurationSec && total >= videoDurationSec) continue;
    if (seen.has(total)) continue;
    seen.add(total);
    seconds.push(total);
  }
  return seconds;
}

function isLikelySpam(text: string, likeCount: number): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (likeCount === 0 && /https?:\/\//i.test(t)) return true;
  if (likeCount === 0 && t.length < 6) return true;
  return false;
}

export function normalizeComments(
  comments: RawComment[],
  videoDurationSec: number,
): { signals: CommentSignal[]; scanned: number; withTimestamp: number } {
  const signals: CommentSignal[] = [];
  let scanned = 0;
  let withTimestamp = 0;
  for (const c of comments || []) {
    scanned++;
    const text = c.text || "";
    const likeCount = c.like_count ?? c.likeCount ?? 0;
    if (isLikelySpam(text, likeCount)) continue;
    const seconds = parseTimestampsFromText(text, videoDurationSec);
    if (seconds.length === 0) continue;
    withTimestamp++;
    const tags = HUMOR_TAGS.filter((tag) => text.includes(tag));
    const baseWeight = 1 + Math.log1p(likeCount);
    for (const sec of seconds) {
      signals.push({
        second: sec,
        commentText: text,
        likeCount,
        weight: baseWeight,
        tags,
        author: c.author || c.author_id || "anon",
      });
    }
  }
  return { signals, scanned, withTimestamp };
}

type Json3Seg = { utf8?: string };
type Json3Event = { tStartMs?: number; dDurationMs?: number; segs?: Json3Seg[] };
type Json3Data = { events?: Json3Event[] };

export function normalizeSubtitle(json3Data: Json3Data | null): SubtitleSegment[] {
  if (!json3Data || !Array.isArray(json3Data.events)) return [];
  const out: SubtitleSegment[] = [];
  for (const ev of json3Data.events) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const start = (ev.tStartMs || 0) / 1000;
    const dur = (ev.dDurationMs || 0) / 1000;
    out.push({ start, end: start + dur, text });
  }
  return out;
}

export type VoiceGap = {
  /** 원본 영상 기준 시작 초 */
  startSec: number;
  /** 원본 영상 기준 끝 초 */
  endSec: number;
  /** 공백 길이 (초) */
  durationSec: number;
};

/**
 * 자막 timeline에서 음성이 비는 구간(gap)을 찾아 반환.
 * 이 구간에 내레이션을 박으면 끊김 없이 자연스러움.
 */
export function findVoiceGaps(
  segments: SubtitleSegment[],
  rangeStart: number,
  rangeEnd: number,
  minGapSec = 0.6,
): VoiceGap[] {
  const inRange = segments
    .filter((s) => s.end > rangeStart && s.start < rangeEnd)
    .map((s) => ({ start: Math.max(s.start, rangeStart), end: Math.min(s.end, rangeEnd) }))
    .sort((a, b) => a.start - b.start);

  const gaps: VoiceGap[] = [];
  let cursor = rangeStart;
  for (const s of inRange) {
    if (s.start - cursor >= minGapSec) {
      gaps.push({
        startSec: Math.round(cursor * 10) / 10,
        endSec: Math.round(s.start * 10) / 10,
        durationSec: Math.round((s.start - cursor) * 10) / 10,
      });
    }
    cursor = Math.max(cursor, s.end);
  }
  if (rangeEnd - cursor >= minGapSec) {
    gaps.push({
      startSec: Math.round(cursor * 10) / 10,
      endSec: Math.round(rangeEnd * 10) / 10,
      durationSec: Math.round((rangeEnd - cursor) * 10) / 10,
    });
  }
  return gaps;
}

export function formatTime(sec: number): string {
  const v = Math.max(0, Math.round(sec));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  const s = v % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
