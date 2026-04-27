import { NextRequest, NextResponse } from "next/server";
import { isValidCode } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { ok: false, error: "코드를 입력하세요." },
        { status: 400 },
      );
    }
    const trimmed = code.trim();
    if (!isValidCode(trimmed)) {
      return NextResponse.json(
        { ok: false, error: "유효하지 않은 코드입니다." },
        { status: 401 },
      );
    }
    return NextResponse.json({ ok: true, code: trimmed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
