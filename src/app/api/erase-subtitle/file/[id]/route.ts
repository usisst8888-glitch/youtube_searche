// 결과 영상 다운로드 — Supabase signed URL로 redirect
// ?dl=1 → 다운로드 강제, 없으면 inline (브라우저 재생)

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getOutputSignedUrl } from "@/lib/supabase-storage";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id 필요" }, { status: 400 });
  }

  const sb = getSupabaseServer();
  const { data: row, error } = await sb
    .from("subtitle_erase_jobs")
    .select(
      "output_storage_path, output_expires_at, original_filename, output_extension",
    )
    .eq("id", id)
    .single();

  if (error || !row?.output_storage_path) {
    return NextResponse.json(
      { error: "파일 정보를 찾을 수 없어요." },
      { status: 404 },
    );
  }

  // 만료 체크
  if (row.output_expires_at) {
    const expiresAt = new Date(row.output_expires_at as string);
    if (expiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        {
          error:
            "결과 영상이 만료됐어요 (24시간 후 자동 삭제). 영상을 다시 처리해주세요.",
        },
        { status: 410 },
      );
    }
  }

  // 다운로드 파일명 (원본_cleaned.mp4)
  const ext = (row.output_extension as string) || "mp4";
  const orig = (row.original_filename as string | null) || "video";
  const base = orig.replace(/\.[a-zA-Z0-9]+$/, "");
  const downloadName = `${base}_cleaned.${ext}`;

  const dl = req.nextUrl.searchParams.get("dl") === "1";

  try {
    const signedUrl = await getOutputSignedUrl(
      row.output_storage_path as string,
      { download: dl, filename: downloadName },
    );
    // 308 Permanent Redirect → 브라우저가 따라감
    return NextResponse.redirect(signedUrl, { status: 307 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "signed URL 발급 실패" },
      { status: 500 },
    );
  }
}
