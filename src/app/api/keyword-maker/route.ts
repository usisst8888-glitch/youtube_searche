import { NextRequest, NextResponse } from "next/server";
import { searchShorts, getVideoStats } from "@/lib/youtube";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 90;
export const runtime = "nodejs";

const SCHEMA = {
  type: "object",
  properties: {
    topTitleKeywords: { type: "array", items: { type: "string" } },
    relatedKeywords: { type: "array", items: { type: "string" } },
  },
  required: ["topTitleKeywords", "relatedKeywords"],
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const keyword: string = (body.keyword || "").trim();
    if (!keyword) {
      return NextResponse.json({ error: "keyword 필요" }, { status: 400 });
    }
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY 미설정" },
        { status: 500 },
      );
    }

    // 1) YouTube Shorts 검색 (50개, 최근 30일, 한국)
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const searched = await searchShorts(
      apiKey,
      keyword,
      50,
      "KR",
      "ko",
      since,
    );
    if (searched.length === 0) {
      return NextResponse.json({
        topTitleKeywords: [],
        topTags: [],
        relatedKeywords: [],
        searchedCount: 0,
      });
    }

    // 2) videos.list 로 title + tags 가져오기
    const stats = await getVideoStats(
      apiKey,
      searched.map((s) => s.videoId),
    );
    const all = Object.values(stats);
    const titles = all.map((s) => s.title).filter(Boolean);
    const tagsByVideo = all.map((s) => s.tags || []);

    // 3) 태그 빈도 집계
    const tagCount = new Map<string, number>();
    for (const list of tagsByVideo) {
      for (const t of list) {
        const key = t.trim();
        if (!key || key.length > 30) continue;
        tagCount.set(key, (tagCount.get(key) || 0) + 1);
      }
    }
    const topTags = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([tag, count]) => ({ tag, count }));

    // 4) Gemini로 제목 핵심 + 연관 키워드 추출
    const ai = getGeminiClient();
    const prompt = `당신은 YouTube SEO 전문가입니다. 한국 YouTube Shorts 검색 결과의 제목들을 분석하세요.

## 기준 키워드
"${keyword}"

## 분석할 제목들 (${titles.length}개)
${titles.slice(0, 80).map((t, i) => `${i + 1}. ${t}`).join("\n")}

## 추출할 두 가지

### topTitleKeywords (제목에서 가장 많이 등장하는 핵심 키워드 TOP 10)
- 제목들에서 빈번하게 등장하는 명사·고유명사·인물·브랜드·트렌드
- 빈도순/중요도순 10개
- 한국어 2~10자
- 너무 일반적인 단어(좋은, 멋진, 영상) ❌
- 기준 키워드와 100% 동일한 건 제외

### relatedKeywords (연관 검색 키워드 15~20개)
- 기준 키워드의 변형/하위/상위/유사 카테고리
- 사람들이 실제로 검색할 만한 자연스러운 단어
- 추상 단어(진실, 비밀, 사실) ❌, 일반 형용사 ❌

JSON 출력.`;

    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
        },
      }),
    );
    const data = JSON.parse(res.text || "{}");
    const topTitleKeywords: string[] = (data.topTitleKeywords || [])
      .filter(
        (k: unknown): k is string => typeof k === "string" && !!k.trim(),
      )
      .map((k: string) => k.trim())
      .slice(0, 10);
    const relatedKeywords: string[] = (data.relatedKeywords || [])
      .filter(
        (k: unknown): k is string => typeof k === "string" && !!k.trim(),
      )
      .map((k: string) => k.trim())
      .slice(0, 25);

    return NextResponse.json({
      keyword,
      topTitleKeywords,
      topTags,
      relatedKeywords,
      searchedCount: titles.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
