import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 60;
export const runtime = "nodejs";

const SCHEMA = {
  type: "object",
  properties: {
    relatedKeywords: { type: "array", items: { type: "string" } },
  },
  required: ["relatedKeywords"],
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const titles: string[] = Array.isArray(body.titles) ? body.titles : [];
    const tagsByVideo: string[][] = Array.isArray(body.tags)
      ? body.tags
      : [];
    const baseKeyword: string = (body.baseKeyword || "").trim();

    if (titles.length === 0) {
      return NextResponse.json(
        { error: "titles가 필요합니다." },
        { status: 400 },
      );
    }

    // 1) 태그 빈도수 집계 (영상 메타에 들어있는 태그)
    const tagCount = new Map<string, number>();
    for (const list of tagsByVideo) {
      for (const t of list || []) {
        const key = t.trim();
        if (!key || key.length > 30) continue;
        tagCount.set(key, (tagCount.get(key) || 0) + 1);
      }
    }
    const topTags = Array.from(tagCount.entries())
      .filter(([, c]) => c >= 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([t, c]) => ({ tag: t, count: c }));

    // 2) Gemini로 제목들에서 연관 키워드 추출
    const ai = getGeminiClient();
    const prompt = `당신은 YouTube SEO 전문가입니다.
아래 ${titles.length}개의 한국 YouTube Shorts 제목들을 분석해서, **이 주제로 떡상 영상 만들 때 추가로 검색해볼 만한 연관 키워드**를 뽑으세요.

## 기준 키워드
"${baseKeyword || "(없음)"}"

## 제목들 (${titles.length}개)
${titles.slice(0, 80).map((t, i) => `${i + 1}. ${t}`).join("\n")}

## 추출 규칙
- **15~25개의 한국어 연관 키워드** (각 2~10자)
- 기준 키워드("${baseKeyword}")의 변형/하위/상위/유사 카테고리
- 제목들에 자주 등장하는 명사·인물·브랜드·트렌드
- 사람들이 실제로 YouTube/네이버에서 검색할 만한 자연스러운 단어
- 추상 단어(진실, 비밀, 사실) ❌, 일반 형용사(좋은, 멋진) ❌
- 기준 키워드와 100% 동일한 건 제외
- 빈도순/관련성순 정렬

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
    const relatedKeywords: string[] = (data.relatedKeywords || [])
      .filter(
        (k: unknown): k is string => typeof k === "string" && !!k.trim(),
      )
      .map((k: string) => k.trim())
      .filter(
        (k: string, i: number, arr: string[]) => arr.indexOf(k) === i, // dedup
      )
      .slice(0, 30);

    return NextResponse.json({
      relatedKeywords,
      topTags,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
