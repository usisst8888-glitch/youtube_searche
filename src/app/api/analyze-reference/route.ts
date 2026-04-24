import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  extractVideoId,
  tryFetchTranscript,
} from "@/lib/youtube-transcript";

export const maxDuration = 120;
export const runtime = "nodejs";

type ImageInline = { mimeType: string; data: string };

function dataUrlToInline(dataUrl: string): ImageInline | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    originalScript: { type: "string" },
    styleSummary: { type: "string" },
    toneTags: { type: "array", items: { type: "string" } },
    hookPattern: { type: "string" },
    structureNotes: { type: "string" },
    newScenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
          emotion: { type: "string" },
          durationSec: { type: "number" },
        },
        required: ["index", "text", "emotion", "durationSec"],
      },
    },
  },
  required: [
    "originalScript",
    "styleSummary",
    "toneTags",
    "hookPattern",
    "structureNotes",
    "newScenes",
  ],
};

function buildResearchPrompt(productName: string): string {
  return `당신은 한국 시장 제품 리서처입니다.

아래 상품에 대해 **웹 검색**을 활용해 깊이 조사하고 마크다운으로 정리하세요.

상품명: ${productName}

조사 항목:
1. 제품 개요 & 카테고리
2. 타겟 고객층 + 그들이 느끼는 **구체적 페인 포인트** 3~5개
3. 핵심 셀링 포인트(USP) 3~5개
4. 한국 소비자 맥락 (현재 트렌드, 관련 밈/문화, 경쟁 제품과의 차별점)
5. **스토리텔링용 후크 아이디어 5개** — "이 제품이 해결하는 구체적 생활 장면"

결과는 실제 스토리 대본을 짜는 작가가 읽고 바로 영감 받을 수 있도록 **구체적이고 감각적으로** 작성하세요.`;
}

function buildScriptPrompt(
  transcript: string | null,
  research: string,
  productName: string,
): string {
  return `당신은 **한국 감성 쇼트 스토리 작가**입니다.
광고 카피라이터가 아니라, 짧은 드라마/브이로그/썰을 쓰는 작가에 가깝습니다.
당신의 작품은 **"영화 같다", "드라마 같다", "실화 같다"** 는 댓글을 받습니다.

## 🚨 가장 중요한 원칙 — 이것부터 머리에 박고 시작

**이건 광고가 아닙니다. 이건 스토리입니다.**

- "제품 소개" 형식 **절대 금지** — "이 제품이 좋아서", "편안해서", "클릭 소리 조용해서" 같은 문장은 전멸.
- 대본은 **독립된 단편 이야기**여야 하고, 제품이 등장하지 않아도 그 자체로 재미있거나 감정이 있어야 합니다.
- 제품은 **소품**입니다 — 주인공 책상 위에 놓여 있거나, 손에 쥐여져 있거나, 배경에 있을 뿐. 주제가 아님.
- 제품 특징/장점/USP를 대본에 **한 글자도** 쓰지 마세요. 그건 이미지로만 보여줄 겁니다.
- "${productName}" 상품명은 **대본 전체에서 최대 1번**, 그것도 자연스러운 맥락에서만. 0번도 OK.

## 😤 절대 쓰지 말아야 할 표현 (이거 쓰면 탈락)

❌ "이거 진짜 좋아요"
❌ "편안해서 놀랐어요"
❌ "후회 안 할 거예요"
❌ "여러분도 한번..."
❌ "~해서 ~하네요" (기능 설명체)
❌ "진짜 달라요", "완전 달라요"
❌ "이제 ~없이는 못 살아요"
❌ 제품 이름 + 장점 나열 (예: "유그린 버티컬 마우스, 클릭 소리 조용하고 손목 편안해")
❌ 페인포인트 → 해결책 → 만족 구조 (광고의 전형)

## ✅ 지향해야 할 형식

**썰 / 일상툰 / 단편 드라마 / 혼잣말 내레이션** 스타일.

예시 방향 (절대 그대로 쓰지 말고 참고만):

예시 1) 분위기: 감성 일상
"씬 1: 화요일 밤 11시. 회사 일 한참 남았다.
 씬 2: 창밖 비 소리. 커피는 이미 식었다.
 씬 3: 책상 위 작은 것 하나가 눈에 들어온다. (제품 자연 노출)
 씬 4: 손을 올리니까 왜인지 숨이 조금 풀렸다.
 씬 5: 비는 계속 오는데, 오늘 밤은 길지 않을 것 같다."

예시 2) 분위기: 관계/공감
"씬 1: 친구가 내 방에 왔다.
 씬 2: '너 요즘 왜 이래?' 묻는다.
 씬 3: 대답 대신 책상 위를 가리켰다. (제품 노출)
 씬 4: 친구가 웃었다. '나도 이거 때문에 그래.'
 씬 5: 밤새 말없이 같이 앉아 있었다."

예시 3) 분위기: 혼잣말 내레이션
"씬 1: 서른 살 생일. 아무도 몰랐다.
 씬 2: 나 자신한테 선물했다. 딱 하나.
 씬 3: 택배 상자 열었을 때 마음이 좀 이상했다. (제품 노출)
 씬 4: 첫 번째로 쓰던 날, 엄마한테 전화를 걸었다.
 씬 5: '엄마, 나 잘 지내.' 처음으로 진심이었다."

## 📝 창작 가이드

### 1. 스토리 아이디어 잡기
리서치에서 나온 타겟/페인포인트를 **감정적 상황**으로 번역:
- "손목 아픔" → "야근 마지막 남은 10분, 손이 떨려서 키보드 못 친다"
- "늦게 자는 습관" → "새벽 2시. 아직 끝나지 않은 것 같은 기분"
- "출근길 피로" → "지하철에서 조는 나를 깨우는 핸드폰 진동"

### 2. 5씬 플로팅 (광고 아님)
| 씬 | 스토리적 역할 (광고 역할 X) |
|----|--------------------------|
| 1 | **훅 — 상황 오픈**. 장면·시간·감정을 한 방에 세팅 |
| 2 | **전개** — 상황이 깊어짐 (대사 또는 묘사) |
| 3 | **모먼트** — 제품이 등장하는 씬 (주제가 아니라 **프레임 속 오브젝트**) |
| 4 | **변화** — 감정이 움직이는 순간 (제품 언급 불필요) |
| 5 | **여운** — 한 줄로 끝내는 엔딩. CTA 금지. 생각을 남겨라. |

### 3. 훅 (씬 1)
다음 방식으로 시작 (광고성 훅 금지):
- 시간/장소 스냅샷: "새벽 3시, 혼자 있는 방."
- 돌발 상황: "문이 열렸다. 엄마였다."
- 혼잣말 시작: "그날은 아무도 모르게 울었다."
- 감각 묘사: "창문에 빗방울이 맺히기 시작했다."
- 의문/불안: "왜 그날이 기억나는지 모르겠다."
- **질문형 훅은 사용 OK** 단, 광고성 아니어야 함: "당신도 그런 밤이 있나요?"

### 4. 문장 작법
- 한 씬당 1~2문장, **감성적이고 여운 있게**
- 대사 사용 OK (따옴표로 감싸서)
- 감각어·장면 묘사 적극 (시간, 날씨, 공간, 온도)
- 설명형·정보전달형 ❌ / 장면 그려지는 문장 ✅
- 참고 영상의 말투/리듬은 참고하되, **광고성이 있으면 버려라**

## 📦 제품 노출 (매우 조심스럽게)
- 이미지에는 매 씬마다 제품이 보입니다 (그건 이미 처리됨)
- **대본에서 제품을 언급하는 건 씬 3에서 최대 1번만**.
  - "${productName}" 이름을 직접 부르기보다 "책상 위 그것", "이게", "이 작은 기계" 같은 대명사로 부드럽게.
  - 또는 아예 언급 안 해도 됨 (이미지가 보여주니까)
- "좋다/편하다/조용하다" 같은 **평가 어휘 사용 금지**
- 제품이 **해결사**로 그려지면 안 됨 (그럼 광고). 그냥 **그 사람 옆에 있는 사물**.

## 입력 1: 참고 영상 대본 (말투·리듬만 참고, 광고성은 버려라)
${
  transcript
    ? `자막:\n---\n${transcript}\n---`
    : "참고 영상 자막 없음 — 첨부된 YouTube 영상 음성을 들어 직접 전사한 뒤 말투 추출."
}

## 입력 2: 상품 리서치 (스토리 아이디어 소재로만, 그대로 쓰지 말 것)
---
${research}
---

## 과제 A (JSON 필드)
- originalScript = 참고 영상 자막/전사 원문
- styleSummary, toneTags(3~5개), hookPattern, structureNotes = 참고 영상 분석

## 과제 B (JSON 필드 newScenes)
- 정확히 **5씬** (index 0~4, durationSec 5)
- 각 scene.text = TTS가 그대로 읽을 감성적 한국어 완성문
- emotion = 장면의 감정 한국어 한 단어 (예: 쓸쓸함, 따뜻함, 의외, 여운, 서늘함)

## 최종 체크리스트 (대본 제출 전 본인이 확인)
- [ ] 제품 장점을 한 글자도 쓰지 않았다
- [ ] "좋다/편하다/후회안함" 어휘가 없다
- [ ] 제품 이름이 최대 1번, 혹은 0번 등장한다
- [ ] 스토리가 제품 없어도 성립한다
- [ ] 광고가 아니라 단편 드라마 같다
- [ ] 씬 5에 CTA나 구매 권유가 없다
- [ ] 여운이 남는다`;
}

export async function POST(req: NextRequest) {
  try {
    const { url, productName, productImageDataUrls = [] } = await req.json();

    if (!url) {
      return NextResponse.json(
        { error: "참고 영상 URL이 필요합니다." },
        { status: 400 },
      );
    }
    if (!productName || typeof productName !== "string") {
      return NextResponse.json(
        { error: "상품명을 입력하세요." },
        { status: 400 },
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json(
        { error: "유효한 YouTube URL이 아닙니다." },
        { status: 400 },
      );
    }

    const transcript = await tryFetchTranscript(videoId);
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const ai = getGeminiClient();

    // Step 1: 상품 웹 리서치 (Google Search grounding)
    const productImageParts: Part[] = (productImageDataUrls as string[])
      .map(dataUrlToInline)
      .filter((v): v is ImageInline => v !== null)
      .map((v) => ({ inlineData: v }));

    const researchContents: Content[] = [
      {
        role: "user",
        parts: [
          ...productImageParts,
          { text: buildResearchPrompt(productName) },
        ],
      },
    ];

    const researchResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: researchContents,
        config: {
          tools: [{ googleSearch: {} }],
        },
      }),
    );

    const research = researchResponse.text || "";
    if (!research) {
      return NextResponse.json(
        { error: "상품 리서치 응답이 비어있습니다." },
        { status: 500 },
      );
    }

    // Step 2: 대본 분석 + 생성 (structured output)
    const scriptParts: Part[] = [
      { text: buildScriptPrompt(transcript, research, productName) },
    ];
    if (!transcript) {
      scriptParts.unshift({
        fileData: { fileUri: canonicalUrl, mimeType: "video/*" },
      });
    }

    const scriptResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: scriptParts }],
        config: {
          responseMimeType: "application/json",
          responseSchema: ANALYSIS_SCHEMA,
        },
      }),
    );

    const text = scriptResponse.text;
    if (!text) {
      return NextResponse.json(
        { error: "대본 생성 응답이 비어있습니다." },
        { status: 500 },
      );
    }

    const parsed = JSON.parse(text);

    return NextResponse.json({
      analysis: {
        referenceUrl: canonicalUrl,
        originalScript: parsed.originalScript,
        styleSummary: parsed.styleSummary,
        toneTags: parsed.toneTags,
        hookPattern: parsed.hookPattern,
        structureNotes: parsed.structureNotes,
      },
      scenes: parsed.newScenes,
      productResearch: research,
      transcriptSource: transcript ? "captions" : "gemini-audio",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
