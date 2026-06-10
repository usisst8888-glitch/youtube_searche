import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_FULL_MODEL, withRetry } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_HISTORY = 20; // 과거 메시지 최대 보관 (10 turn)
const MAX_QUESTION_CHARS = 4000;

type ChatMessage = { role: "user" | "assistant"; content: string };

type IdeaContext = {
  rank: number;
  title: string;
  hook: string;
  estimatedDurationSec?: number;
  sourceVideoIndex: number;
  sourceStartSec: number;
  difficulty: string;
  whyItHits: string;
};

type PerVideoContext = {
  index: number;
  title: string;
  channel: string;
  mainTopic?: string;
  brief?: string;
};

type CommonPatternsContext = {
  sharedThemes?: string[];
  hookFormula?: string;
  structureTemplate?: string;
  toneStyle?: string;
  pacing?: string;
};

type PlaybookContext = {
  overview?: string;
  commonPatterns?: CommonPatternsContext;
  ideaBank?: IdeaContext[];
  productionPlaybook?: { step: number; title: string; detail?: string }[];
  hookTemplates?: { template: string; example?: string }[];
  contentAngles?: string[];
  actionChecklist?: string[];
  warnings?: string[];
};

function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
}

function buildSystemContext(
  perVideo: PerVideoContext[],
  playbook: PlaybookContext,
): string {
  const videosBlock = perVideo
    .map(
      (v) =>
        `[${v.index + 1}] ${v.title} — ${v.channel}${
          v.mainTopic ? ` · 토픽: ${v.mainTopic}` : ""
        }${v.brief ? `\n    ${v.brief}` : ""}`,
    )
    .join("\n");

  const cp = playbook.commonPatterns || {};
  const commonBlock = [
    cp.sharedThemes?.length ? `- 공유 테마: ${cp.sharedThemes.join(", ")}` : "",
    cp.hookFormula ? `- 후크 공식: ${cp.hookFormula}` : "",
    cp.structureTemplate ? `- 구조: ${cp.structureTemplate}` : "",
    cp.toneStyle ? `- 톤: ${cp.toneStyle}` : "",
    cp.pacing ? `- 페이싱: ${cp.pacing}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const ideaBlock = (playbook.ideaBank || [])
    .map(
      (i) =>
        `#${i.rank} ${i.title} (${i.difficulty})\n  후크: "${i.hook}"\n  출처: 영상 [${i.sourceVideoIndex + 1}] @${fmtTime(i.sourceStartSec)}\n  떡상 이유: ${i.whyItHits}`,
    )
    .join("\n\n");

  const stepsBlock = (playbook.productionPlaybook || [])
    .map((s) => `${s.step}. ${s.title}${s.detail ? ` — ${s.detail}` : ""}`)
    .join("\n");

  const templatesBlock = (playbook.hookTemplates || [])
    .map(
      (h, i) =>
        `T${i + 1}: ${h.template}${h.example ? ` (예: "${h.example}")` : ""}`,
    )
    .join("\n");

  const anglesBlock = (playbook.contentAngles || [])
    .map((a) => `- ${a}`)
    .join("\n");

  const checklistBlock = (playbook.actionChecklist || [])
    .map((a) => `- ${a}`)
    .join("\n");

  const warningsBlock = (playbook.warnings || [])
    .map((w) => `- ${w}`)
    .join("\n");

  return `당신은 **쇼츠 제작 코치**예요. 사용자는 방금 아래 레퍼런스 영상들을 분석해서 쇼츠 플레이북을 만들었고, 이제 후속 질문을 합니다. **아래 컨텍스트만 사용**해서 구체적으로 답하세요. 분석에 없는 영상/사실을 지어내지 말 것.

## 분석한 레퍼런스 영상
${videosBlock || "(없음)"}

## 발견한 떡상 공식
${playbook.overview || "(없음)"}

## 공통 패턴
${commonBlock || "(없음)"}

## 쇼츠 아이디어 뱅크
${ideaBlock || "(없음)"}

## 제작 단계
${stepsBlock || "(없음)"}

## 후크 템플릿
${templatesBlock || "(없음)"}

## 콘텐츠 앵글
${anglesBlock || "(없음)"}

## 오늘 할 일
${checklistBlock || "(없음)"}

## 주의사항
${warningsBlock || "(없음)"}

## 답변 규칙
- 한국어 요체 (~예요/~죠/~네요). "~다/~습니다" 금지.
- 영상을 인용할 땐 \`[1]\`, \`[2]\` 처럼 번호로, 아이디어를 인용할 땐 \`#3\` 처럼 rank로.
- 새 쇼츠 기획을 요청받으면 **후크 1줄 → 4단계 비트 → 예상 길이 → 출처** 순서로 답해요.
- "이 영상에서 더 짤만한 모먼트 있어?" 같은 질문엔 위 아이디어 뱅크 + 추가 분석으로 답하되, **자막에 없는 디테일은 추측하지 말 것**.
- 답은 마크다운으로, 길이는 질문 난이도에 맞춰요. 단순 질문엔 짧게, 기획 요청엔 자세히.`;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const perVideo: PerVideoContext[] = Array.isArray(body?.perVideo)
      ? body.perVideo
      : [];
    const playbook: PlaybookContext =
      body?.playbook && typeof body.playbook === "object" ? body.playbook : {};
    const rawMessages: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
      : [];

    if (rawMessages.length === 0) {
      return NextResponse.json(
        { error: "messages가 비어있어요." },
        { status: 400 },
      );
    }
    if (rawMessages[rawMessages.length - 1].role !== "user") {
      return NextResponse.json(
        { error: "마지막 메시지는 사용자 질문이어야 해요." },
        { status: 400 },
      );
    }
    for (const m of rawMessages) {
      if (typeof m.content !== "string" || m.content.length === 0) {
        return NextResponse.json(
          { error: "빈 메시지가 있어요." },
          { status: 400 },
        );
      }
      if (m.content.length > MAX_QUESTION_CHARS) {
        return NextResponse.json(
          { error: `메시지가 너무 길어요 (>${MAX_QUESTION_CHARS}자).` },
          { status: 400 },
        );
      }
    }

    // 최근 MAX_HISTORY개만 유지
    const messages = rawMessages.slice(-MAX_HISTORY);

    const systemContext = buildSystemContext(perVideo, playbook);

    // Gemini contents: system context는 첫 user 턴 앞에 붙임
    // (Gemini는 systemInstruction을 따로 받기도 하지만, 여기선 첫 user message에 합쳐서 보내는 게 호환성 좋음)
    const contents = messages.map((m, i) => ({
      role: m.role === "user" ? ("user" as const) : ("model" as const),
      parts: [
        {
          text:
            i === 0 && m.role === "user"
              ? `${systemContext}\n\n## 사용자 질문\n${m.content}`
              : m.content,
        },
      ],
    }));

    const ai = getGeminiClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_FULL_MODEL,
        contents,
      }),
    );

    const answer = res.text?.trim();
    if (!answer) {
      return NextResponse.json(
        { error: "응답이 비어있어요. 다시 시도해 주세요." },
        { status: 500 },
      );
    }

    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
