import { NextRequest, NextResponse } from "next/server";
import {
  getGeminiClient,
  FLASH_MODEL,
  withRetry,
  embedTexts,
} from "@/lib/gemini";
import { getSupabaseServer, hasSupabase } from "@/lib/supabase";
import { requireTeamUser } from "@/lib/auth";

export const maxDuration = 180;
export const runtime = "nodejs";

type Candidate = {
  productName: string;
  productCategory: string;
  angle: string;
  hook: string;
  fact: string;
  sources: string[];
};

const CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    angles: {
      type: "array",
      items: {
        type: "object",
        properties: {
          productName: { type: "string" },
          productCategory: { type: "string" },
          angle: { type: "string" },
          hook: { type: "string" },
          fact: { type: "string" },
          sources: { type: "array", items: { type: "string" } },
        },
        required: [
          "productName",
          "productCategory",
          "angle",
          "hook",
          "fact",
          "sources",
        ],
      },
    },
  },
  required: ["angles"],
};

function buildPrompt(
  category: string,
  count: number,
  recentExamples: { productName: string; angle: string }[],
): string {
  const categoryLine =
    category && category !== "전체"
      ? `카테고리: ${category}`
      : "카테고리: 자유롭게 (식품/뷰티/가전/생활/패션/IT/스포츠/반려 등 다양하게)";

  const excludeBlock =
    recentExamples.length > 0
      ? `\n## ⚠️ 이미 만든 썰 목록 (최근 ${recentExamples.length}개) — 이것들과 중복 금지\n${recentExamples
          .map(
            (e, i) => `${i + 1}. ${e.productName} × ${e.angle}`,
          )
          .join("\n")}\n`
      : "";

  return `당신은 **조회수 100만 쇼츠 크리에이터의 작가**입니다.
쇼츠는 "아는 줄 알았는데 몰랐던 진짜 썰"로 후킹됩니다.

## 과제
한국 사람들이 **"헐, 진짜?"** 반응할 만한 **실제 제품 관련 썰 ${count}개** 생성.

${categoryLine}
${excludeBlock}

## 썰의 조건

각 썰은 반드시:
1. **실존 제품**이 주인공 (브랜드+모델 또는 유명 상품명)
2. **실제 사실**일 것 (웹에서 검증 가능한 역사/디자인/일화)
3. 시청자가 **몰랐을 법한 반전·뒷이야기·디자인 비밀·창업자 썰·문화 차이·숫자 임팩트** 등
4. 쇼츠 훅으로 쓸 수 있는 **1줄 질문형·충격형** 훅 가능

## ⚠️ 피해야 할 것
- 일반 사물 (의자/책 같은)
- 서비스·장소 (카페·은행)
- 지어낸 썰·추측
- 중복 금지 (위 목록 참조)

## 다양한 썰 앵글 예시 (모방 금지, 방향만 참고)
- 이름 유래: "새우깡 원래 이름은?"
- 창업자 실패: "다이슨 5127번 실패"
- 실패작 반전: "포스트잇=실패 접착제"
- 디자인 비밀: "바나나우유 왜 항아리"
- 문화 차이: "허쉬=미국인도 맛없다?"
- 가격 심리: "스벅 톨·그란데·벤티 뜻"
- 크기 미스터리: "감자칩 봉지 3/4 공기"
- 광고 카피 반전: "침대는 가구가 아닙니다"
- 시대상: "포카리 왜 1987?"
- 우연의 발명: "초콜릿칩 쿠키의 탄생"

## 각 썰 필드

- productName: 정확한 브랜드+제품명 (쿠팡 검색 가능 수준)
- productCategory: 식품/뷰티/가전/생활/패션/IT/문구/주방/반려/기타 중 하나
- angle: 썰의 제목 (15~25자, 질문형 or 충격형)
- hook: 쇼츠 첫 줄로 쓸 한 줄 (20~30자)
- fact: 실제 사실 2~3줄 요약
- sources: 검증에 참고한 URL 1~3개 (구글 검색에서 확인한 것)

## 출력
JSON. angles 배열에 ${count}개.
**다양한 카테고리·다양한 각도** 섞어서 추천.`;
}

export async function POST(req: NextRequest) {
  try {
    const teamUser = await requireTeamUser(req);
    if (!teamUser) {
      return NextResponse.json(
        { error: "등록되지 않은 사용자입니다. 다시 로그인해주세요." },
        { status: 401 },
      );
    }
    const userId = teamUser.id;

    const {
      category = "전체",
      count = 20,
      similarityThreshold = 0.85,
    } = await req.json();

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }
    if (!hasSupabase()) {
      return NextResponse.json(
        {
          error:
            "Supabase가 설정되지 않았습니다. .env.local에 SUPABASE_URL / SUPABASE_SECRET_KEY를 추가하세요.",
        },
        { status: 500 },
      );
    }

    const requested = Math.min(50, Math.max(3, Number(count)));
    // 여유분 포함해서 더 많이 요청 → dedup 후 requested개 맞추기
    const askCount = Math.min(60, Math.round(requested * 1.6));

    const supa = getSupabaseServer();

    // 1) 본인 user_id의 최근 앵글만 가져와서 Gemini에 "제외 리스트"로 전달
    const { data: recent } = await supa
      .from("story_angles")
      .select("product_name, angle")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    const recentExamples = (recent || []).map((r) => ({
      productName: r.product_name as string,
      angle: r.angle as string,
    }));

    // 2) Gemini로 후보 생성 (Google Search grounding)
    const ai = getGeminiClient();
    const response = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(category, askCount, recentExamples) }],
          },
        ],
        config: {
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    // googleSearch 쓰면 structured output 불가 → 텍스트 파싱
    const rawText = response.text || "";
    let candidates: Candidate[] = [];
    try {
      // JSON 블록 추출
      const jsonMatch =
        rawText.match(/```json\s*([\s\S]*?)\s*```/i) ||
        rawText.match(/```\s*([\s\S]*?)\s*```/) ||
        rawText.match(/({[\s\S]*"angles"[\s\S]*})/);
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : rawText;
      const parsed = JSON.parse(jsonStr);
      candidates = parsed.angles || [];
    } catch {
      // fallback: 전체 텍스트에서 angles 키 검색
      return NextResponse.json(
        {
          error: "Gemini 응답 파싱 실패.",
          rawSnippet: rawText.slice(0, 500),
        },
        { status: 500 },
      );
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "Gemini가 후보를 생성하지 못했습니다." },
        { status: 500 },
      );
    }

    // 3) 각 후보 → "productName || angle" 문자열로 임베딩
    const textsForEmbed = candidates.map(
      (c) => `${c.productName} | ${c.angle} | ${c.fact}`,
    );
    const embeddings = await embedTexts(textsForEmbed);

    // 4) 각 후보의 임베딩으로 DB 유사도 검색 → 중복 제거
    const unique: (Candidate & { embedding: number[] })[] = [];
    const duplicates: { candidate: Candidate; matchedName: string }[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const emb = embeddings[i];
      if (!emb || emb.length === 0) continue;

      const { data: matches, error: rpcErr } = await supa.rpc(
        "match_story_angles",
        {
          query_embedding: emb,
          match_threshold: similarityThreshold,
          match_count: 1,
          user_id_filter: userId,
        },
      );
      if (rpcErr) {
        // RPC 없으면 일단 모든 후보 통과 (유저가 schema.sql 안 돌렸을 수 있음)
        unique.push({ ...c, embedding: emb });
        continue;
      }
      if (matches && matches.length > 0) {
        duplicates.push({ candidate: c, matchedName: matches[0].angle });
      } else {
        unique.push({ ...c, embedding: emb });
      }
      if (unique.length >= requested) break;
    }

    if (unique.length === 0) {
      return NextResponse.json(
        {
          error:
            "생성된 후보 전부가 기존 라이브러리와 중복됩니다. 카테고리를 바꾸거나 similarityThreshold를 올려보세요.",
          duplicates: duplicates.slice(0, 10),
        },
        { status: 200 },
      );
    }

    // 5) DB에 insert (user_id로 분리)
    const rowsToInsert = unique.map((u) => ({
      product_name: u.productName,
      product_category: u.productCategory || category,
      angle: u.angle,
      hook: u.hook,
      fact: u.fact,
      sources: u.sources || [],
      embedding: u.embedding,
      status: "idea" as const,
      user_id: userId,
    }));

    const { data: inserted, error: insErr } = await supa
      .from("story_angles")
      .insert(rowsToInsert)
      .select(
        "id, product_name, product_category, angle, hook, fact, sources, status, created_at",
      );

    if (insErr) {
      return NextResponse.json(
        { error: `DB insert 실패: ${insErr.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      generated: unique.length,
      requested,
      duplicatesSkipped: duplicates.length,
      items: inserted || [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
