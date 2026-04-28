import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 120;
export const runtime = "nodejs";

type ImageInline = { mimeType: string; data: string };

function dataUrlToInline(dataUrl: string): ImageInline | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

const SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    videoTitle: { type: "string" },
    storyPremise: { type: "string" },
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
  required: ["videoTitle", "storyPremise", "newScenes"],
};

const AGGRO_TITLE_RULES = `## 🔥🔥🔥 영상 제목 (videoTitle) — 한국 YouTube Shorts 어그로 만렙 (반드시 준수)

당신의 임무: 시청자가 클릭 안 하면 못 배기는 **단어 강탈식 미끼 제목**을 짜는 것.
사실 그대로 정직하게 쓰면 **0점**. 무조건 오해를 유도해야 한다.

## 🎯 핵심 공식 (이것만 따라하면 됨)

\`\`\`
[인물 이름] + [숫자/기간] + [충격 단어 1개 떼어내기] + [???/...]
\`\`\`

본문에서 **가장 자극적인 단어 한 개**를 떼어다 인물 이름 옆에 갖다 붙여라.
그 단어가 다른 의미로 읽히게 문맥을 비워라. 끝에 ??? 또는 ... 를 붙여 "추측"으로 위장.

## 🔥 작성 절차 (4단계)

1. **자극 단어 추출**: 본문에서 한 단어만 강탈. 후보:
   이혼, 사기, 폭로, 이별, 결혼, 잠적, 결별, 충격, 사망, 입원, 절도, 추락, 폭발, 손절, 잘렸다, 떠났다, 사라졌다, 끝났다, 사고, 논란, 의혹, 폭행
2. **사실 문맥 제거**: "MC 하차" 같은 정확한 묘사 ❌ — 그냥 "이혼", "잠적" 만 박을 것
3. **숫자 박기**: "2년 5개월", "13년", "300만" — 신뢰감 + 클릭률
4. **오해 봉인**: 끝에 \`???\` 또는 \`...\` 로 마무리 (문법상 의문/추측 → 거짓 X)

## 🔥🔥 비교 예시 (이거 절대 까먹지 마)

### 예시 1
**기사 사실**: 진태현, 이혼숙려캠프 MC에서 2년 5개월 만에 하차

| 평가 | 제목 |
|---|---|
| ❌ **0점 (착함)** | 충격, 진태현이 결국 이혼숙려캠프 하차... 무슨 일이? |
| ❌ **20점 (정직함)** | 진태현 단독 하차! 2년 5개월 만에 결단 |
| ✅ **100점 (만렙)** | **진태현 2년 5개월만에 이혼???** |
| ✅ **100점** | **진태현 결국... 2년만에 이혼했다??** |
| ✅ **100점** | **진태현이 결국 이혼...??? 와이프 충격** |

→ 차이점: "이혼숙려캠프"의 **"이혼"만 떼어내고 나머지 다 버린다**.
   "하차"라는 정직한 단어는 절대 쓰지 말 것.

### 예시 2
**기사 사실**: 이혁재가 와이프와 처음 만난 사연 공개, 3시간 무릎 꿇었다

| 평가 | 제목 |
|---|---|
| ❌ **0점** | 이혁재의 감동 러브스토리 |
| ❌ **30점** | 이혁재 와이프 첫만남 비하인드 |
| ✅ **100점** | **이혁재가 결국 와이프에게... 3시간 무릎** |
| ✅ **100점** | **이혁재 와이프 폭로 충격...** |

### 예시 3
**기사 사실**: 짜파게티 원래는 짜장면 컨셉이었다

| 평가 | 제목 |
|---|---|
| ❌ **0점** | 짜파게티의 흥미로운 역사 |
| ✅ **100점** | **짜파게티 정체 충격... 알면 못 먹는다** |
| ✅ **100점** | **한국인 99%가 모르는 짜파게티의 진실...** |

## ⛔ 금지 사항 (이거 위반하면 실패)

- ❌ "~의 진실", "~의 비밀" 만 쓰는 안전한 제목
- ❌ "~합니다" 정중체 / 설명형 / 뉴스체
- ❌ 사실관계를 정확히 풀어쓰는 톤 ("이혼숙려캠프 하차" 같이 그대로 쓰는 것)
- ❌ "충격, ~ 결국 ~ 무슨 일이?" 같은 안전한 의문 카피
- ❌ 30자 미만의 짧은 제목 (어그로 부족)
- ❌ 단어를 그냥 풀어쓰는 정직한 톤

## ✅ 필수 사항

- **반드시 한 단어를 떼어다 오해를 유도할 것**
- 끝에 \`???\` 또는 \`...\` 또는 둘 다
- 30~60자
- 인물/숫자/자극단어 3박자
- "?" 만으로 정직한 의문은 ❌, 떼어낸 단어로 오해 유도된 의문이 ✅

⚠️ **이 규칙 못 지키면 다시 짜라**. 정직한 제목은 클릭 0이다. 사실은 본문에서 풀고, 제목은 오해 폭탄으로 가야 한다.`;

function buildResearchPrompt(productName: string): string {
  return `당신은 한국 시장 제품 리서처입니다. 제품에 얽힌 **놀라운 뒷이야기·반전·역사 썰** 찾아주세요.

상품: ${productName}

## 조사 항목
1. 이름/디자인/형태의 숨겨진 유래
2. 창업자/개발자 에피소드 (특히 실패나 우연)
3. 시대적 맥락이나 당시 히트한 진짜 이유
4. 다른 나라·문화와의 차이
5. 가격/용량/크기 뒤의 심리나 전략

## 출력 형식
- 각 썰은 "헐 진짜?" 반응 나올 만한 것
- 가짜 추측 금지, 검증 가능한 실제 사실만
- 10줄 이내, 마크다운`;
}

function buildScriptPromptFromAngle(args: {
  productName: string;
  angle: string;
  hook: string | null;
  fact: string | null;
  sources: string[] | null;
}): string {
  const { productName, angle, hook, fact, sources } = args;
  return `당신은 **조회수 100만 쇼츠 작가**입니다.
이미 정해진 "썰"을 받아서 50초 쇼츠 대본 (5씬 × 10초)으로 각색하는 일만 합니다.

## 🎯 반드시 사용할 썰 (이게 유일한 소재입니다)

제품: ${productName}
앵글 (제목): ${angle}
${hook ? `훅 (첫 줄로 쓸 수 있는 문장): ${hook}` : ""}
${fact ? `팩트 (실제 내용):\n${fact}` : ""}
${sources && sources.length > 0 ? `출처:\n${sources.map((u) => `- ${u}`).join("\n")}` : ""}

## 🚨 규칙

1. **위 팩트만 사용**. 새로운 정보 만들어내지 말 것. 팩트 안에서 있는 재료로만 5씬 구성.
2. **훅이 주어졌으면 씬 1은 그 훅으로 시작**.
3. 앵글을 한 번에 다 말하지 말고 **반전 구조**로 풀기:
   - 씬 1: 질문·호기심·공감 (훅) + 분위기 조성
   - 씬 2: 상황 설정 / 익숙한 전제 / 배경 정보
   - 씬 3: 반전 포인트 (팩트의 핵심) — 이 씬이 제일 길어도 OK
   - 씬 4: 부연 설명 / 숫자·디테일 / 충격 정보
   - 씬 5: 의미 부여 / 여운 있는 마무리
4. **각 씬 80~120자** (TTS로 10초에 읽히는 자연 분량)
   - 너무 빽빽하게 채우지 말고, 2~3문장으로 자연스럽게 호흡
   - 짧은 대사나 감탄어("근데...", "그런데 사실은...") 사이사이 넣으면 좋음
5. 구어체 내레이션/혼잣말. 과도한 마케팅 톤 금지.
6. 제품명은 **0~1번만** 언급.
7. "좋다/편하다/후회 안 해요" 같은 평가어 금지. CTA 금지.

${AGGRO_TITLE_RULES}

## 출력 JSON

- **videoTitle**: 어그로 후크 제목 (위 규칙대로 자극적이게)
- storyPremise: 이 쇼츠의 시청자 경험을 2~3줄로 (팩트를 어떻게 풀지)
- newScenes: **정확히 5씬** (index 0~4, **durationSec 10**, emotion 1단어, text 80~120자)`;
}

function buildScriptPromptFreeform(
  topic: string,
  research: string,
  productName: string,
): string {
  return `당신은 **한국 감성 쇼트 스토리 작가**입니다.

## 입력

제품: ${productName}
주제/테마: ${topic}

## 리서치 (아래 사실 범위 안에서만 씬 만들기)
${research}

## 규칙
- 광고 금지. 숨겨진 뒷이야기·반전·호기심 자극.
- **5씬 × 10초 = 50초 쇼츠**. 각 씬 **80~120자** (2~3문장).
- 씬 1은 강한 훅 + 상황 조성. 씬 3은 반전 핵심. 씬 5는 여운.
- 제품명 0~1번만. "좋다/편하다" 평가어 금지. CTA 금지.

${AGGRO_TITLE_RULES}

## 출력 JSON
- **videoTitle**: 어그로 후크 제목 (위 규칙대로 자극적이게)
- storyPremise (2~3줄)
- newScenes: 정확히 5씬 (index 0~4, **durationSec 10**)`;
}

export async function POST(req: NextRequest) {
  try {
    const {
      storyTopic = "",
      productName,
      productImageDataUrls = [],
      angleData = null,
    } = await req.json();

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

    const ai = getGeminiClient();

    let research = "";
    let scriptPrompt: string;

    if (
      angleData &&
      typeof angleData === "object" &&
      (angleData.angle || angleData.hook || angleData.fact)
    ) {
      // 라이브러리 썰이 있으면 웹 리서치 생략, 그 썰을 바로 각색
      research = angleData.fact || "";
      scriptPrompt = buildScriptPromptFromAngle({
        productName,
        angle: angleData.angle || storyTopic,
        hook: angleData.hook || null,
        fact: angleData.fact || null,
        sources: angleData.sources || null,
      });
    } else {
      // Fallback: 기존 방식 (웹 리서치 후 대본 생성)
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
          config: { tools: [{ googleSearch: {} }] },
        }),
      );

      research = researchResponse.text || "";
      if (!research) {
        return NextResponse.json(
          { error: "상품 리서치 응답이 비어있습니다." },
          { status: 500 },
        );
      }

      scriptPrompt = buildScriptPromptFreeform(
        storyTopic,
        research,
        productName,
      );
    }

    const scriptResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: scriptPrompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: SCRIPT_SCHEMA,
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
      videoTitle: parsed.videoTitle || "",
      storyPremise: parsed.storyPremise,
      scenes: parsed.newScenes,
      productResearch: research,
      usedAngle: !!angleData,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
