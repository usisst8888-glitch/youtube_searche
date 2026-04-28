import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";

type CategoryRow = {
  id: string;
  name: string;
  display_order: number;
  created_at: string;
};

export async function GET() {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase 미설정" },
      { status: 500 },
    );
  }
  try {
    const supa = getSupabaseServer();
    const { data, error } = await supa
      .from("categories")
      .select("id, name, display_order, created_at")
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      categories: (data as CategoryRow[]) || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase 미설정" },
      { status: 500 },
    );
  }
  try {
    const body = await req.json();
    const name = (body.name || "").trim();
    const displayOrder =
      typeof body.displayOrder === "number" ? body.displayOrder : 50;
    if (!name) {
      return NextResponse.json(
        { error: "name이 필요합니다." },
        { status: 400 },
      );
    }
    if (name.length > 30) {
      return NextResponse.json(
        { error: "카테고리명은 30자 이내" },
        { status: 400 },
      );
    }
    const supa = getSupabaseServer();
    const { data, error } = await supa
      .from("categories")
      .insert({ name, display_order: displayOrder })
      .select("id, name, display_order, created_at")
      .single();
    if (error) {
      // unique violation
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "이미 존재하는 카테고리입니다." },
          { status: 409 },
        );
      }
      throw error;
    }
    return NextResponse.json({ category: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "저장 실패" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase 미설정" },
      { status: 500 },
    );
  }
  try {
    const body = await req.json();
    const id = (body.id || "").trim();
    if (!id)
      return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const updates: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      updates.name = body.name.trim();
    }
    if (typeof body.displayOrder === "number") {
      updates.display_order = body.displayOrder;
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "변경할 필드가 없습니다." },
        { status: 400 },
      );
    }
    const supa = getSupabaseServer();
    const { data, error } = await supa
      .from("categories")
      .update(updates)
      .eq("id", id)
      .select("id, name, display_order, created_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ category: data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "수정 실패" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Supabase 미설정" },
      { status: 500 },
    );
  }
  try {
    const body = await req.json();
    const id = (body.id || "").trim();
    if (!id)
      return NextResponse.json({ error: "id 필요" }, { status: 400 });
    const supa = getSupabaseServer();
    const { error } = await supa.from("categories").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "삭제 실패" },
      { status: 500 },
    );
  }
}
