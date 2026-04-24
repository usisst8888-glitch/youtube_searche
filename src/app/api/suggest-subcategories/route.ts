import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 60;
export const runtime = "nodejs";

const SUBCATEGORIES_SCHEMA = {
  type: "object",
  properties: {
    subcategories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          description: { type: "string" },
        },
        required: ["keyword", "description"],
      },
    },
  },
  required: ["subcategories"],
};

function buildPrompt(bigTopic: string): string {
  return `당신은 한국 유튜브 쇼츠 콘텐츠 기획자입니다.

대주제: "${bigTopic}"

이 대주제 아래에서 **유튜브 쇼츠로 콘텐츠화 가능한 소주제 키워드 12개**를 생성하세요.

## 규칙
- 실제 한국 유튜브에 검색 가능한 **구체적 키워드** (2~8자 권장)
- **쇼핑/제품 리뷰가 많은 영역 우선** (꿀템, 장비, 도구, 필수템 등)
- 다양한 각도로 분산 (장비, 초보자, 고급자, 브랜드, 상황별 등)
- 대주제를 그대로 반복 금지 — 반드시 한 단계 아래로 구체화

## 예시
"골프" → 골프 연습도구 / 골프채 / 골프 의류 / 골프 초보 / 골프공 / 실내골프 / 스크린골프 / 골프백 / 골프 레슨 / 골프화 / 골프장갑 / 골프 모자

"자취" → 자취 꿀템 / 자취방 인테리어 / 자취 요리 / 자취 세탁 / 자취 청소기 / 자취 침구 / 원룸 수납 / 1인 가구 주방 / 자취 간식 / 자취 책상 / 자취 소형가전 / 방음

"뷰티" → 스킨케어 / 메이크업 베이스 / 립 제품 / 섀도우 팔레트 / 뷰티 디바이스 / 헤어케어 / 바디 로션 / 향수 / 남자 스킨케어 / K뷰티 신상 / 저자극 화장품 / 뷰티 서브스크립션

## 출력
각 항목:
- keyword: 쇼츠 검색에 쓸 짧은 키워드
- description: 이 키워드가 포함하는 콘텐츠 범위 한 줄 설명

JSON 12개 반환.`;
}

export async function POST(req: NextRequest) {
  try {
    const { bigTopic } = await req.json();

    if (!bigTopic || typeof bigTopic !== "string") {
      return NextResponse.json(
        { error: "대주제를 입력하세요." },
        { status: 400 },
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const ai = getGeminiClient();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [
          { role: "user", parts: [{ text: buildPrompt(bigTopic) }] },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: SUBCATEGORIES_SCHEMA,
        },
      }),
    );

    const text = response.text;
    if (!text) {
      return NextResponse.json(
        { error: "응답이 비어있습니다." },
        { status: 500 },
      );
    }

    const parsed = JSON.parse(text);
    return NextResponse.json({
      bigTopic,
      subcategories: parsed.subcategories || [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
