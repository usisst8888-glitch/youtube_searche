// 인스타 트래커 — Apify 결과를 우리 DB에 넣는 로직 (route 간 공유)

import { getSupabaseServer } from "@/lib/supabase";
import { normalizePost, type InstagramScraperPost } from "@/lib/apify";

/** "최근 24시간 이내" 윈도우 — 받은 포스트 중 이것만 저장.
 *  이보다 오래된 건 ingest 단계에서 skip + 기존 DB row는 cleanupOldPosts()가 삭제. */
export const HOURS_WINDOW = 24;
/** 호환을 위해 days로도 노출 (=1) */
export const DAYS_WINDOW = HOURS_WINDOW / 24;

export type PersistResult = {
  saved: number; // 저장한 (3일 이내) post 수
  skippedOld: number; // 3일 이전이라 버린 수
  newSeen: number; // 그 중 처음 본 (dedup 후) 수
};

export async function persistPosts(
  posts: InstagramScraperPost[],
  runRecordId: string | null,
): Promise<PersistResult> {
  const sb = getSupabaseServer();
  const now = Date.now();
  const cutoff = now - HOURS_WINDOW * 60 * 60 * 1000;

  let skippedOld = 0;
  const candidates: NonNullable<ReturnType<typeof normalizePost>>[] = [];
  for (const p of posts) {
    const n = normalizePost(p);
    if (!n) continue;
    const ts = new Date(n.posted_at).getTime();
    if (!Number.isFinite(ts)) continue;
    if (ts < cutoff) {
      skippedOld++;
      continue;
    }
    candidates.push(n);
  }

  if (candidates.length === 0) {
    if (runRecordId) {
      await sb
        .from("ig_check_runs")
        .update({
          fetched_post_count: posts.length,
          saved_post_count: 0,
          new_post_count: 0,
        })
        .eq("id", runRecordId);
    }
    return { saved: 0, skippedOld, newSeen: 0 };
  }

  // dedup 카운트
  const shortcodes = candidates.map((r) => r.shortcode);
  const { data: existing } = await sb
    .from("ig_posts")
    .select("shortcode")
    .in("shortcode", shortcodes);
  const seenSet = new Set(
    (existing || []).map((r: { shortcode: string }) => r.shortcode),
  );
  const newSeen = candidates.filter((r) => !seenSet.has(r.shortcode)).length;

  // 메트릭(조회수/좋아요) 갱신용 — 기존 row도 upsert로 덮어쓰기
  const rows = candidates.map((r) => ({
    shortcode: r.shortcode,
    username: r.username.toLowerCase(),
    url: r.url,
    posted_at: r.posted_at,
    post_type: r.post_type,
    view_count: r.view_count,
    like_count: r.like_count,
    comment_count: r.comment_count,
    caption: r.caption,
    thumbnail_url: r.thumbnail_url,
    media_urls: r.media_urls,
    hashtags: r.hashtags,
    mentions: r.mentions,
    last_metric_at: new Date().toISOString(),
  }));

  // 외래키 안전성 — 등록되지 않은 username이 섞여있으면 먼저 ig_profiles에 upsert
  const distinctUsernames = Array.from(new Set(rows.map((r) => r.username)));
  await sb
    .from("ig_profiles")
    .upsert(
      distinctUsernames.map((username) => ({ username })),
      { onConflict: "username", ignoreDuplicates: true },
    );

  const { error: upsertErr } = await sb
    .from("ig_posts")
    .upsert(rows, { onConflict: "shortcode" });
  if (upsertErr) throw new Error(`포스트 저장 실패: ${upsertErr.message}`);

  // last_checked_at 갱신
  if (distinctUsernames.length > 0) {
    await sb
      .from("ig_profiles")
      .update({ last_checked_at: new Date().toISOString() })
      .in("username", distinctUsernames);
  }

  if (runRecordId) {
    await sb
      .from("ig_check_runs")
      .update({
        fetched_post_count: posts.length,
        saved_post_count: rows.length,
        new_post_count: newSeen,
      })
      .eq("id", runRecordId);
  }

  return { saved: rows.length, skippedOld, newSeen };
}

// ────────────────────────────────────────────────────────────────────────
// 게시 시각이 24시간 지난 포스트 자동 삭제
//   - cron + 수동 트리거 끝에서 호출
//   - feeds GET에서도 lazy 호출 (대시보드는 항상 깨끗)
// ────────────────────────────────────────────────────────────────────────
export async function cleanupOldPosts(): Promise<{ deleted: number }> {
  const sb = getSupabaseServer();
  const cutoffIso = new Date(
    Date.now() - HOURS_WINDOW * 60 * 60 * 1000,
  ).toISOString();

  // posted_at < cutoff 인 row 삭제
  const { data, error } = await sb
    .from("ig_posts")
    .delete()
    .lt("posted_at", cutoffIso)
    .select("shortcode");

  if (error) {
    // 삭제 실패는 치명적이지 않음 — 다음 트리거에서 재시도
    console.error("[insta-tracker] cleanupOldPosts 실패:", error.message);
    return { deleted: 0 };
  }
  return { deleted: data?.length || 0 };
}
