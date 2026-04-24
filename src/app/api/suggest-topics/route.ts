import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import { searchShorts, getVideoStats, filterActualShorts } from "@/lib/youtube";

export const maxDuration = 60;
export const runtime = "nodejs";

const TOPICS_SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          format: { type: "string" },
          hook: { type: "string" },
        },
        required: ["title", "format", "hook"],
      },
    },
  },
  required: ["topics"],
};

function buildTopicPrompt(
  keyword: string,
  productName: string,
  titles: string[],
): string {
  return `당신은 한국 유튜브 쇼츠 바이럴 전문가입니다.

## 입력 1: 사용자가 찾고자 하는 키워드
"${keyword}"

## 입력 2: 이 키워드로 YouTube 검색 시 **조회수 높았던 쇼츠 제목 ${titles.length}개**

${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

## 입력 3: 사용자 상품
"${productName}"

## 과제
위 제목들을 **형식·훅·화두 패턴** 관점에서 분석하고, "${productName}"에 어울리는 **새로운 쇼츠 주제 10개**를 생성하세요.

## 규칙
1. 위 제목을 그대로 쓰지 말고, **패턴만 차용**하세요.
   - 예: "20대 vs 30대 자취방 꿀템" 패턴 → "자취 1년 vs 5년 필수템"
   - 예: "후회 없는 소비 TOP 5" 패턴 → "사자마자 만족한 물건 5가지"
2. 각 주제는 **15~30자** 한 줄, 클릭하고 싶게 만드는 훅이 있어야 함
3. 스토리텔링 쇼츠로 풀 수 있는 주제여야 함 (캐릭터·상황·감정 있을 것)
4. 상품 "${productName}"이 스토리 속 소품으로 **자연스럽게** 등장할 수 있어야 함
5. 포맷 다양성 — 리스트/비교/랭킹/썰/반전/회고 등을 섞어라

## 자주 쓰이는 바이럴 포맷 레퍼런스
- **비교형**: "A vs B", "1년차 vs 5년차", "엄마 집 vs 내 집"
- **랭킹형**: "TOP 5 ○○템", "실패 없는 ○○ 3가지"
- **역설형**: "사지 말라던 거 샀는데", "싸구려인 줄 알았던 게"
- **숫자훅**: "월 1만원으로 바뀐 것", "3일 만에 달라진 ○○"
- **경험담**: "○년차 자취인이 알려주는", "직접 써보고 말한다"
- **감정 후회/만족**: "최고의 소비", "돈값 제대로 한 ○○"
- **상황 설정**: "친구가 우리 집 와서 놀란 거", "엄마가 보고 갑자기 산 것"

## 출력 JSON
topics 배열 10개, 각 항목:
- title: 주제 한 줄 (15~30자)
- format: 어떤 포맷인지 (비교형/랭킹형/경험담 등)
- hook: 이 주제의 훅 포인트 (한 줄 설명)`;
}

export async function POST(req: NextRequest) {
  try {
    const { keyword, productName = "" } = await req.json();

    if (!keyword || typeof keyword !== "string") {
      return NextResponse.json(
        { error: "키워드를 입력하세요." },
        { status: 400 },
      );
    }

    const youtubeKey = process.env.YOUTUBE_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!youtubeKey || !geminiKey) {
      return NextResponse.json(
        { error: "YOUTUBE_API_KEY / GEMINI_API_KEY가 필요합니다." },
        { status: 500 },
      );
    }

    // 1. YouTube에서 해당 키워드로 쇼츠 검색 (조회수 순)
    let searched = await searchShorts(
      youtubeKey,
      keyword,
      30,
      "KR",
      "ko",
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    );

    if (searched.length === 0) {
      return NextResponse.json(
        { error: "해당 키워드로 검색 결과가 없습니다." },
        { status: 404 },
      );
    }

    const stats = await getVideoStats(
      youtubeKey,
      searched.map((s) => s.videoId),
    );
    searched = searched.filter((s) => stats[s.videoId]?.isShorts);
    searched = await filterActualShorts(searched);

    // 조회수 순 정렬 → 상위 20개 제목
    const titlesWithViews = searched
      .map((s) => ({
        title: stats[s.videoId].title,
        views: stats[s.videoId].views,
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 20);

    if (titlesWithViews.length === 0) {
      return NextResponse.json(
        { error: "실제 쇼츠가 없습니다." },
        { status: 404 },
      );
    }

    const titles = titlesWithViews.map((t) => t.title);

    // 2. Gemini에게 패턴 분석 + 주제 10개 생성 요청
    const ai = getGeminiClient();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [
          {
            role: "user",
            parts: [
              { text: buildTopicPrompt(keyword, productName, titles) },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: TOPICS_SCHEMA,
        },
      }),
    );

    const text = response.text;
    if (!text) {
      return NextResponse.json(
        { error: "Gemini 응답이 비어있습니다." },
        { status: 500 },
      );
    }

    const parsed = JSON.parse(text);

    return NextResponse.json({
      topics: parsed.topics,
      referenceTitles: titles,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
