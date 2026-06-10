// 인스타 영상 Gemini 분석 API
//
// POST body: { shortcode?: string, url?: string, force?: boolean }
//   - shortcode가 있으면 ig_posts에서 video URL을 찾아 분석
//   - url만 있으면 shortcode 추출 → ig_posts에 있으면 그걸 쓰고, 없으면 Apify로 단건 fetch
//   - force=true면 기존 분석 무시하고 다시 실행
//
// GET ?shortcode=...  : 캐시된 분석 결과만 조회

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  analyzeInstaVideoFromBuffer,
  downloadInstaVideo,
  extractShortcodeFromUrl,
} from "@/lib/insta-analyzer";
import { runInstagramScraperSync, normalizePost } from "@/lib/apify";
import { uploadInstaVideo } from "@/lib/supabase-storage";

export const runtime = "nodejs";
export const maxDuration = 300;

type StoredAnalysis = {
  shortcode: string;
  source_url: string;
  video_url: string | null;
  video_storage_path: string | null;
  video_expires_at: string | null;
  title: string | null;
  transcript: string | null;
  video_summary: string | null;
  story_premise: string | null;
  script_scenes: unknown;
  product_keywords: unknown;
  model: string | null;
  analyzed_at: string;
  error: string | null;
};

// ── GET: 캐시 조회만 ────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const shortcode = req.nextUrl.searchParams.get("shortcode");
  if (!shortcode) {
    return NextResponse.json(
      { error: "shortcode가 필요합니다." },
      { status: 400 },
    );
  }
  const sb = getSupabaseServer();
  const { data, error } = await sb
    .from("ig_post_analyses")
    .select("*")
    .eq("shortcode", shortcode)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ analysis: null });
  return NextResponse.json({ analysis: data });
}

// ── POST: 실제 분석 실행 ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      shortcode?: string;
      url?: string;
      force?: boolean;
    };

    let shortcode = body.shortcode?.trim();
    const url = body.url?.trim();
    const force = body.force === true;

    if (!shortcode && url) {
      const sc = extractShortcodeFromUrl(url);
      if (!sc) {
        return NextResponse.json(
          { error: "URL에서 shortcode를 찾을 수 없습니다." },
          { status: 400 },
        );
      }
      shortcode = sc;
    }
    if (!shortcode) {
      return NextResponse.json(
        { error: "shortcode 또는 url이 필요합니다." },
        { status: 400 },
      );
    }

    const sb = getSupabaseServer();

    // 1) 캐시 확인
    if (!force) {
      const { data: cached } = await sb
        .from("ig_post_analyses")
        .select("*")
        .eq("shortcode", shortcode)
        .maybeSingle();
      if (cached && !cached.error) {
        return NextResponse.json({ analysis: cached, cached: true });
      }
    }

    // 2) ig_posts에서 비디오 URL/캡션 찾기
    let videoUrl: string | null = null;
    let caption = "";
    let sourceUrl = `https://www.instagram.com/p/${shortcode}/`;

    const { data: post } = await sb
      .from("ig_posts")
      .select("media_urls, caption, url, post_type")
      .eq("shortcode", shortcode)
      .maybeSingle();

    if (post) {
      sourceUrl = post.url || sourceUrl;
      caption = post.caption || "";
      const media = (post.media_urls || []) as { type: string; url: string }[];
      const v = media.find((m) => m.type === "video");
      videoUrl = v?.url || null;
    }

    // 3) DB에 없거나 video URL이 만료된 경우 — Apify로 단건 fetch
    if (!videoUrl) {
      const targetUrl = url || sourceUrl;
      const fetched = await runInstagramScraperSync(
        {
          directUrls: [targetUrl],
          resultsLimit: 1,
          resultsType: "details",
        },
        { timeoutSec: 120 },
      );
      const first = fetched[0];
      if (!first) {
        return NextResponse.json(
          { error: "Apify에서 영상을 가져오지 못했습니다." },
          { status: 502 },
        );
      }
      const n = normalizePost(first);
      if (!n) {
        return NextResponse.json(
          { error: "Apify 응답 파싱 실패." },
          { status: 502 },
        );
      }
      const v = n.media_urls.find((m) => m.type === "video");
      videoUrl = v?.url || null;
      caption = caption || n.caption || "";
      sourceUrl = n.url || sourceUrl;
    }

    if (!videoUrl) {
      return NextResponse.json(
        { error: "이 포스트에는 분석할 영상이 없어요 (사진 포스트?)." },
        { status: 422 },
      );
    }

    // 4) 영상 다운로드 (한 번만)
    const { buffer, mimeType } = await downloadInstaVideo(videoUrl);

    // 5) Supabase Storage에 24h 임시 저장 + Gemini 분석 병렬
    const [uploaded, result] = await Promise.all([
      uploadInstaVideo({ shortcode, buffer, contentType: mimeType }).catch(
        (e) => {
          // 업로드 실패는 분석 자체를 막진 않음 — 경고만 남김
          console.error("[insta-tracker] storage 업로드 실패:", e);
          return null;
        },
      ),
      analyzeInstaVideoFromBuffer(buffer, mimeType, caption),
    ]);

    // 6) DB 저장
    const row = {
      shortcode,
      source_url: sourceUrl,
      video_url: videoUrl,
      video_storage_path: uploaded?.path || null,
      video_expires_at: uploaded?.expiresAt.toISOString() || null,
      title: result.videoTitle,
      transcript: result.transcript,
      video_summary: result.videoSummary,
      story_premise: result.storyPremise,
      script_scenes: result.scenes,
      product_keywords: result.productKeywords,
      model: result.model,
      analyzed_at: new Date().toISOString(),
      error: null,
    };
    const { data: saved, error: upsertErr } = await sb
      .from("ig_post_analyses")
      .upsert(row, { onConflict: "shortcode" })
      .select()
      .single();
    if (upsertErr) {
      // 저장은 실패해도 분석 결과는 돌려준다
      return NextResponse.json({
        analysis: row as StoredAnalysis,
        cached: false,
        saveError: upsertErr.message,
      });
    }
    return NextResponse.json({
      analysis: saved as StoredAnalysis,
      cached: false,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "분석 실패";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
