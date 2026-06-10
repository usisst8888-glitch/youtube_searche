// 댓글 시그널 클러스터링 + 히트맵 피크 결합 → 핫존.

import type { CommentSignal, SubtitleSegment, VoiceGap } from "./normalizer";
import { findVoiceGaps } from "./normalizer";

const CLUSTER_WINDOW_SEC = 12;
// 핫존은 임팩트(centerSec) 중심 ±30초로 좁게. 다른 임팩트·다른 내용 침범 방지.
// 사용자 컷 길이 40~60초에 맞춰 LLM이 이 안에서 선택.
const HOTZONE_PRE_SEC = 30;
const HOTZONE_POST_SEC = 30;
// 자막 컨텍스트도 더 좁게 — 임팩트 일관성 우선.
const TRANSCRIPT_CTX_SEC = 15;
const HEATMAP_BOOST = 1.8;
const HEATMAP_ONLY_DISCOUNT = 0.5;

export type PickedComment = { text: string; likes: number; tags: string[]; author: string };

export type CommentCluster = {
  centerSec: number;
  mentionCount: number;
  uniqueAuthorCount: number;
  totalLikes: number;
  score: number;
  tags: string[];
  comments: PickedComment[];
};

export type HeatmapEntry = { start_time: number; end_time: number; value: number };
export type HeatmapPeak = { startSec: number; endSec: number; value: number };

export type HotZone = {
  kind: "comment" | "heatmap-only";
  startSec: number;
  endSec: number;
  centerSec: number;
  commentScore: number;
  mentionCount: number;
  uniqueAuthors: number;
  totalLikes: number;
  heatmapOverlap: boolean;
  heatmapPeakValue: number | null;
  finalScore: number;
  transcript: string;
  pickedComments: PickedComment[];
  tags: string[];
  /** 핫존 범위 내 음성 공백 구간 — 내레이션 후보 시점 */
  voiceGaps: VoiceGap[];
};

export function clusterCommentSignals(signals: CommentSignal[]): CommentCluster[] {
  if (!signals.length) return [];
  const sorted = [...signals].sort((a, b) => a.second - b.second);
  const clusters: { center: number; signals: CommentSignal[] }[] = [];
  for (const sig of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && sig.second - last.center <= CLUSTER_WINDOW_SEC) {
      last.signals.push(sig);
      const sum = last.signals.reduce((a, s) => a + s.second, 0);
      last.center = sum / last.signals.length;
    } else {
      clusters.push({ center: sig.second, signals: [sig] });
    }
  }
  return clusters.map((c) => {
    const totalWeight = c.signals.reduce((a, s) => a + s.weight, 0);
    const uniqueAuthors = new Set(c.signals.map((s) => s.author)).size;
    const totalLikes = c.signals.reduce((a, s) => a + s.likeCount, 0);
    const tagSet = new Set<string>();
    c.signals.forEach((s) => s.tags.forEach((t) => tagSet.add(t)));
    const comments: PickedComment[] = c.signals
      .map((s) => ({ text: s.commentText, likes: s.likeCount, tags: s.tags, author: s.author }))
      .sort((a, b) => b.likes - a.likes)
      .filter((c, i, arr) => arr.findIndex((x) => x.text === c.text) === i)
      .slice(0, 20);
    return {
      centerSec: Math.round(c.center),
      mentionCount: c.signals.length,
      uniqueAuthorCount: uniqueAuthors,
      totalLikes,
      score: totalWeight + uniqueAuthors * 0.7,
      tags: [...tagSet],
      comments,
    };
  });
}

export function detectHeatmapPeaks(heatmap: HeatmapEntry[] | null): HeatmapPeak[] {
  if (!Array.isArray(heatmap) || heatmap.length === 0) return [];
  const values = heatmap.map((h) => h.value || 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  const threshold = mean + 1.0 * std;
  return heatmap
    .filter((h) => (h.value || 0) >= threshold)
    .map((h) => ({ startSec: h.start_time, endSec: h.end_time, value: h.value }));
}

export function buildHotZones(params: {
  commentClusters: CommentCluster[];
  heatmapPeaks: HeatmapPeak[];
  subtitleSegments: SubtitleSegment[];
  videoDurationSec: number;
}): HotZone[] {
  const { commentClusters, heatmapPeaks, subtitleSegments, videoDurationSec } = params;
  const zones: HotZone[] = [];

  for (const c of commentClusters) {
    const startSec = Math.max(0, c.centerSec - HOTZONE_PRE_SEC);
    const endSec = Math.min(
      videoDurationSec || c.centerSec + HOTZONE_POST_SEC,
      c.centerSec + HOTZONE_POST_SEC,
    );
    const overlapping = heatmapPeaks.filter((p) => p.startSec <= endSec && p.endSec >= startSec);
    const heatmapOverlap = overlapping.length > 0;
    const boost = heatmapOverlap ? HEATMAP_BOOST : 1.0;
    // 자막은 핫존 범위 ±25초까지 더 확장해 "빌드업 → 임팩트 → 여운" 흐름을 LLM에게 그대로 전달.
    const ctxStart = Math.max(0, startSec - TRANSCRIPT_CTX_SEC);
    const ctxEnd = endSec + TRANSCRIPT_CTX_SEC;
    const transcript = subtitleSegments
      .filter((s) => s.start <= ctxEnd && s.end >= ctxStart)
      .map((s) => s.text)
      .join(" ")
      .slice(0, 4000);

    zones.push({
      kind: "comment",
      startSec,
      endSec,
      centerSec: c.centerSec,
      commentScore: c.score,
      mentionCount: c.mentionCount,
      uniqueAuthors: c.uniqueAuthorCount,
      totalLikes: c.totalLikes,
      heatmapOverlap,
      heatmapPeakValue: overlapping[0]?.value ?? null,
      finalScore: c.score * boost,
      transcript,
      pickedComments: c.comments,
      tags: c.tags,
      voiceGaps: findVoiceGaps(subtitleSegments, startSec, endSec),
    });
  }

  if (zones.length < 5) {
    for (const peak of heatmapPeaks) {
      const dup = zones.some((z) => z.startSec <= peak.endSec && z.endSec >= peak.startSec);
      if (dup) continue;
      const transcript = subtitleSegments
        .filter((s) => s.start <= peak.endSec && s.end >= peak.startSec)
        .map((s) => s.text)
        .join(" ")
        .slice(0, 2000);
      zones.push({
        kind: "heatmap-only",
        startSec: peak.startSec,
        endSec: peak.endSec,
        centerSec: Math.round((peak.startSec + peak.endSec) / 2),
        commentScore: 0,
        mentionCount: 0,
        uniqueAuthors: 0,
        totalLikes: 0,
        heatmapOverlap: true,
        heatmapPeakValue: peak.value,
        finalScore: (peak.value || 1) * HEATMAP_ONLY_DISCOUNT,
        transcript,
        pickedComments: [],
        tags: [],
        voiceGaps: findVoiceGaps(subtitleSegments, peak.startSec, peak.endSec),
      });
    }
  }

  return zones.sort((a, b) => b.finalScore - a.finalScore);
}
