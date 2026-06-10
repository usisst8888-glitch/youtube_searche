// 쇼츠 소재 분석 — SSE 스트리밍 라우트.
// GET /api/shorts-analyzer/stream?url=<youtube_url>&maxZones=5
//
// 진행 단계와 결과를 SSE 이벤트로 흘려보낸다:
//   event: stage    { stage: "collecting" | "normalizing" | "merging" | "analyzing" | "done" }
//   event: log      { msg: string }
//   event: analyze_progress { done: number, total: number }
//   event: result   { ...최종 결과 }
//   event: error    { message: string }

import { NextRequest } from "next/server";
import path from "node:path";
import fs from "node:fs/promises";

import { collect, collectReference, getDefaultDataDir, type ReferenceMeta } from "@/lib/shorts-analyzer/collector";
import { normalizeComments, normalizeSubtitle, formatTime } from "@/lib/shorts-analyzer/normalizer";
import {
  clusterCommentSignals,
  detectHeatmapPeaks,
  buildHotZones,
  type HotZone,
} from "@/lib/shorts-analyzer/signal-merger";
import { analyzeZone, identifyEntities, type ZoneAnalysis, type AnalysisContext } from "@/lib/shorts-analyzer/analyzer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type AnalyzedZone = {
  zone: HotZone;
  analysis: ZoneAnalysis | null;
  error: string | null;
};

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  const maxZones = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("maxZones") || "5", 10) || 5, 1),
    10,
  );
  const refUrls = req.nextUrl.searchParams
    .getAll("ref")
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(s))
    .slice(0, 3);
  const playbackSpeed = Math.min(
    Math.max(parseFloat(req.nextUrl.searchParams.get("speed") || "1.2") || 1.2, 1.0),
    1.5,
  );
  const targetCutMinSec = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("cutMin") || "60", 10) || 60, 30),
    120,
  );
  const targetCutMaxSec = Math.min(
    Math.max(parseInt(req.nextUrl.searchParams.get("cutMax") || "80", 10) || 80, targetCutMinSec + 5),
    150,
  );
  // 사용자가 명시한 인물/키워드 hint (쉼표 구분, "이름:역할" 또는 "이름")
  const manualEntitiesRaw = req.nextUrl.searchParams.get("entities") || "";
  const manualEntities = manualEntitiesRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((s) => {
      const [name, role] = s.split(":").map((x) => x.trim());
      return { name, role: role || undefined };
    });
  // 사용자가 부정한 인물 (쉼표 구분)
  const forbiddenEntities = (req.nextUrl.searchParams.get("forbid") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  // 사용자가 영상 중간에 삽입할 본인의 생각·내레이션 텍스트
  const narrationText = (req.nextUrl.searchParams.get("narration") || "").slice(0, 600);
  // 핫존 누적 추가용: 처음 N개는 건너뛰고 그 다음부터 분석.
  const skip = Math.max(0, parseInt(req.nextUrl.searchParams.get("skip") || "0", 10) || 0);

  if (!url) {
    return new Response("missing url", { status: 400 });
  }
  if (!/^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return new Response("youtube url required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const dataDir = getDefaultDataDir();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (type: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };
      const log = (msg: string) => send("log", { msg });
      const stage = (s: string, info: Record<string, unknown> = {}) =>
        send("stage", { stage: s, ...info });

      // 하트비트 (Vercel 등 30초 idle 끊김 방지용. 로컬 dev에서도 무해함)
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      });

      try {
        stage("collecting");
        const collected = await collect(url, dataDir, { onLog: log, onStage: (s) => stage(`collect:${s}`) });
        log(
          `수집 완료: ${collected.title} / 길이 ${formatTime(collected.durationSec)} / 댓글 ${collected.comments.length}개 / 히트맵 ${collected.heatmap ? "있음" : "없음"} / 자막 ${collected.subtitleSource || "없음"}`,
        );

        stage("normalizing");
        const { signals, scanned, withTimestamp } = normalizeComments(
          collected.comments,
          collected.durationSec,
        );
        log(`댓글 ${scanned}개 스캔 → 타임스탬프 포함 ${withTimestamp}개 → 시그널 ${signals.length}개`);

        const subtitleSegments = normalizeSubtitle(collected.subtitleJson as never);
        log(`자막 세그먼트 ${subtitleSegments.length}개`);

        stage("merging");
        const commentClusters = clusterCommentSignals(signals);
        log(`댓글 클러스터 ${commentClusters.length}개`);

        const heatmapPeaks = detectHeatmapPeaks(collected.heatmap);
        log(`히트맵 피크 ${heatmapPeaks.length}개${collected.heatmap ? "" : " (히트맵 없음)"}`);

        const hotZones = buildHotZones({
          commentClusters,
          heatmapPeaks,
          subtitleSegments,
          videoDurationSec: collected.durationSec,
        });
        log(`핫존 ${hotZones.length}개 산출 (상위 ${Math.min(hotZones.length, maxZones)}개 분석 예정)`);

        if (hotZones.length === 0) {
          throw new Error(
            "분석할 핫존을 찾지 못했습니다. 댓글에 타임스탬프가 거의 없고 Most Replayed 데이터도 없는 영상일 수 있습니다.",
          );
        }

        // 영상 전반 인기 댓글 상위 30 — 인물·작품 식별용 글로벌 컨텍스트
        const globalTopComments = [...collected.comments]
          .map((c) => ({ text: (c.text || "").trim(), likes: c.like_count ?? c.likeCount ?? 0 }))
          .filter((c) => c.text.length >= 2)
          .sort((a, b) => b.likes - a.likes)
          .filter((c, i, arr) => arr.findIndex((x) => x.text === c.text) === i)
          .slice(0, 30);

        // 레퍼런스 쇼츠 수집 (병렬, 실패해도 분석은 계속)
        const references: ReferenceMeta[] = [];
        if (refUrls.length > 0) {
          stage("collecting_references", { total: refUrls.length });
          const results = await Promise.allSettled(
            refUrls.map((u) => collectReference(u, dataDir, (m) => log(`[ref] ${m}`))),
          );
          for (const r of results) {
            if (r.status === "fulfilled") references.push(r.value);
            else log(`레퍼런스 수집 실패: ${r.reason?.message || r.reason}`);
          }
          log(`레퍼런스 ${references.length}/${refUrls.length}개 수집 완료`);
        }

        // ============================================================
        // 사전 단계: LLM이 자동으로 등장 인물 식별 (자막 가사 오인 차단)
        // ============================================================
        stage("identifying");
        let autoConfirmed: { name: string; role?: string }[] = [];
        let autoForbidden: string[] = [];
        try {
          const id = await identifyEntities({
            videoTitle: collected.title,
            uploader: collected.uploader,
            videoDescription: collected.description || "",
            videoTags: collected.tags || [],
            globalTopComments,
          });
          autoConfirmed = id.confirmed;
          autoForbidden = id.forbidden;
          log(
            `자동 식별: 인물 ${id.confirmed.map((c) => c.name).join(", ") || "(없음)"} / 부정 ${id.forbidden.join(", ") || "(없음)"}`,
          );
          send("identified", { confirmed: id.confirmed, forbidden: id.forbidden, reasoning: id.reasoning });
        } catch (e) {
          log(`자동 인물 식별 실패 (계속 진행): ${(e as Error).message}`);
        }

        // 사용자 hint + 자동 식별 결과 머지 (사용자 hint 우선)
        const userNames = new Set(manualEntities.map((e) => e.name));
        const mergedManual = [
          ...manualEntities,
          ...autoConfirmed.filter((e) => !userNames.has(e.name)),
        ];
        const mergedForbidden = Array.from(new Set([...forbiddenEntities, ...autoForbidden]));

        const analysisCtx: AnalysisContext = {
          videoTitle: collected.title,
          videoDurationSec: collected.durationSec,
          uploader: collected.uploader,
          videoDescription: collected.description || "",
          videoTags: collected.tags || [],
          videoCategories: collected.categories || [],
          globalTopComments,
          references,
          playbackSpeed,
          targetCutMinSec,
          targetCutMaxSec,
          manualEntities: mergedManual,
          forbiddenEntities: mergedForbidden,
          narrationText,
        };

        const targets = hotZones.slice(skip, skip + maxZones);
        log(`핫존 총 ${hotZones.length}개 중 ${skip + 1}번째부터 ${targets.length}개 분석`);
        stage("analyzing", { total: targets.length });
        const analyzed: AnalyzedZone[] = [];
        for (let i = 0; i < targets.length; i++) {
          send("analyze_progress", { done: i, total: targets.length });
          if (closed) return;
          try {
            const a = await analyzeZone(targets[i], analysisCtx);
            analyzed.push({ zone: targets[i], analysis: a, error: null });
            log(`Gemini 분석 ${i + 1}/${targets.length} 완료`);
            // 매 핫존이 끝날 때마다 부분 결과를 흘려보내 사용자가 빨리 볼 수 있게.
            send("zone_done", {
              index: i,
              total: targets.length,
              zone: targets[i],
              analysis: a,
            });
          } catch (e) {
            const msg = (e as Error).message || String(e);
            analyzed.push({ zone: targets[i], analysis: null, error: msg });
            log(`Gemini 분석 ${i + 1}/${targets.length} 실패: ${msg}`);
          }
        }
        send("analyze_progress", { done: targets.length, total: targets.length });

        const result = {
          video: {
            id: collected.videoId,
            title: collected.title,
            url: collected.webpageUrl,
            durationSec: collected.durationSec,
            uploader: collected.uploader,
            viewCount: collected.viewCount,
            thumbnail: collected.thumbnail,
          },
          summary: {
            commentsScanned: scanned,
            commentsWithTimestamp: withTimestamp,
            signalCount: signals.length,
            commentClusterCount: commentClusters.length,
            heatmapAvailable: !!collected.heatmap,
            heatmapPeakCount: heatmapPeaks.length,
            hotZoneCount: hotZones.length,
            analyzedZoneCount: analyzed.length,
          },
          // 누적 추가용 메타
          skip,
          nextSkip: skip + analyzed.length,
          hasMore: skip + analyzed.length < hotZones.length,
          zones: analyzed.map(({ zone, analysis, error }) => {
            // LLM이 zone 범위를 벗어나거나 너무 짧게 출력하면 안전하게 보정.
            let clampedAnalysis = analysis;
            if (analysis?.optimalCut) {
              let cs = Math.max(zone.startSec, Math.min(zone.endSec - 1, Math.round(analysis.optimalCut.startSec)));
              let ce = Math.max(cs + 1, Math.min(zone.endSec, Math.round(analysis.optimalCut.endSec)));
              // 최소 길이(targetCutMinSec) 강제 — 가능한 범위 내에서 앞·뒤로 확장.
              const minLen = targetCutMinSec;
              const availableLen = zone.endSec - zone.startSec;
              if (ce - cs < minLen && availableLen >= minLen) {
                const need = minLen - (ce - cs);
                const expandPre = Math.min(need, cs - zone.startSec);
                cs -= expandPre;
                const stillNeed = minLen - (ce - cs);
                if (stillNeed > 0) {
                  const expandPost = Math.min(stillNeed, zone.endSec - ce);
                  ce += expandPost;
                }
              }
              const clipDuration = ce - cs;
              // narration segments 검증/clamp:
              // - 위치: 쇼츠 기준 임팩트(centerSec - cutStart) 직전 -10~-1초 또는 직후 +1~+5초
              // - 길이: 1~2.5초
              // - 첫 3초 후크 + 컷 끝 2초 침범 금지
              const narration = analysis.narrationPlan;
              let clampedNarration = narration;
              if (narration?.segments) {
                const impactRel = zone.centerSec - cs; // 쇼츠 기준 임팩트 위치
                const earliestPre = Math.max(3, impactRel - 10);
                const latestPost = Math.min(clipDuration - 4, impactRel + 5);
                const clampedSegments = narration.segments
                  .map((seg) => {
                    let dur = Math.max(1.5, Math.min(4.5, seg.durationSec || 3));
                    let ins = seg.insertAtSec;
                    // 임팩트 ±범위에서 벗어나면 가장 가까운 유효 위치로 보정
                    if (ins < earliestPre || ins > latestPost) {
                      // 임팩트 직전 우선 시도
                      ins = Math.max(earliestPre, impactRel - 3);
                    }
                    // 후크/엔딩 보호
                    ins = Math.max(3, Math.min(clipDuration - 2 - dur, ins));
                    if (ins + dur > clipDuration - 2) dur = Math.max(1.5, clipDuration - 2 - ins);
                    return {
                      ...seg,
                      insertAtSec: Math.round(ins * 10) / 10,
                      durationSec: Math.round(dur * 10) / 10,
                    };
                  })
                  .filter((seg) => seg.durationSec >= 1.5)
                  .sort((a, b) => a.insertAtSec - b.insertAtSec);
                clampedNarration = { ...narration, segments: clampedSegments };
              }
              clampedAnalysis = {
                ...analysis,
                optimalCut: { ...analysis.optimalCut, startSec: cs, endSec: ce },
                narrationPlan: clampedNarration,
              };
            }
            return {
              startSec: zone.startSec,
              endSec: zone.endSec,
              centerSec: zone.centerSec,
              startLabel: formatTime(zone.startSec),
              endLabel: formatTime(zone.endSec),
              centerLabel: formatTime(zone.centerSec),
              kind: zone.kind,
              finalScore: Math.round(zone.finalScore * 100) / 100,
              mentionCount: zone.mentionCount,
              uniqueAuthors: zone.uniqueAuthors,
              heatmapOverlap: zone.heatmapOverlap,
              heatmapPeakValue: zone.heatmapPeakValue,
              tags: zone.tags,
              transcript: zone.transcript,
              pickedComments: zone.pickedComments,
              voiceGaps: zone.voiceGaps,
              analysis: clampedAnalysis,
              analysisError: error,
            };
          }),
        };

        try {
          await fs.writeFile(
            path.join(collected.workDir, "report.json"),
            JSON.stringify(result, null, 2),
          );
        } catch (e) {
          log(`리포트 저장 실패: ${(e as Error).message}`);
        }

        stage("done");
        send("result", result);
      } catch (e) {
        send("error", { message: (e as Error).message || String(e) });
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
