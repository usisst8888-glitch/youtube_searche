import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer, hasSupabase } from "@/lib/supabase";
import { requireTeamUser } from "@/lib/auth";

export const runtime = "nodejs";

async function requireCode(req: NextRequest): Promise<string | null> {
  return await requireTeamUser(req);
}

export async function GET(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase가 설정되지 않았습니다." },
      { status: 500 },
    );
  }
  const userCode = await requireCode(req);
  if (!userCode) {
    return NextResponse.json(
      { error: "팀원 접근 코드가 필요합니다." },
      { status: 401 },
    );
  }
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const search = searchParams.get("q");
    const limit = Math.min(200, Number(searchParams.get("limit") || "50"));
    const offset = Math.max(0, Number(searchParams.get("offset") || "0"));

    const supa = getSupabaseServer();
    let query = supa
      .from("story_angles")
      .select(
        "id, product_name, product_category, angle, hook, fact, sources, status, created_at",
        { count: "exact" },
      )
      .eq("user_code", userCode)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status && status !== "all") query = query.eq("status", status);
    if (category && category !== "전체")
      query = query.eq("product_category", category);
    if (search && search.trim()) {
      const like = `%${search.trim()}%`;
      query = query.or(
        `product_name.ilike.${like},angle.ilike.${like},fact.ilike.${like}`,
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    // 상태별 카운트 (탭 뱃지용) — user_code 기준
    const { data: stats } = await supa
      .from("story_angles")
      .select("status")
      .eq("user_code", userCode);
    const counts = {
      all: stats?.length || 0,
      idea: 0,
      producing: 0,
      done: 0,
      skipped: 0,
    };
    for (const s of stats || []) {
      const st = (s.status as keyof typeof counts) || "idea";
      if (st in counts) counts[st] += 1;
    }

    return NextResponse.json({ items: data || [], total: count || 0, counts });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase가 설정되지 않았습니다." },
      { status: 500 },
    );
  }
  const userCode = await requireCode(req);
  if (!userCode) {
    return NextResponse.json(
      { error: "팀원 접근 코드가 필요합니다." },
      { status: 401 },
    );
  }
  try {
    const { id, status } = await req.json();
    if (!id || !status) {
      return NextResponse.json(
        { error: "id와 status가 필요합니다." },
        { status: 400 },
      );
    }
    const valid = ["idea", "producing", "done", "skipped"];
    if (!valid.includes(status)) {
      return NextResponse.json(
        { error: `status는 ${valid.join("/")} 중 하나.` },
        { status: 400 },
      );
    }
    const supa = getSupabaseServer();
    const { error } = await supa
      .from("story_angles")
      .update({ status })
      .eq("id", id)
      .eq("user_code", userCode);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase가 설정되지 않았습니다." },
      { status: 500 },
    );
  }
  const userCode = await requireCode(req);
  if (!userCode) {
    return NextResponse.json(
      { error: "팀원 접근 코드가 필요합니다." },
      { status: 401 },
    );
  }
  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    }
    const supa = getSupabaseServer();
    const { error } = await supa
      .from("story_angles")
      .delete()
      .eq("id", id)
      .eq("user_code", userCode);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
