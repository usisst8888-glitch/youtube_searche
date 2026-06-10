import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  normalizeProfileToUrl,
  extractUsernameFromUrl,
} from "@/lib/apify";

export const runtime = "nodejs";

// ── GET: 등록된 프로필 목록 ──────────────────────────────────────────────
export async function GET() {
  try {
    const sb = getSupabaseServer();
    const { data, error } = await sb
      .from("ig_profiles")
      .select("*")
      .order("added_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ profiles: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}

// ── POST: 프로필 일괄 등록 ──────────────────────────────────────────────
// body: { input: string }  — 줄바꿈/쉼표/공백으로 구분된 URL/handle 목록
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const input = typeof body?.input === "string" ? body.input : "";
    if (!input.trim()) {
      return NextResponse.json(
        { error: "input이 비어있어요." },
        { status: 400 },
      );
    }

    const tokens: string[] = input
      .split(/[\n,\s]+/)
      .map((t: string) => t.trim())
      .filter(Boolean);

    const parsed: string[] = tokens
      .map((t: string) => normalizeProfileToUrl(t))
      .filter((u: string | null): u is string => !!u);

    const usernames: string[] = Array.from(
      new Set(
        parsed
          .map((url: string) => extractUsernameFromUrl(url))
          .filter((u: string | null): u is string => !!u)
          .map((u: string) => u.toLowerCase()),
      ),
    );

    if (usernames.length === 0) {
      return NextResponse.json(
        { error: "유효한 프로필을 찾지 못했어요." },
        { status: 400 },
      );
    }

    const sb = getSupabaseServer();
    // upsert: 이미 있으면 active=true로 살림
    const rows = usernames.map((username) => ({
      username,
      active: true,
    }));
    const { data, error } = await sb
      .from("ig_profiles")
      .upsert(rows, { onConflict: "username", ignoreDuplicates: false })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      added: data?.length || 0,
      skipped: tokens.length - usernames.length,
      usernames,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}

// ── PATCH: 프로필 활성/비활성 토글 ───────────────────────────────────────
// body: { username: string, active: boolean }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = typeof body?.username === "string" ? body.username : "";
    const active = typeof body?.active === "boolean" ? body.active : null;
    if (!username || active === null) {
      return NextResponse.json(
        { error: "username과 active가 필요해요." },
        { status: 400 },
      );
    }
    const sb = getSupabaseServer();
    const { error } = await sb
      .from("ig_profiles")
      .update({ active })
      .eq("username", username.toLowerCase());
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}

// ── DELETE: 프로필 삭제 (관련 포스트 cascade) ──────────────────────────
// query: ?username=...
export async function DELETE(req: NextRequest) {
  try {
    const username = req.nextUrl.searchParams.get("username");
    if (!username) {
      return NextResponse.json(
        { error: "username 쿼리가 필요해요." },
        { status: 400 },
      );
    }
    const sb = getSupabaseServer();
    const { error } = await sb
      .from("ig_profiles")
      .delete()
      .eq("username", username.toLowerCase());
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
