import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { url, topic } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: "YouTube URL이 필요합니다." },
        { status: 400 },
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "서버에 GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요.",
        },
        { status: 500 },
      );
    }

    // TODO: 실제 로직 연결
    //   1. youtube-transcript로 자막 시도
    //   2. 실패 시 Gemini에 YouTube URL 직접 전달
    //   3. 대본 구조/스타일 JSON 분석
    //   4. 유저 topic 기반 새 대본 씬별 생성

    return NextResponse.json({
      analysis: {
        referenceUrl: url,
        originalScript: "(자막 추출 미구현)",
        styleSummary: "(Gemini 연결 대기)",
        toneTags: ["todo"],
        hookPattern: "(TODO)",
        structureNotes: "(TODO) Gemini 키 연결 후 실제 분석 결과 표시",
      },
      scenes: [],
      topic,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
