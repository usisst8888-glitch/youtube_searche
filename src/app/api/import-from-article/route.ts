import { NextRequest, NextResponse } from "next/server";
import {
  getGeminiClient,
  FLASH_MODEL,
  withRetry,
  embedTexts,
} from "@/lib/gemini";
import { getSupabaseServer, hasSupabase } from "@/lib/supabase";
import { requireTeamUser } from "@/lib/auth";

export const maxDuration = 90;
export const runtime = "nodejs";

const ANGLE_SCHEMA = {
  type: "object",
  properties: {
    angle: { type: "string" },
    hook: { type: "string" },
    fact: { type: "string" },
    productName: { type: "string" },
    productCategory: { type: "string" },
    storyTopic: { type: "string" },
  },
  required: [
    "angle",
    "hook",
    "fact",
    "productName",
    "productCategory",
    "storyTopic",
  ],
};

const CATEGORY_OPTIONS = [
  "식품",
  "뷰티",
  "가전",
  "생활",
  "패션",
  "IT",
  "문구",
  "주방",
  "반려",
  "스포츠",
  "기타",
];

function normalizeCategoryName(raw: string): string {
  const lc = (raw || "").toLowerCase();
  if (/스포츠|운동|등산|캠핑|골프|자전거|헬스|낚시|스키|보드/.test(lc))
    return "스포츠";
  if (/식품|음료|과자|라면|간식|음식|디저트|아이스크림|차$|와인|커피/.test(lc))
    return "식품";
  if (/뷰티|화장|스킨|메이크업|향수|헤어|샴푸/.test(lc)) return "뷰티";
  if (/가전|tv|청소기|에어프라|공기청정/.test(lc)) return "가전";
  if (/주방|냄비|팬|그릇|컵|칼/.test(lc)) return "주방";
  if (/패션|의류|옷|가방|신발|액세서리|시계/.test(lc)) return "패션";
  if (/it|노트북|키보드|마우스|헤드셋|모니터|스마트폰|이어폰/.test(lc))
    return "IT";
  if (/문구|펜|노트|다이어리|사무|책/.test(lc)) return "문구";
  if (/반려|강아지|고양이|펫/.test(lc)) return "반려";
  if (/생활|청소|수납|욕실|침구/.test(lc)) return "생활";
  return "기타";
}

export async function POST(req: NextRequest) {
  try {
    if (!hasSupabase()) {
      return NextResponse.json(
        { error: "Supabase가 설정되지 않았습니다." },
        { status: 500 },
      );
    }
    const user = await requireTeamUser(req);
    if (!user) {
      return NextResponse.json(
        { error: "팀원 인증 실패." },
        { status: 401 },
      );
    }

    const body = await req.json();
    const articleText: string = (body.articleText || "").trim();
    const articleUrl: string = (body.articleUrl || "").trim();
    // 사용자가 카테고리를 수동 지정한 경우 — AI 추정 무시하고 그대로 사용
    const manualCategory: string = (body.manualCategory || "").trim();

    if (!articleText) {
      return NextResponse.json(
        { error: "기사 본문(articleText)이 필요합니다." },
        { status: 400 },
      );
    }
    if (articleText.length < 50) {
      return NextResponse.json(
        { error: "기사 본문이 너무 짧습니다. 최소 50자 이상 붙여넣으세요." },
        { status: 400 },
      );
    }

    const ai = getGeminiClient();
    const prompt = `당신은 한국 YouTube Shorts 어그로 카피라이터입니다.
사용자가 붙여넣은 기사 본문을 분석해서, 클릭률 높은 쇼츠용 썰을 1개 추출하세요.

## 기사 본문
"""
${articleText.slice(0, 10000)}
"""
${articleUrl ? `\n출처 URL: ${articleUrl}` : ""}

## 추출할 필드

### 1. angle (어그로 제목, 한 줄) — 🔥🔥🔥 만렙 어그로 필수

**핵심 공식**: \`[인물 이름] + [숫자/기간] + [본문에서 단어 1개 떼어내기] + [???/...]\`

본문에서 **자극적인 단어 1개**를 떼어다 인물 이름 옆에 갖다 붙여라.
사실 그대로 풀어쓰면 0점. 단어 강탈로 오해를 유도해야 한다.

**자극 단어 후보**: 이혼, 사기, 폭로, 이별, 결혼, 잠적, 결별, 사망, 입원, 절도, 추락, 손절, 잘렸다, 떠났다, 사라졌다, 끝났다, 사고, 논란, 의혹, 폭행

**비교 예시**:
| 평가 | 제목 |
|---|---|
| ❌ 정직함 | "충격, 진태현이 결국 이혼숙려캠프 하차... 무슨 일이?" |
| ✅ 만렙 | **"진태현 2년 5개월만에 이혼???"** |
| ✅ 만렙 | **"진태현 결국... 2년만에 이혼했다??"** |

**규칙**:
- 30~60자
- 끝에 \`???\` 또는 \`...\` 필수
- "이혼숙려캠프 하차" 같이 정직하게 풀어쓰는 것 ❌ — "이혼"만 떼서 갖다 박을 것 ✅
- 정중체/뉴스체/마케팅체 절대 금지

### 2. hook (1.5초 후크 멘트)
- 영상 첫 1.5초에 들리는 강한 인트로 한 마디
- "충격ㅋ", "결국", "사실은" 같은 어그로 관용구 활용
- 20~40자

### 3. fact (사실 요약)
- 기사의 핵심 내용을 정확하게 (어그로 X, 사실 그대로)
- 시청자가 영상 보고 "아 이런 일이구나" 알 수 있게
- 100~250자

### 4. productName (기사에 어울리는 상품)
- 기사 주제·맥락과 자연스럽게 연결되는 일반적인 상품명
- 너무 좁은 브랜드보다는 카테고리성 일반명 (예: "프리미엄 부부 침대 매트리스", "수면 와인", "스트레스 완화 차")
- 광고 연계 가능한 일상 소비재로
- 기사가 명백히 특정 제품 리뷰면 그 제품명 그대로

### 5. productCategory
다음 중 하나만: ${CATEGORY_OPTIONS.join(", ")}

### 6. storyTopic (스토리 주제, 1줄)
- 영상 전체 톤 잡는 주제 문구
- 20~50자

## 좋은 예 (이 톤 그대로)
기사: "[단독]진태현, 2년여 이끈 '이혼숙려캠프' 하차 ..."
→ {
  "angle": "진태현 2년 5개월만에 이혼???",
  "hook": "진태현이 결국 이혼했다고??",
  "fact": "방송인 진태현이 2년여간 메인 MC로 진행해온 '이혼숙려캠프'에서 하차한다. ...",
  "productName": "수면 유도 허브차",
  "productCategory": "식품",
  "storyTopic": "스타도 떠난 그 자리, 부부 갈등의 진짜 이유"
}

⚠️ angle은 짧고 강하게. "하차", "MC" 같은 정직한 단어 절대 X. "이혼" 단어만 박을 것.

JSON 출력.`;

    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: ANGLE_SCHEMA,
        },
      }),
    );

    let parsed: {
      angle?: string;
      hook?: string;
      fact?: string;
      productName?: string;
      productCategory?: string;
      storyTopic?: string;
    };
    try {
      parsed = JSON.parse(response.text || "{}");
    } catch {
      return NextResponse.json(
        { error: "Gemini 응답 파싱 실패" },
        { status: 500 },
      );
    }
    const angle = (parsed.angle || "").trim();
    const hook = (parsed.hook || "").trim();
    const fact = (parsed.fact || "").trim();
    const productName = (parsed.productName || "").trim();
    // manualCategory가 있으면 그걸 그대로, 없으면 AI 추정값을 정규화
    const productCategory = manualCategory
      ? manualCategory
      : normalizeCategoryName(parsed.productCategory || "");
    const storyTopic = (parsed.storyTopic || "").trim();

    if (!angle || !productName) {
      return NextResponse.json(
        { error: "필수 필드(angle/productName) 추출 실패" },
        { status: 500 },
      );
    }

    // 임베딩 (향후 중복 검색용 — 저장만, 차단 X)
    let embedding: number[] | null = null;
    try {
      const [emb] = await embedTexts([
        `${productName} | ${angle} | ${fact}`,
      ]);
      if (emb && emb.length > 0) embedding = emb;
    } catch {
      // 임베딩 실패해도 저장은 진행
    }

    const supa = getSupabaseServer();
    const sources = articleUrl ? [articleUrl] : [];

    const insertRow: Record<string, unknown> = {
      product_name: productName,
      product_category: productCategory,
      angle,
      hook,
      fact,
      sources,
      status: "idea",
      user_id: user.id,
    };
    if (embedding) insertRow.embedding = embedding;

    const { data: inserted, error: insErr } = await supa
      .from("story_angles")
      .insert(insertRow)
      .select(
        "id, product_name, product_category, angle, hook, fact, sources, status, created_at",
      )
      .single();

    if (insErr) {
      return NextResponse.json(
        { error: `DB 저장 실패: ${insErr.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      angle: inserted,
      storyTopic,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
