import { NextRequest, NextResponse } from "next/server";
import { lookupTeamUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { name } = await req.json();
    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { ok: false, error: "이름을 입력하세요." },
        { status: 400 },
      );
    }
    const user = await lookupTeamUser(name.trim());
    if (!user) {
      return NextResponse.json(
        { ok: false, error: "등록되지 않은 이름입니다. 관리자에게 문의하세요." },
        { status: 401 },
      );
    }
    return NextResponse.json({
      ok: true,
      name: user.name,
      displayName: user.displayName,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
