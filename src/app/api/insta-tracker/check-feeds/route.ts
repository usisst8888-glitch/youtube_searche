import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  startInstagramScraperRun,
  runInstagramScraperSync,
} from "@/lib/apify";
import { persistPosts, cleanupOldPosts } from "@/lib/insta-tracker";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Hobby cap

// 설정
const RESULTS_LIMIT = 10; // 프로필당 cap

// ── 헬퍼: active 프로필 목록 → instagram URL 배열 ─────────────────────
async function getActiveProfileUrls(): Promise<string[]> {
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("ig_profiles")
    .select("username")
    .eq("active", true);
  if (error) throw new Error(`프로필 조회 실패: ${error.message}`);
  return (data || []).map(
    (r: { username: string }) =>
      `https://www.instagram.com/${r.username}/`,
  );
}

// ───────────────────────────────────────────────────────────────────────
// POST — 수동 실행
//   body: { mode?: "sync" | "async", triggeredBy?: "manual" | "cron" }
//   sync: 결과까지 기다림 (소수 프로필, 60s 이내)
//   async: Apify run 시작만, webhook이 콜백
// ───────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode: "sync" | "async" = body?.mode === "sync" ? "sync" : "async";
    const triggeredBy: "manual" | "cron" =
      body?.triggeredBy === "cron" ? "cron" : "manual";

    const urls = await getActiveProfileUrls();
    if (urls.length === 0) {
      return NextResponse.json(
        { error: "등록된 활성 프로필이 없어요." },
        { status: 400 },
      );
    }

    const sb = getSupabaseServer();

    // run 레코드 생성
    const { data: runRow, error: runErr } = await sb
      .from("ig_check_runs")
      .insert({
        profile_count: urls.length,
        triggered_by: triggeredBy,
        status: "running",
      })
      .select()
      .single();
    if (runErr) {
      return NextResponse.json(
        { error: `run 기록 실패: ${runErr.message}` },
        { status: 500 },
      );
    }
    const runId = runRow.id;

    const scraperInput = {
      directUrls: urls,
      resultsLimit: RESULTS_LIMIT,
      resultsType: "posts" as const,
      addParentData: false,
    };

    if (mode === "sync") {
      // 작은 규모(10 프로필 이하 권장)일 때만 사용
      try {
        const posts = await runInstagramScraperSync(scraperInput, {
          timeoutSec: 50,
        });
        const result = await persistPosts(posts, runId);
        // 24h 지난 거 자동 삭제
        const cleanup = await cleanupOldPosts();
        await sb
          .from("ig_check_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: "done",
          })
          .eq("id", runId);
        return NextResponse.json({
          runId,
          mode,
          ...result,
          deleted: cleanup.deleted,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : "Apify 실행 실패";
        await sb
          .from("ig_check_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: "failed",
            error: errMsg,
          })
          .eq("id", runId);
        return NextResponse.json({ error: errMsg, runId }, { status: 500 });
      }
    }

    // async — webhook 콜백으로 결과 받기
    // 로컬 개발 시 webhook URL이 없을 수 있으니 환경변수로 제어
    const webhookBase = process.env.PUBLIC_APP_URL;
    const webhooks = webhookBase
      ? [
          {
            eventTypes: [
              "ACTOR.RUN.SUCCEEDED",
              "ACTOR.RUN.FAILED",
              "ACTOR.RUN.ABORTED",
              "ACTOR.RUN.TIMED_OUT",
            ],
            requestUrl: `${webhookBase.replace(/\/$/, "")}/api/insta-tracker/webhook?runRecordId=${runId}`,
          },
        ]
      : undefined;

    const runInfo = await startInstagramScraperRun(scraperInput, webhooks);

    await sb
      .from("ig_check_runs")
      .update({ apify_run_id: runInfo.id })
      .eq("id", runId);

    return NextResponse.json({
      runId,
      apifyRunId: runInfo.id,
      mode,
      status: runInfo.status,
      profileCount: urls.length,
      webhookConfigured: !!webhooks,
      note: webhooks
        ? "Apify가 완료되면 webhook으로 결과 저장됩니다."
        : "PUBLIC_APP_URL 환경변수가 없어서 webhook이 설정되지 않았어요. /api/insta-tracker/poll?runId=... 로 폴링하세요.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}

// ───────────────────────────────────────────────────────────────────────
// GET — cron 진입점 (Vercel cron이 GET으로 호출함)
// ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Vercel Cron은 CRON_SECRET을 Authorization header로 보냄
  const auth = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // cron은 항상 async (long task)
  return POST(
    new NextRequest(req.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "async", triggeredBy: "cron" }),
    }),
  );
}
