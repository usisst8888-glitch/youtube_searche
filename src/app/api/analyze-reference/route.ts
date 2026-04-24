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
  required: ["storyPremise", "newScenes"],
};

function buildResearchPrompt(productName: string): string {
  return `당신은 한국 시장 제품 리서처입니다.

아래 상품에 대해 **웹 검색**으로 조사하고, 스토리 작가가 쓸 수 있도록 구조화하세요.

상품명: ${productName}

## 가장 중요한 조사: **실제 사용 맥락**
(이게 명확해야 스토리가 제품과 이어집니다)

1. **제품 카테고리** (한 줄): 이게 무엇을 하는 물건인지. 예: "무선청소기 - 바닥 먼지/머리카락 치움", "에르고 마우스 - 손목 부담 줄이는 입력장치", "수면 유도 기기 - 잠들기 어려운 사람용"

2. **핵심 타겟 — 한 사람을 구체화해서**:
   - 나이대, 직업/상황, 라이프스타일 한 줄
   - 예: "30대 초반 자취 직장인, 야근 많음, 집안일 시간 부족"

3. **이 사람의 하루 중 제품 사용 순간** (가장 중요!):
   - 몇 시쯤? 어디서? 직전에 무엇을 하다가? 어떤 기분일 때?
   - 예: "평일 밤 10시, 퇴근 후 집. 신발 벗고 바닥을 보자마자 한숨, 머리카락·먼지 쌓여 있음. 피곤한데 치워야 함."

4. **제품을 쥐거나 쓰는 감각·동작**:
   - 실제로 손이 어떻게 움직이고, 몸이 어떻게 쓰이는지
   - 예: "손잡이 쥐고 바닥을 왔다갔다 함", "책상에 올려놓고 손을 얹음", "잠들기 전 베개 옆에 놓고 버튼 누름"

5. **제품이 바꾸는 감정적 순간**:
   - 제품을 쓰고 나면 어떤 기분의 변화가 있는지 (만족 말고 더 구체적으로)
   - 예: "한숨→숨 쉴 수 있는 공간 되찾음", "어깨 뭉침→하루 마감의 리추얼", "뒤척임→ 몇 분 만에 잠듦"

6. **한국 생활 맥락**: 계절, 직장/학업 문화, 주거 형태 (원룸/자취/가족) 등

## ⚠️ 쓰지 말 것
- 스펙, 기능, 센서, 기술명
- 경쟁 제품 비교
- 장단점 평가

**특히 3, 4, 5번이 스토리 작가에게 가장 중요합니다 — 최대한 구체적으로 써주세요.**`;
}

function buildScriptPrompt(research: string, productName: string): string {
  return `당신은 **한국 감성 쇼트 스토리 작가**입니다.
광고 카피라이터가 아닙니다. 단편 드라마, 브이로그, 일상 썰을 쓰는 작가입니다.
당신의 목표는 "광고 같은데?" 라는 댓글이 절대 달리지 않게 하는 것입니다.

## 🚨 최우선 원칙

**이건 광고가 아닙니다. 이건 짧은 이야기입니다.**

- 제품 장점/특징/기능/스펙을 대본에 **한 글자도** 쓰지 마세요.
- 당신은 제품이 뭐 하는 물건인지조차 대본에서 설명하지 않습니다.
- 제품은 스토리 속 **소품**일 뿐 — 주인공 책상 위, 손, 혹은 배경에 있는 것.
- "${productName}"이라는 이름을 대본에 **언급하지 마세요**. (0~1회 이내)

## ⚖️ 두 번째로 중요한 원칙 — 제품 맥락 일치

**스토리가 제품과 완전 무관하면 실패입니다.**

- **주인공**은 이 제품의 **실제 타겟 사용자**여야 합니다 (리서치 2번 참고)
- **배경 상황**은 이 제품이 **실제로 쓰이는 그 순간**이어야 합니다 (리서치 3번 참고)
- **씬 3의 "제품과의 순간"**은 이 제품을 **실제로 쓰는 자연스러운 동작**이어야 합니다 (리서치 4번 참고)
- 제품 종류가 청소기면 → 청소하는 상황
- 제품 종류가 마우스면 → 책상에서 작업하는 상황
- 제품 종류가 이어폰이면 → 음악 듣거나 통화하는 상황
- 제품 종류가 수면 기기면 → 잠들기 전 침대

❌ 작가의 시적 허세로 "동그랗고 부드러운 무언가" 같은 추상적 묘사는 피하세요. 리서치의 **구체적 사용 장면**을 그대로 장면화하세요.

## ❌ 절대 금지어·표현

- "후속작", "신제품", "출시", "탑재", "지원"
- "이거 진짜 좋아요", "편안해요", "달라요", "완전 다른"
- "추천", "후회 안 해요", "여러분도"
- 기능/스펙 설명 ("~센서", "~모드", "~기술", "인풋", "클릭")
- 시장 평가 ("이 분야에서 최고", "경쟁사와 비교")
- CTA ("한번 써보세요", "사보세요", "링크...")
- 정보 전달형 종결 ("~됩니다", "~한다고 합니다")

## ✅ 지향 방식

**짧은 단편 드라마 / 혼잣말 내레이션 / 일상 썰 / 감성 브이로그**

### 예시 (그대로 쓰지 말고 분위기만 참고)

예시 1 — 감성 일상:
"화요일 밤 11시. 커피는 이미 식었다.
창밖엔 계속 비.
책상 위 작은 것 하나가 보인다.
손을 얹으니 왜인지 숨이 조금 풀렸다.
비는 아직인데, 오늘 밤은 길지 않을 것 같다."

예시 2 — 관계·공감:
"친구가 내 방에 왔다.
'너 요즘 왜 이래?' 물었다.
나는 대답 대신 책상 위를 가리켰다.
친구가 웃었다. '나도 그래.'
밤새 말없이 같이 앉아 있었다."

예시 3 — 혼잣말:
"서른 살 생일. 아무도 몰랐다.
나한테 딱 하나 선물했다.
포장을 여는 순간 마음이 이상해졌다.
처음 쓰던 날, 엄마한테 전화했다.
'엄마, 나 잘 지내.' 처음으로 진심이었다."

## 📝 창작 프로세스

### Step 1 — 스토리 프레미스 구상 (storyPremise 필드에 기록)
리서치 2, 3번을 **그대로** 주인공·배경으로 가져오세요. 임의로 바꾸지 마세요.

- **주인공**: 리서치 2번의 타겟 고객을 한 사람으로 구체화 (나이/직업/상황)
- **시간·공간**: 리서치 3번의 "제품 사용 순간"을 그대로 씬으로
- **중심 행동**: 리서치 4번의 "제품 쥐거나 쓰는 동작"이 씬 3에 반드시 포함
- **감정의 축**: 리서치 5번의 "제품 전/후 감정 변화"가 씬 4에 녹아있어야

예 (무선청소기일 때):
"야근 끝나고 밤 11시에 집에 돌아온 30대 자취 직장인. 현관 들어서자 보이는 바닥의 머리카락·먼지. 한숨 쉬다가, 구석의 청소기를 집어들어 쭉 밀고 다니는 순간에 하루가 비로소 마감되는 느낌."

### Step 2 — 5씬으로 풀어내기
| 씬 | 스토리 역할 |
|----|-----------|
| 1 | **오프닝** — 시간·공간·감정 한 방에 세팅하는 장면 (훅) |
| 2 | **전개** — 상황을 깊게 (대사 또는 묘사) |
| 3 | **모먼트** — 무언가가 주인공 눈에 들어온다. 작은 변화의 계기. (제품이 프레임 속에 있음) |
| 4 | **변화** — 주인공 안에서 뭔가가 움직인다 (감정, 행동, 생각) |
| 5 | **여운** — 한 줄 엔딩. 결론 아니라 여운. CTA 절대 금지. |

### Step 3 — 문장 작법
- 한 씬당 1~2문장, 평균 15~25자
- **장면 묘사** 또는 **혼잣말/짧은 대사**
- 감각어 적극: 시간(새벽 3시), 날씨(비, 눈, 눈부심), 공간(책상 위, 창밖), 온도(따뜻한, 차가운)
- 종결어미 다양화: 평서문, 명사형 종결 ("밤이었다"), 짧은 대사
- **설명 금지, 묘사 중심**

## 입력: 상품 리서치 (스토리 영감 소재, 기능 나열 아님)
---
${research}
---

## 출력 (JSON 스키마 준수)
- storyPremise: Step 1에서 정한 한 사람의 한 순간 (2~3문장)
- newScenes: 정확히 5씬 (index 0~4, durationSec 5)
  - text: TTS로 읽을 자연스러운 한국어 완성문 (혼잣말 또는 묘사)
  - emotion: 장면 감정 한국어 한 단어 (예: 쓸쓸함, 따뜻함, 고요, 의외, 여운, 서늘함, 설렘)

## 최종 체크 (제출 전 자가 검증)
- [ ] 제품 이름이 대본에 등장하지 않는다 (또는 자연스럽게 0~1번)
- [ ] 제품의 기능·장점·스펙을 한 글자도 쓰지 않았다
- [ ] "좋다/편하다/진짜/완전" 같은 평가어가 없다
- [ ] CTA가 없다
- [ ] **주인공이 이 제품의 실제 사용자로 말이 된다**
- [ ] **배경 상황이 이 제품이 실제 쓰이는 그 순간이다**
- [ ] **씬 3에서 주인공이 제품을 실제 사용하는 자연스러운 동작이 있다**
- [ ] 추상적·시적 묘사로 도망가지 않았다 (리서치의 구체적 장면을 썼다)
- [ ] 드라마/썰/브이로그 같은 분위기다
- [ ] 여운이 남는다`;
}

export async function POST(req: NextRequest) {
  try {
    const { productName, productImageDataUrls = [] } = await req.json();

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

    // Step 1: 상품 웹 리서치 (Google Search grounding, 스토리 영감 관점)
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

    // Step 2: 스토리 씬 생성 (구조화 출력)
    const scriptResponse = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: buildScriptPrompt(research, productName) }],
          },
        ],
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
      storyPremise: parsed.storyPremise,
      scenes: parsed.newScenes,
      productResearch: research,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
