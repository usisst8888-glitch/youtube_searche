import { NextRequest, NextResponse } from "next/server";
import type { Content, Part } from "@google/genai";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";
import {
  SCRIPT_SCHEMA,
  AGGRO_TITLE_RULES,
  TONE_RULES,
  CURIOSITY_LOOP_RULES,
  koreanizeYoche,
} from "@/lib/shorts-prompt";

export const maxDuration = 120;
export const runtime = "nodejs";

type ImageInline = { mimeType: string; data: string };

function dataUrlToInline(dataUrl: string): ImageInline | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

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
  return `당신은 **쇼츠 retention 마스터**입니다.
영상 평균 시청 시간 80%+ 유지하는 것이 유일한 목표.
구독자/조회수보다 **시청 지속률 + CTR** 이 핵심.

이미 정해진 "썰"을 받아서 40초 쇼츠 대본 (4씬 × 10초)으로 각색합니다.
씬 4개를 **호기심 4단계 루프 구조**로 짜야 합니다.

## 🎯 반드시 사용할 썰 (이게 유일한 소재입니다)

제품: ${productName}
앵글 (제목): ${angle}
${hook ? `훅 (첫 줄로 쓸 수 있는 문장): ${hook}` : ""}
${fact ? `팩트 (실제 내용):\n${fact}` : ""}
${sources && sources.length > 0 ? `출처:\n${sources.map((u) => `- ${u}`).join("\n")}` : ""}

## 🚨 절대 규칙

1. **위 팩트만 사용**. 새로운 정보 만들어내지 말 것.
2. **훅이 주어졌으면 씬 1은 그 훅으로 시작**.
3. 정답/반전은 **씬 4 (반전)** 에서만 노출. 씬 1~3에서 미리 풀지 말 것.
4. **각 씬 80~120자** (TTS로 10초에 읽히는 자연 분량)
   - 짧은 호흡 + 감탄어 ("근데...", "그런데 사실은...", "어?") 적극 활용
5. **씬 1~3 끝에 cliffhanger** — 다음 씬 안 보면 못 배기게
6. **씬 4는 반전으로 종료** — CTA / 마무리 멘트 / "구독" / "댓글 남겨주세요" 절대 금지
7. emotion 필드는 그 씬의 단계 이름: \`배경\` / \`디테일\` / \`문제\` / \`반전\`
8. 구어체 내레이션. 마케팅 톤 ❌. 평가어 ("좋다/편하다") ❌.
9. 제품명은 **0~1번만** 언급.

${TONE_RULES}

${CURIOSITY_LOOP_RULES}

${AGGRO_TITLE_RULES}

## 출력 JSON

- **videoTitle**: 어그로 후크 제목
- storyPremise: 4단계 루프를 어떻게 풀지 2~3줄로 (요체)
- newScenes: **정확히 4씬** (index 0~3, durationSec 10, emotion = 단계 이름, text 80~120자, **모든 문장 요체**)
  - 씬 1~3 끝에 cliffhanger 필수
  - 씬 4는 반전으로 종료, 마무리 멘트 X
  - ~다 / ~습니다 절대 금지`;
}

function buildScriptPromptFreeform(
  topic: string,
  research: string,
  productName: string,
): string {
  return `당신은 **쇼츠 retention 마스터**. 평균 시청 80%+ 유지가 유일한 목표.

## 입력
제품: ${productName}
주제/테마: ${topic}

## 리서치 (아래 사실 범위 안에서만 씬 만들기)
${research}

## 절대 규칙
- 광고/마케팅 톤 ❌. CTA "구독하세요" / "댓글 남겨주세요" ❌. 평가어 ("좋다/편하다") ❌.
- **4씬 × 10초 = 40초**, 각 씬 **80~120자** (구어체 + 짧은 호흡).
- emotion 필드 = 씬의 단계 이름: \`배경\` / \`디테일\` / \`문제\` / \`반전\`
- 정답/반전은 **씬 4** 에서만. 씬 1~3 에서 미리 풀지 말 것.
- 씬 1~3 끝에 **cliffhanger** 필수. 씬 4는 반전으로 종료 (마무리 멘트 X).
- 제품명 0~1번만.
- ~다 / ~습니다 끝 절대 금지 — 모두 요체 (~요/~어요/~죠).

${TONE_RULES}

${CURIOSITY_LOOP_RULES}

${AGGRO_TITLE_RULES}

## 출력 JSON
- **videoTitle**: 어그로 후크 제목 (위 규칙대로 자극적이게)
- storyPremise (2~3줄, 요체)
- newScenes: **정확히 4씬** (index 0~3, durationSec 10, emotion = 단계 이름, 씬 1~3 끝 cliffhanger, 씬 4는 반전 종료, **모든 문장 요체**)`;
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

    const transformedScenes = (parsed.newScenes || []).map(
      (sc: { text?: string; [k: string]: unknown }) => ({
        ...sc,
        text: koreanizeYoche(sc.text || ""),
      }),
    );

    return NextResponse.json({
      videoTitle: parsed.videoTitle || "",
      storyPremise: koreanizeYoche(parsed.storyPremise || ""),
      scenes: transformedScenes,
      productResearch: research,
      usedAngle: !!angleData,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
