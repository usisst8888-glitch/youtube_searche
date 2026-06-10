// Gemini로 핫존별 쇼츠 제작 지시사항 생성.
// 영상 전반 맥락(description/tags/상위 댓글)을 함께 주입하고
// 한국 쇼츠 컨벤션을 프롬프트로 명시해 실전 디테일을 강화한다.

import { getGeminiClient, FLASH_FULL_MODEL, withRetry } from "@/lib/gemini";
import { formatTime } from "./normalizer";
import type { HotZone } from "./signal-merger";
import type { ReferenceMeta } from "./collector";

export type CaptionRow = { timeRange: string; text: string; style: string };
export type SoundFx = { atSec: number; effect: string; reason: string };
export type VisualFx = { atSec: number; effect: string; reason: string };
export type KeyEntity = { name: string; role: string };

export type ClipSelection = {
  themeCategory: string;
  fitsUnder60s: boolean;
  hookableInFirst3s: boolean;
  retentionDriver: string;
  targetAgeFit: "high" | "medium" | "low";
  targetAgeReason: string;
  pickVerdict: "강추" | "추천" | "보류" | "비추";
  pickReason: string;
};

export type PolicyRiskItem = { risk: "none" | "low" | "high"; note: string };

export type PolicyRisk = {
  children: PolicyRiskItem;
  weapons: PolicyRiskItem;
  violence: PolicyRiskItem;
  sexual: PolicyRiskItem;
  politicsReligion: PolicyRiskItem;
  profanity: PolicyRiskItem;
  overall: "safe" | "caution" | "block";
  overallNote: string;
};

export type ZoneAnalysis = {
  reactionType: string;
  whyItWorks: string;
  keyEntities: KeyEntity[];
  optimalCut: { startSec: number; endSec: number; reasoning: string };
  clipSelection: ClipSelection;
  policyRisk: PolicyRisk;
  thumbnailText: string;
  thumbnailVisual: string;
  titleCandidates: string[];
  capcutGuide: CapcutGuide;
  narrationPlan: NarrationPlan;
  productionGuide: {
    openingHook: string;
    captionStrategy: CaptionRow[];
    soundEffects: SoundFx[];
    visualEffects: VisualFx[];
    pacingNotes: string;
    bRoll: string;
    endingHook: string;
    koreanCulturalNotes: string;
  };
};

export type CapcutStep = { step: number; title: string; action: string; tip: string };
export type CapcutEffect = { atSec: number; where: string; name: string; how: string };
export type TextAnim = { atSec: number; text: string; enter: string; loop: string; exit: string };

export type CapcutGuide = {
  overview: string;
  steps: CapcutStep[];
  capcutEffects: CapcutEffect[];
  textAnimations: TextAnim[];
  speedRamp: string;
  keyframeAnimations: string;
  referenceMatching: string;
};

export type NarrationSegment = {
  /** 쇼츠 시작(optimalCut.startSec) 기준 상대 초 */
  insertAtSec: number;
  durationSec: number;
  role: string;
  script: string;
  captionLines: string[];
};

export type NarrationPlan = {
  /** 1~3개. 영상의 음성 공백에 맞춰 자연스럽게. 없으면 빈 배열. */
  segments: NarrationSegment[];
  captionStyle: string;
  voiceStyle: string;
  bgmDucking: string;
  rationale: string;
};

export type AnalysisContext = {
  videoTitle: string;
  videoDurationSec: number;
  uploader: string;
  videoDescription: string;
  videoTags: string[];
  videoCategories: string[];
  /** 영상 전체 인기 댓글 (타임스탬프 유무 무관, 좋아요 상위) — 영상 전반 분위기/등장인물 파악용 */
  globalTopComments: { text: string; likes: number }[];
  /** 사용자가 지정한 레퍼런스 쇼츠들 — 캡컷 가이드 생성 시 본받을 톤/효과 참고용 */
  references: ReferenceMeta[];
  /** 출력 영상에 적용할 배속 (1.0~1.5). 캡컷 speedRamp·자막 타이밍이 이 값을 반영. */
  playbackSpeed: number;
  /** 원본 영상에서 잘라낼 목표 컷 길이 범위 (초). 배속 적용 전 기준. */
  targetCutMinSec: number;
  targetCutMaxSec: number;
  /** 사용자가 직접 명시한 인물·키워드 hint. LLM이 무조건 진실로 따라야 함. */
  manualEntities: { name: string; role?: string }[];
  /** 사용자가 명시적으로 부정한 인물/키워드 (절대 등장 인물로 추론하지 말 것). */
  forbiddenEntities: string[];
  /** 사용자가 영상 중간에 TTS+자막으로 삽입하고 싶은 본인의 생각·코멘트. 빈 문자열이면 미사용. */
  narrationText: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reactionType: { type: "string" },
    whyItWorks: { type: "string" },
    keyEntities: {
      type: "array",
      description: "이 구간 또는 영상에 등장하는 핵심 인물·작품·사건·고유명사",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "예: 가수, 출연자, 사건명, 작품명" },
        },
        required: ["name", "role"],
      },
    },
    optimalCut: {
      type: "object",
      properties: {
        startSec: { type: "number" },
        endSec: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["startSec", "endSec", "reasoning"],
    },
    clipSelection: {
      type: "object",
      description: "이 핫존을 쇼츠 소재로 채택할지의 판정 (제작자 가이드 기준)",
      properties: {
        themeCategory: {
          type: "string",
          description: "추천 영상 주제 중 어디에 해당하는지: '웃긴 말실수' | '킹받는 상황' | '레전드 리액션' | '어이없는 상황극' | '예능 케미' | '텐션 차이' | '돌려까기 화법' | '극E/극I 상황' | '실제 웃음 터진 장면' | '기타(자유서술)'",
        },
        fitsUnder60s: { type: "boolean", description: "1분 내외(40~65초)로 추릴 수 있는가" },
        hookableInFirst3s: {
          type: "boolean",
          description: "쇼츠 첫 3초 안에 웃긴 포인트나 궁금증을 박을 만한 임팩트가 있는가",
        },
        retentionDriver: {
          type: "string",
          description: "'다음 장면이 궁금해서 끝까지 보게 만드는 요소'를 한 문장으로. 없으면 '없음'.",
        },
        targetAgeFit: { type: "string", description: "20~40대 적합도: high | medium | low" },
        targetAgeReason: { type: "string", description: "왜 그 적합도인지 한 줄" },
        pickVerdict: {
          type: "string",
          description: "최종 판정: '강추'(반드시 만들것) | '추천'(좋음) | '보류'(애매) | '비추'(쓰지마)",
        },
        pickReason: { type: "string", description: "그 판정의 핵심 근거 한두 문장" },
      },
      required: [
        "themeCategory",
        "fitsUnder60s",
        "hookableInFirst3s",
        "retentionDriver",
        "targetAgeFit",
        "targetAgeReason",
        "pickVerdict",
        "pickReason",
      ],
    },
    policyRisk: {
      type: "object",
      description: "제작 가이드 절대 금지 사항 자동 점검 결과",
      properties: {
        children: { type: "object", properties: { risk: { type: "string" }, note: { type: "string" } }, required: ["risk", "note"] },
        weapons: { type: "object", properties: { risk: { type: "string" }, note: { type: "string" } }, required: ["risk", "note"] },
        violence: { type: "object", properties: { risk: { type: "string" }, note: { type: "string" } }, required: ["risk", "note"] },
        sexual: { type: "object", properties: { risk: { type: "string" }, note: { type: "string" } }, required: ["risk", "note"] },
        politicsReligion: { type: "object", properties: { risk: { type: "string" }, note: { type: "string" } }, required: ["risk", "note"] },
        profanity: { type: "object", properties: { risk: { type: "string" }, note: { type: "string" } }, required: ["risk", "note"] },
        overall: { type: "string", description: "safe | caution | block" },
        overallNote: { type: "string" },
      },
      required: ["children", "weapons", "violence", "sexual", "politicsReligion", "profanity", "overall", "overallNote"],
    },
    thumbnailText: { type: "string" },
    thumbnailVisual: {
      type: "string",
      description: "썸네일 시각 구성 지시. 예: '보아 얼굴 클로즈업 + 좌측 상단 빨간 동그라미, 우측에 8자 후크'",
    },
    titleCandidates: {
      type: "array",
      items: { type: "string" },
      minItems: 3,
      maxItems: 3,
    },
    narrationPlan: {
      type: "object",
      description: "원본 영상의 음성 공백 구간에 끼워넣을 내레이션 묶음. 갯수는 영상이 결정 (0~3개). 영상이 거의 끊김 없이 가득 차 있으면 빈 배열도 OK.",
      properties: {
        segments: {
          type: "array",
          maxItems: 3,
          description: "각 음성 공백마다 박을 내레이션. 공백 길이를 절대 넘기지 말 것.",
          items: {
            type: "object",
            properties: {
              insertAtSec: {
                type: "number",
                description: "쇼츠 기준 상대 초 (optimalCut.startSec를 0초로 본 시점). 첫 3초·마지막 2초 침범 금지.",
              },
              durationSec: {
                type: "number",
                description: "내레이션 길이. 해당 음성 공백 길이보다 짧아야 함. 한국어 TTS 평균 3~4자/초.",
              },
              role: {
                type: "string",
                description: "이 내레이션의 역할. 예: '도입 정리', '반전 짚기', '병맛 메타', '상황 요약', '마무리'",
              },
              script: {
                type: "string",
                description: "TTS에 박을 한국어 텍스트. **AI 같은 평론체 절대 금지**. 한국 쇼츠 댓글·밈 톤. 길이는 durationSec × 4자 이내. 다큐 패러디 톤 좋음 (예: '바로 반박하는 기모형')",
              },
              captionLines: {
                type: "array",
                items: { type: "string" },
                description: "화면 자막 줄들. script를 8~16자 단위로 자름.",
              },
            },
            required: ["insertAtSec", "durationSec", "role", "script", "captionLines"],
          },
        },
        captionStyle: {
          type: "string",
          description: "자막 스타일 (모든 segment 공통). 예: '화면 상단 1/3, 흰 굵음+검정 stroke, In: Typewriter'",
        },
        voiceStyle: {
          type: "string",
          description: "캡컷 TTS 한국어 보이스. 예: 'Text > Read Text Aloud > Korean - Hanna (차분, 다큐 톤)' — 모든 segment 공통.",
        },
        bgmDucking: {
          type: "string",
          description: "각 segment마다 적용할 BGM 덕킹 가이드. 예: '각 내레이션 직전 0.3초 페이드로 원본 -12dB → 끝나면 0.3초 페이드인'",
        },
        rationale: { type: "string", description: "왜 이 시점들에 박는지 한 문장 (음성 공백을 활용한 흐름 설명)" },
      },
      required: ["segments", "captionStyle", "voiceStyle", "bgmDucking", "rationale"],
    },
    capcutGuide: {
      type: "object",
      description: "캡컷(CapCut)에서 이 쇼츠를 실제로 만드는 단계별 가이드. 레퍼런스 쇼츠 스타일을 본받아 작성.",
      properties: {
        overview: {
          type: "string",
          description: "전체 작업 흐름 요약 (2~3문장). 레퍼런스 쇼츠와 이 컷의 어떤 느낌을 살릴지.",
        },
        steps: {
          type: "array",
          minItems: 6,
          description: "캡컷 작업 단계 순서. 1.영상 임포트 → 컷 → 자막 → 효과 → 효과음 → 트랜지션 → 내보내기 흐름.",
          items: {
            type: "object",
            properties: {
              step: { type: "number" },
              title: { type: "string", description: "예: '1. 원본 영상 임포트 및 1차 컷'" },
              action: {
                type: "string",
                description: "캡컷 UI에서 정확히 어떤 메뉴/버튼을 어떻게 조작하는지. 예: '상단 Import → 영상 선택 → 타임라인에 드래그 → 시작점·끝점을 분할 버튼(Ctrl+B)으로 자르기'",
              },
              tip: { type: "string", description: "이 단계에서의 디테일 팁/주의사항" },
            },
            required: ["step", "title", "action", "tip"],
          },
        },
        capcutEffects: {
          type: "array",
          minItems: 3,
          description: "사용할 캡컷 효과 목록. where는 캡컷 메뉴 내 정확한 위치(Effects/Filters/Body Effects 등).",
          items: {
            type: "object",
            properties: {
              atSec: { type: "number", description: "쇼츠 시작 기준 적용 시점(초)" },
              where: {
                type: "string",
                description: "캡컷 메뉴 내 정확한 위치. 예: 'Effects > Video Effects > Glitch > RGB Split', 'Filters > Movie > Cinematic'",
              },
              name: { type: "string", description: "효과 이름" },
              how: { type: "string", description: "강도/길이/적용 방법" },
            },
            required: ["atSec", "where", "name", "how"],
          },
        },
        textAnimations: {
          type: "array",
          description: "(사용 안 함) 원본 영상에 박는 자막은 안 씀. 빈 배열 [] 권장. 자막은 narrationPlan의 captionLines만 사용.",
          items: {
            type: "object",
            properties: {
              atSec: { type: "number" },
              text: { type: "string" },
              enter: {
                type: "string",
                description: "캡컷 텍스트 In 애니메이션 이름. 예: 'Pop', 'Typewriter', 'Bounce In', 'Fade In', '없음'",
              },
              loop: { type: "string", description: "Loop 애니메이션. 예: 'Shake', 'Pulse', '없음'" },
              exit: { type: "string", description: "Out 애니메이션. 예: 'Pop Out', 'Fade Out', '없음'" },
            },
            required: ["atSec", "text", "enter", "loop", "exit"],
          },
        },
        speedRamp: {
          type: "string",
          description: "속도 변경 지시. 캡컷 Speed > Curve 또는 Normal 사용. 예: '0~3초 1.0x → 3.0~3.5초 0.5x 슬로우(임팩트 강조) → 3.5~끝 1.2x'",
        },
        keyframeAnimations: {
          type: "string",
          description: "캡컷 키프레임으로 만들 줌인/줌아웃/팬 애니메이션. 예: '5.0초에 위치/크기 키프레임 → 5.5초에 크기 1.3배로 키프레임 추가 → 자동 줌인'",
        },
        referenceMatching: {
          type: "string",
          description: "사용자가 준 레퍼런스 쇼츠의 어떤 부분/효과를 어떻게 본받았는지 명시. 레퍼런스 없으면 '레퍼런스 미지정'.",
        },
      },
      required: [
        "overview",
        "steps",
        "capcutEffects",
        "textAnimations",
        "speedRamp",
        "keyframeAnimations",
        "referenceMatching",
      ],
    },
    productionGuide: {
      type: "object",
      properties: {
        openingHook: { type: "string" },
        captionStrategy: {
          type: "array",
          description: "(사용 안 함) 원본 영상에 박는 자막은 안 씀. 빈 배열 [] 권장.",
          items: {
            type: "object",
            properties: {
              timeRange: { type: "string" },
              text: { type: "string" },
              style: { type: "string" },
            },
            required: ["timeRange", "text", "style"],
          },
        },
        soundEffects: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            properties: {
              atSec: { type: "number" },
              effect: { type: "string" },
              reason: { type: "string" },
            },
            required: ["atSec", "effect", "reason"],
          },
        },
        visualEffects: {
          type: "array",
          minItems: 3,
          items: {
            type: "object",
            properties: {
              atSec: { type: "number" },
              effect: { type: "string" },
              reason: { type: "string" },
            },
            required: ["atSec", "effect", "reason"],
          },
        },
        pacingNotes: { type: "string" },
        bRoll: { type: "string" },
        endingHook: { type: "string" },
        koreanCulturalNotes: {
          type: "string",
          description: "한국 시청자 정서에 맞춘 추가 디테일. 어떤 표현/밈/문화 코드를 살리거나 피해야 하는지",
        },
      },
      required: [
        "openingHook",
        "captionStrategy",
        "soundEffects",
        "visualEffects",
        "pacingNotes",
        "bRoll",
        "endingHook",
        "koreanCulturalNotes",
      ],
    },
  },
  required: [
    "reactionType",
    "whyItWorks",
    "keyEntities",
    "optimalCut",
    "clipSelection",
    "policyRisk",
    "thumbnailText",
    "thumbnailVisual",
    "titleCandidates",
    "capcutGuide",
    "narrationPlan",
    "productionGuide",
  ],
} as const;

const FLOW_GUIDE = `
[쇼츠 흐름 가이드 — 매우 중요. 임팩트만 잘라내지 말고 흐름을 살려라]

쇼츠는 **3단 구조**로 짜야 시청 지속률이 산다. 임팩트만 뚝 잘라 붙이면 맥락 없이 어색해진다.

# 1단계: 빌드업 (Build-up) — 첫 5~12초
- 임팩트 직전의 "분위기"를 살린다.
- 예: 메인 임팩트가 "갑자기 띵털 등장"이라면, 빌드업은 그 직전에 두 사람이 평범하게 이야기하던 모습 또는 "노래를 부르다가" 같은 다른 흐름.
- 예: 임팩트가 "보아 노래 잘함 충격"이라면, 빌드업은 "이수지가 점 빼러 옴 → 갑자기 노래 시작" 같은 전환.
- 빌드업이 있어야 임팩트가 더 크게 터진다.

# 2단계: 임팩트 (Impact) — 메인 코어, 댓글이 가리킨 그 순간
- 가장 임팩트 큰 표정·말·반전 그대로.
- 줌인·효과음·자막 강조 집중.

# 3단계: 여운 (Aftermath) — 마지막 3~7초
- 임팩트 직후의 반응 (출연자가 빵 터지거나, 시청자가 한 번 더 보고 싶게 만드는 표정).
- 또는 다음 영상을 누르게 만드는 한 마디.

# 흐름 표현 패턴 (whyItWorks와 productionGuide.pacingNotes에 활용)
- "처음엔 평범하게 ○○하다가 / 갑자기 ○○이 등장해서 / 결국 ○○로 끝남"
- "○○이 ○○하고 있던 분위기에서 / 예상 못 한 ○○ 등장 / 모두 폭소 (또는 당황)"
- 즉, 단순 "○○이 웃김"이 아니라 **연결고리 있는 한 편의 미니 스토리**.

# optimalCut 선택 시 반드시 빌드업을 포함할 것
- 메인 임팩트의 정확한 시점(초)만 잘라내지 마라.
- 빌드업을 위해 임팩트보다 **8~15초 앞에서 시작**할 것.
- 따라서 optimalCut 길이는 보통 30~50초.
`;

const PICK_GUIDE = `
[클립 선정 가이드 — 제작자 가이드 기준, 반드시 점검]

# 영상 스타일 (선정에 영향)
- 길이: 1분 내외(40~65초)로 추릴 수 있어야 한다. 초과 시 fitsUnder60s=false.
- 첫 3초: 쇼츠 첫 3초 안에 웃긴 포인트 또는 강한 궁금증을 박을 만한 임팩트가 이 구간에 있어야 한다.
- 감성: 과한 억텐 X. "친구에게 웃긴 영상 보여주는 느낌"의 자연스러움.
- 타겟: 20~40대. 20~40대가 공감/킹받음/웃음 터질 만한 소재인지 평가.
- 리듬: "다음 장면이 궁금해서 끝까지 보게 되는 흐름"이 있어야 한다 (cliffhanger·반전 예고·빌드업 등).

# 추천 영상 주제 카테고리 (themeCategory에 매핑)
다음 중 가장 가까운 하나를 골라 themeCategory에 적어라:
- 웃긴 말실수
- 킹받는 상황
- 레전드 리액션
- 어이없는 상황극
- 예능 케미
- 텐션 차이
- 돌려까기 화법
- 극E/극I 상황
- 실제 웃음 터진 장면
- 기타: (없으면 자유 서술)
* "짧고 강한 웃음 포인트" 위주.

# 절대 금지 사항 (policyRisk 자동 점검 — 보수적으로)
자막·댓글·맥락에서 다음 신호가 보이면 해당 risk를 "low" 또는 "high"로 표시하고 note에 어떤 표현인지 적어라. 없으면 "none".
- children: 아이·어린이·아기 관련 내용 또는 아동학대 의심
- weapons: 총·칼 등 실제 무기 등장
- violence: 붉은 피·과도한 폭력·혐오 장면
- sexual: 과도한 노출·성적 표현·자극적 썸네일 유도
- politicsReligion: 정치적 혐오·종교 갈등 유도
- profanity: 과도한 욕설·비하·혐오 표현 (쇼츠 감성의 가벼운 'ㅁㅊ', '미쳤', '개웃' 등은 OK)

overall 판정:
- 모든 항목 none → "safe"
- 일부 low → "caution" (사용 가능하나 편집에서 가릴 것 명시)
- 어느 하나라도 high → "block" (이 구간 비추천)

# pickVerdict 판정 기준
- 강추: fitsUnder60s + hookableInFirst3s + targetAgeFit≥medium + retentionDriver 명확 + policy=safe + 댓글 시그널 강함
- 추천: 위 조건 대부분 충족
- 보류: hookableInFirst3s가 약하거나 themeCategory 매핑이 애매
- 비추: policy=block 또는 fitsUnder60s=false (너무 김) 또는 핵심 임팩트가 빈약
`;

const CAPCUT_REFERENCE = `
[CapCut for Mac (macOS 데스크톱 버전) 주요 메뉴 — capcutGuide 작성 시 이 명세 그대로 사용]

# 환경
- 플랫폼: **macOS 데스크톱 CapCut** (모바일/Windows 버전 아님)
- UI 언어: 영문 기준 (한국어 UI 설치 시에도 본 가이드는 영문 메뉴명으로 통일)
- 단축키: **⌘(Cmd) 기반** (Windows의 Ctrl 아님). 예: Split = ⌘B

# 메인 메뉴 (좌측 패널)
- **Media** → Import → 영상/이미지/오디오 임포트 (또는 Finder에서 드래그앤드롭)
- **Audio**
  - Sound Effects: 효과음 라이브러리 (검색창에서 "띠용", "쿵", "boing" 등 검색)
  - Music: BGM 라이브러리
  - Voiceover: 마이크 직접 녹음
  - **Text to speech**: TTS (한국어 보이스 — Hanna, Yuri, Jihye 등)
  - Extracted: 영상에서 추출한 오디오
- **Text**
  - Add text: 새 자막 추가
  - **Auto Captions**: 자동 자막 (한국어 지원)
  - Text templates: 디자인 템플릿
  - Animations (자막 클립 선택 후 우측 패널): In / Loop / Out
- **Stickers**: 검색해서 사용 (circle, arrow, emoji 등)
- **Effects**
  - **Video Effects**: Glitch (RGB Split, TV Glitch), Light (Flash, Lens Flare), Distortion, Atmosphere, Vintage
  - **Body Effects**: Zoom In/Out (얼굴 트래킹), Beauty
- **Transitions**: Basic (Dissolve, Fade), MG (Motion Graphics), Effect (Glitch transition)
- **Filters**: Movie (Cinematic), Beauty, Travel, Foodie, Vintage
- **Adjustments**: Brightness, Contrast, Saturation, Sharpen
- **Speed** (클립 선택 후 우측 패널 또는 상단 Speed 메뉴)
  - Normal: 0.1x~10x 일정 배속
  - Curve: Bullet Time, Hero Moment, Bumpy 등 preset 또는 커스텀

# 자막(Text) 우측 패널 옵션
- Style 탭: 폰트, Size, Color, Stroke(외곽선), Shadow, Background, Bold/Italic
- Animations 탭:
  - **In**: Pop, Typewriter, Slide, Fade In, Wave, Bounce In, Roll, Zoom In
  - **Loop**: Shake, Pulse, Wave, Heartbeat, Glitch
  - **Out**: Pop Out, Fade Out, Slide Out, Zoom Out
- Position: 화면 좌표(키프레임 적용 가능)
- Bubble: 말풍선 배경

# 키프레임 (Keyframe)
- 클립 선택 → 우측 Basic 탭의 **다이아몬드 아이콘** 클릭 → 해당 시점 키프레임 생성
- 적용 속성: Position, Scale, Rotation, Opacity
- 다른 시점으로 playhead 이동 → 값 변경 → 자동으로 두 번째 키프레임 생성 → 보간 애니메이션

# macOS 캡컷 주요 단축키
- ⌘B = Split (현재 위치에서 클립 분할)
- ⌘S = Save
- ⌘Z / ⌘⇧Z = Undo / Redo
- ⌘D = Duplicate
- ⌘E = Export
- Delete / ⌫ = 클립 삭제
- Space = 재생/정지
- J/K/L = 역재생/정지/재생
- ⌘+/⌘- = 타임라인 줌 인/아웃

# 흔히 쓰는 한국 쇼츠 캡컷 효과 매핑 (macOS 기준)
- 임팩트 줌인: **Effects > Body Effects > Zoom In** 또는 키프레임(Scale 1.0 → 1.3)
- 화면 흔들기: Effects > Video Effects > Shake 또는 키프레임(Position 흔들기)
- 충격 강조: Effects > Video Effects > Light > Flash + 흔들기
- 빨간 동그라미/화살표: Stickers > 검색 'circle', 'arrow'
- 슬로우 모션: 클립 선택 → 우측 Speed 탭 > **Curve > Bullet Time** preset (또는 Normal 0.3~0.5x)
- 컷 점프 (불필요한 호흡 제거): playhead 위치 → ⌘B로 split 후 가운데 부분 Delete
- TTS: **Text > Add text 입력 → 우측 Read Text Aloud > Korean voice 선택**
- 자동 자막: Text > Auto Captions > Language: Korean → Start
- BGM 덕킹: Audio 클립 선택 → 우측 Volume 다이아몬드(키프레임) → 인서트 직전 0dB → 0.3초 후 -12dB → 끝 0.3초 후 0dB
`;

const KOREAN_SHORTS_GUIDE = `
[한국 쇼츠 제작 컨벤션 — 반드시 반영]

# 자막 (가장 중요)
- 한국 쇼츠는 자막이 영상의 절반. 0.5~3초 단위로 자막이 끊임없이 바뀐다.
- 글자 위치: 화면 상단 1/3 (얼굴 가리지 않게) 또는 중앙. 하단 X (UI 가림).
- 글자 스타일: 굵은 흰 글씨 + 검정 stroke 2~3px. 강조 단어만 노란색/빨간색.
  - 충격/반전 = 빨강, 웃긴 단어 = 노랑, 일반 강조 = 형광초록
- 키워드 강조법: 강조 단어가 등장할 때 글자가 0.1초 커지거나(140%), 살짝 진동(shake).
- 인물 대사를 그대로 박을 때는 따옴표 또는 작은 따옴표 사용.

# 효과음 (대표 한국 쇼츠 SFX)
- 띠용 / 띠로링 — 의외/반전
- 두구두구 — 긴장감 빌드업 (정답 공개 전)
- 짜잔 / 쨔란 — 등장/공개
- 쿵 — 임팩트 (얼굴 줌인과 동기화)
- 뽀잉 / 핑 — 가벼운 포인트
- 삐익 — 어이없음/실수
- 박수 트랙 — 감동/감탄
- 큰 웃음 트랙 (laugh track) — 웃긴 멘트 직후

# 시각효과
- 얼굴 줌인 1.2~1.5배 (임팩트 단어와 동기화)
- 0.3~0.5초 슬로우모션 (반전 직전)
- 화면 흔들기 (충격/임팩트)
- 빨간 동그라미 + 화살표 (썸네일 + 본편 모두)
- 흑백 처리 (감정 전환, 회상)
- 컷 점프 (불필요한 호흡 제거 — 한국 쇼츠는 1~2초마다 컷)

# 어법/밈 (자막·제목에서 활용)
- ㄹㅇ, 찐, 갓, 킹받, 레전드, 역대급, 인생작
- "이게 진짜 이유", "~한 사람만 안다", "충격적인 사실", "알고있어?"
- 두괄식: 결론·후크를 0~3초 안에 보여줘야 함 (안 그러면 스킵).
- 반말 + 짧은 문장.

# 제목 패턴
- 숫자: "3초만에 알아채는", "1번 보면 못 잊는"
- 질문: "~ 왜 이렇게 됐을까?", "~ 진짜 이유"
- 충격: "역대급", "충격", "소름"
- 인물명/고유명사를 제목에 그대로 노출 (검색·알고리즘 유리)

# 썸네일 후크 (thumbnailText)
- 8자 이내. 표정/순간/공백 활용.
- 예: "이게 사람?", "충격 ㄷㄷ", "1초만", "보아의 비밀", "결국 ...".
`;

function buildPrompt(args: { zone: HotZone; ctx: AnalysisContext }): string {
  const { zone, ctx } = args;

  const manualEntitiesBlock = ctx.manualEntities.length
    ? ctx.manualEntities
        .map((e) => `- ${e.name}${e.role ? ` (${e.role})` : ""}`)
        .join("\n")
    : "(없음)";

  const forbiddenBlock = ctx.forbiddenEntities.length
    ? ctx.forbiddenEntities.map((n) => `- ${n}`).join("\n")
    : "(없음)";

  const commentsBlock = zone.pickedComments.length
    ? zone.pickedComments
        .map(
          (c, i) =>
            `${i + 1}. "${c.text}" (좋아요 ${c.likes}${c.tags?.length ? `, 태그 ${c.tags.join("/")}` : ""})`,
        )
        .join("\n")
    : "(이 구간을 직접 지목한 댓글 없음. Most Replayed 데이터로 추출된 핫존.)";

  const referencesBlock = ctx.references.length
    ? ctx.references
        .map(
          (r, i) =>
            `[REF ${i + 1}] ${r.title} (채널: ${r.uploader}, 길이 ${r.durationSec}초)\nURL: ${r.url}\n설명: ${r.description || "(없음)"}\n자막 발췌: ${r.subtitleText || "(자막 없음)"}`,
        )
        .join("\n\n")
    : "(레퍼런스 쇼츠 미지정)";

  const globalCommentsBlock = ctx.globalTopComments.length
    ? ctx.globalTopComments
        .slice(0, 25)
        .map((c, i) => `${i + 1}. "${c.text}" (♥${c.likes})`)
        .join("\n")
    : "(영상 전반 인기 댓글 없음)";

  const tagsLine = ctx.videoTags.length ? ctx.videoTags.slice(0, 15).join(", ") : "(없음)";
  const catsLine = ctx.videoCategories.length ? ctx.videoCategories.join(", ") : "(없음)";
  const descClip = (ctx.videoDescription || "").slice(0, 1500);

  return `너는 한국 유튜브 쇼츠 편집·기획 전문가다. 아래 원본 영상의 한 "핫존(시청자가 댓글로 직접 지목하거나 Most Replayed 데이터로 검증된 구간)"을 가지고 쇼츠를 한 편 만들 때, 편집자가 그대로 따라할 수 있는 매우 구체적이고 한국 정서에 맞는 제작 지시사항을 작성하라.

# ⚠️ 최우선 — 사용자가 명시한 진실 (이걸 따르지 않으면 무조건 잘못된 분석이다)

## 사용자가 확인한 등장 인물·키워드 (반드시 keyEntities에 그대로 포함, 다른 이름으로 추론·교체 금지)
${manualEntitiesBlock}

## 사용자가 부정한 인물 (자막·댓글에 이 단어가 보여도 절대 인물로 추론하지 마라 — 노래 가사·동음이의어일 뿐)
${forbiddenBlock}

위 두 블록은 사용자가 영상을 실제로 본 후 확정한 사실. 자막·댓글이 다르게 보여도 의심 금지. 자막에 "보아도 슬프지 않게"라는 가사가 있고 사용자가 보아를 부정하면 그건 거미 노래의 가사일 뿐 가수 보아 X.

# 원본 영상 메타
- 제목: ${ctx.videoTitle}
- 채널: ${ctx.uploader || "(미상)"}
- 전체 길이: ${formatTime(ctx.videoDurationSec)} (${ctx.videoDurationSec}초)
- 카테고리: ${catsLine}
- 영상 태그: ${tagsLine}

## 영상 설명 (description, 핵심 등장인물/주제 파악용)
"""
${descClip || "(설명 비어있음)"}
"""

## 영상 전반 인기 댓글 상위 25 — 시청자들이 이 영상에서 주로 누구·무엇을 화제 삼는지 파악용. 인물명·작품명·사건명을 여기서 반드시 추출해 활용할 것.
${globalCommentsBlock}

# 이번에 분석할 핫존
- 원본 영상 내 구간: ${formatTime(zone.startSec)} ~ ${formatTime(zone.endSec)} (즉, ${zone.startSec}초~${zone.endSec}초)
- 중심 시점: ${formatTime(zone.centerSec)}
- 신호 종류: ${zone.kind === "comment" ? "댓글 지목 (1순위 신호)" : "Most Replayed 히트맵 (실데이터)"}
- 시청자 직접 지목 횟수: ${zone.mentionCount}회 (서로 다른 사람 ${zone.uniqueAuthors}명)
- Most Replayed 피크 겹침: ${zone.heatmapOverlap ? "YES — 실제 시청 데이터로도 검증됨 (최강 신호)" : "NO"}
- 시청자 반응 태그: ${zone.tags.join(", ") || "(없음)"}

## 이 구간 자막 (±10초 맥락 포함)
"""
${zone.transcript || "(자막 없음 — 영상 내 시각적 임팩트 또는 음악이 핵심일 가능성)"}
"""

## 이 구간을 지목한 실제 댓글 (좋아요순, 최대 20개)
${commentsBlock}

## 🎙️ 이 핫존의 음성 공백 (내레이션 후보 시점) — 임팩트와 가까운 곳 우선
${zone.voiceGaps.length > 0
  ? zone.voiceGaps
      .map((g, i) => {
        const gapCenter = (g.startSec + g.endSec) / 2;
        const distToImpact = Math.round(Math.abs(gapCenter - zone.centerSec));
        return `[Gap ${i + 1}] 원본 ${g.startSec}~${g.endSec}초 (${g.durationSec}초 비어있음, TTS 최대 ${Math.floor(g.durationSec * 4)}자) — 임팩트(${zone.centerSec}초)에서 ${distToImpact}초 거리`;
      })
      .join("\n")
  : "(음성 공백이 거의 없음 — 내레이션 박기 어려울 수 있음, segments 빈 배열 가능)"}

${ctx.narrationText
  ? `## 사용자가 직접 제안한 내레이션 톤·내용 (반영):\n"""\n${ctx.narrationText.slice(0, 600)}\n"""`
  : ""}

${FLOW_GUIDE}

${PICK_GUIDE}

${KOREAN_SHORTS_GUIDE}

${CAPCUT_REFERENCE}

# 레퍼런스 쇼츠 (사용자가 본받고 싶다고 지정한 영상들 — capcutGuide의 톤/효과/속도감을 이 레퍼런스에 맞추어라)
${referencesBlock}

# 작성 규칙 (엄격히 준수)
0. **clipSelection / policyRisk**: 위 "[클립 선정 가이드]"를 그대로 적용해 채워라. pickVerdict와 overall은 보수적으로 판단.
1. **keyEntities** — 인물 식별 규칙 (매우 중요, 잘못 추론하지 말 것):
   a. **사용자가 명시한 인물 (manualEntities)을 반드시 그대로 포함**. 다른 이름으로 바꾸거나 추가 추론으로 대체하지 말 것.
   b. **사용자가 부정한 인물(forbiddenEntities)은 절대 keyEntities에 넣지 마라.** 자막·댓글에 그 이름이 보여도 노래 가사·동음이의어로 해석.
   c. 사용자 hint가 없는 경우의 신뢰 우선순위: (1) 채널명/uploader → (2) description → (3) globalTopComments에서 "○○씨/님/등장/남편/부인" 등으로 명시된 이름 → (4) 태그/카테고리. 자막은 인물 식별 근거로 사용 금지.
   d. 구체적인 한국어 이름을 그대로 사용. "출연자 A", "남자" 같은 추상명사 절대 금지.
   e. 확신이 없으면 keyEntities에 넣지 마라. 잘못된 추측보다 빈 칸이 낫다.
2. **whyItWorks**: keyEntities에서 확정한 이름만 사용. 추측 이름 금지. 흐름(빌드업 → 임팩트 → 여운)을 한 문장에 담아라. 예: "이수지가 점을 빼러 와서 거미 노래 한 곡을 진지하게 부르다 갑자기 핫도그를 우적우적 먹는 반전으로 폭소."
3. **thumbnailText**는 8자 이내, 인물명을 직접 노출하면 알고리즘·클릭 유리 (예: "보아 충격").
4. **thumbnailVisual**: 어떤 표정·인물·구도를 어디 배치할지 한 줄로 묘사.
5. **titleCandidates** 3개는 가능하면 인물명/작품명 포함. 한국 쇼츠 클릭 유발 패턴 (질문/숫자/충격/반전).
6. **optimalCut**의 startSec/endSec는 반드시 ${zone.startSec}~${zone.endSec} 범위 내. **사용자 ${ctx.playbackSpeed}배속 → 원본 ${ctx.targetCutMinSec}~${ctx.targetCutMaxSec}초 잘라야 결과물 ${Math.round(ctx.targetCutMinSec / ctx.playbackSpeed)}~${Math.round(ctx.targetCutMaxSec / ctx.playbackSpeed)}초.**
   - **컷 전체 길이는 절대 ${ctx.targetCutMinSec}초 미만 X**.
   - **임팩트 중심 일관성 (매우 중요)**: 임팩트는 **${zone.centerSec}초 한 곳**이다. 컷의 끝(endSec)이 임팩트보다 **+25초 넘기지 마라** — 영상에 다른 임팩트·다른 장면이 따라오면 그것까지 포함되면서 일관성 깨짐. startSec은 임팩트 **-25~-35초**.
   - 임팩트(${zone.centerSec}초)는 컷 안에서 보통 **컷 중반 또는 약간 뒤**(60~75% 지점)에 위치하도록.
   - reasoning에 "○○하던 흐름에서 갑자기 ○○로" 식의 연결고리 명시.
7. **narrationPlan** — 짧은 멘트를 임팩트 주변에 배치. **각 멘트 1~2초**.

   ### 🔥 위치: 임팩트 직전/직후 (절대 시간 X, **임팩트 상대 위치**)
   - 이 핫존의 임팩트는 원본 영상 **${zone.centerSec}초** 시점이다.
   - **쇼츠 기준 임팩트 위치 = ${zone.centerSec} - optimalCut.startSec 초**.
   - 내레이션은 그 임팩트 위치를 기준으로 다음 두 자리 중 선택:
     1. **임팩트 직전 -10초~-1초** (빌드업 예고) ← 1순위, 노래 나오기 직전 같은 느낌
     2. **임팩트 직후 +1초~+5초** (메타 코멘트) ← 2순위
   - **insertAtSec 절대값 강제 X. 임팩트 위치 따라 달라진다.**
     - 예: 임팩트가 쇼츠 25초면 → 내레이션 15~24초 또는 26~30초
     - 예: 임팩트가 쇼츠 10초면 → 내레이션 1~9초 또는 11~15초 (단 첫 3초 X)
   - 첫 3초 후크 침범 금지. 마지막 2초 침범 금지.
   - **빈 배열 금지**: 최소 1개. voiceGaps 중 임팩트 직전/직후 후보 없으면 BGM 덕킹으로라도.

   ### 🔥 길이: 2~4초, 구체적인 한 문장
   - durationSec **2~4초**.
   - script **15~30자**의 한 문장. 너무 짧게 (예: "노래하다 갑자기 핫도그?") 단순하게 끝내지 마라.
   - 반드시 **인물 이름** + **구체적 행동·상황** + **반전 포인트**가 한 문장에 담겨야 한다.

   ### 자리 찾기 우선순위
   1. voiceGaps 중 **임팩트 직전 -10~-1초** 범위의 Gap (작아도 0.6초 이상이면 OK)
   2. voiceGaps 중 **임팩트 직후 +1~+5초** 범위의 Gap
   3. 위 범위에 Gap 없으면 → **BGM 덕킹으로 자리 만들기**: 임팩트 직전 1~2초 발화에 BGM/원본 오디오 -15dB 잠깐 줄이고 그 위에 내레이션. bgmDucking에 정확히 명시.

   ### 내용: 임팩트 일관성 + 구체적
   - 내용은 임팩트(${zone.centerSec}초의 ○○)에 대한 것. **인물 이름·구체적 행동·반전 포인트** 모두 한 문장에.
   - 단순 문장 금지. 예: ❌ "노래하다 갑자기 핫도그?" ❌ "이수지 빙의 시작"
   - 임팩트 직전 (-10~-1초): **다큐 패러디 서술체** + 구체적 상황
   - 임팩트 직후 (+1~+5초): **메타 코멘트** + 구체적 행동/반응

   ### 좋은 예시 (15~30자, 그대로 베끼지 말고 영상에 맞게 새로)
   - "거미 노래를 거미보다 진지하게 부르는 이수지"  (다큐체)
   - "이수지, 갑자기 핫도그를 꺼내 우적우적 먹기 시작한다"  (행동 묘사)
   - "이수지의 노래에 빠져있던 조정석, 이내 표정이 굳는다"  (인물 반응)
   - "거미는 모르는 거미의 노래 부르는 법ㅋㅋ"  (병맛 메타)
   - "당황한 조정석, 핫도그 먹방 시작한 이수지를 멈추지 못함"
   - "이게 점 빼는 영상이라고 누가 믿겠어ㅋㅋ"  (메타+상황)

   ### 기타
   - 1~2개. 짧으니까 직전+직후 둘 다 박아도 OK.
   - insertAtSec은 쇼츠 상대 초 (optimalCut.startSec을 0으로).

   ### script 작성 톤 (AI 티 절대 금지)
   - **금지**: "진짜 만능이네요", "감동적입니다", "두 사람의 케미가 돋보입니다" 같은 평론체. AI 그 자체.
   - **권장**:
     - (A) **다큐 패러디 서술체** — "○○하는 ○○형", "○○에 매료된 ○○씨", "그 순간 ○○이 등장한다" (담담한 척하면서 웃김)
     - (B) **쇼츠 댓글 톤** — ㅋㅋ·ㄹㅇ·ㄷㄷ + 자기비하/메타발언/황당한 결론
   - 별명·호칭·애칭이 댓글이나 영상에 있으면 적극 활용 (예: 김호영 → 기모형, 조정석 → 거미남편).

   ### 좋은 예시
   - (다큐 패러디) "김호영의 냉장고에는 무려 20가지 종류의 식품이 있다."
   - (다큐 패러디) "바로 반박하는 기모형."
   - (댓글톤) "아니 거미 노래를 이수지가 더 잘부르네ㅋㅋ"
   - (댓글톤) "지나가다 박혀버림."
   - (댓글톤) "이거 보다가 숨 막혀 뒤짐"
   - (댓글톤) "보통 사람: 점 뺀다 / 이수지: 거미 빙의해서 노래 부른다"
   - 사람·작품 폄하 X. 톤만 격할 뿐 내용은 호의적/감탄/공감.

   ### role 분류 가이드
   - 첫 Gap (영상 도입 후 빈 곳): "도입 정리" — 영상이 뭔지 한 줄 요약
   - 중간 Gap (반전 직전): "반전 짚기" — 외부 시선·갭 짚어주기
   - 후반 Gap (반전 직후): "병맛 메타" — 별명 활용 다큐 패러디
   - 마지막 Gap: "마무리" — 한 줄 결론
   - 영상에 맞게 자유롭게.

8. **capcutGuide** — **macOS 데스크톱 CapCut(맥북 기준)** 명세를 사용. 모바일/Windows 단축키·메뉴 X. 위 [CapCut for Mac 주요 메뉴] 그대로 따른다. **원본 영상 위에 자막을 박지 않는다** (사용자 요청). 따라서 **textAnimations는 빈 배열 [] 로 두어라**. 자막은 오직 narrationPlan의 captionLines (내레이션 자막)만 사용. **capcutEffects는 시각효과·효과음 위주로 작성** (where는 "Effects > Video Effects > Glitch > RGB Split" 같이 정확한 경로). 단축키 언급 시 반드시 **⌘(Cmd) 기반** (예: "⌘B로 split"). **speedRamp는 사용자 기본 배속 ${ctx.playbackSpeed}배를 전제** (예: "전체 클립 Speed 탭 > Normal > ${ctx.playbackSpeed}x. 임팩트 구간만 Speed > Curve > Bullet Time preset 적용해 0.5x 슬로우.").
9. **productionGuide** — 위에 명시한 한국 쇼츠 컨벤션을 구체적으로 적용. **captionStrategy는 빈 배열 [] 로 둘 것** (원본 자막 안 씀).
   - captionStrategy: 최소 4개 이상의 자막 컷. 각 컷에 정확한 timeRange(쇼츠 기준 0:00 시작) + 정확한 문구 + 글자색/위치/효과(예: "상단 1/3, 흰글씨+검정 stroke, 강조어 '보아'는 노란색 + 0.1초 진동").
   - soundEffects: 최소 3개. "0.5초 띠용", "8초 쿵+화면흔들기" 식으로 정확한 시점.
   - visualEffects: 최소 3개. 줌인 배율, 슬로우 길이, 컷 점프 위치 명시.
   - pacingNotes: **3단 구조(빌드업 → 임팩트 → 여운)** 호흡을 명시. 예: "0~8초 빌드업(노래 부르는 흐름 자연스럽게), 8~24초 메인 임팩트(띵털 등장 직후 컷 빠르게), 24~30초 여운(서로 빵 터지는 리액션)."
   - bRoll: 해당 쇼츠에 어떤 짤/밈/리액션 컷을 끼우면 좋을지 (구체적 종류).
   - endingHook: 마지막 1~2초에 어떤 멘트·자막·표정으로 끝낼지.
   - koreanCulturalNotes: 한국 시청자가 좋아할/싫어할 포인트, 활용해야 할 밈/표현, 피해야 할 표현을 구체적으로.
10. 출력은 스키마대로 JSON만. 다른 텍스트·설명·마크다운·코드펜스 금지.
`;
}

// ============================================================
// 자동 인물 식별 (사전 단계)
// ============================================================

export type IdentifyResult = {
  confirmed: KeyEntity[];
  forbidden: string[];
  reasoning: string;
};

const IDENTIFY_SCHEMA = {
  type: "object",
  properties: {
    confirmed: {
      type: "array",
      description: "이 영상에 실제로 등장한 인물·작품·고유명사. 댓글·description·채널명에서 명시적으로 언급된 것만.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", description: "예: 가수, 코미디언, 방송인, 채널주, 출연자" },
        },
        required: ["name", "role"],
      },
    },
    forbidden: {
      type: "array",
      description: "자막·가사에 나올 수 있지만 실제 인물이 아닌 단어 (예: 노래 가사 속 단어). 추후 keyEntities에 이 단어가 들어가서는 안 된다.",
      items: { type: "string" },
    },
    reasoning: { type: "string", description: "각 판단 근거를 한두 문장으로." },
  },
  required: ["confirmed", "forbidden", "reasoning"],
} as const;

export async function identifyEntities(args: {
  videoTitle: string;
  uploader: string;
  videoDescription: string;
  videoTags: string[];
  globalTopComments: { text: string; likes: number }[];
}): Promise<IdentifyResult> {
  const ai = getGeminiClient();
  const commentsBlock = args.globalTopComments
    .slice(0, 50)
    .map((c, i) => `${i + 1}. "${c.text}" (♥${c.likes})`)
    .join("\n");

  const prompt = `너는 한국 유튜브 영상 메타데이터 분석가다. 아래 데이터만 보고 이 영상의 실제 등장 인물(가수/배우/방송인/일반인)과 역할을 식별하라.

# 데이터
- 채널: ${args.uploader || "(미상)"}
- 제목: ${args.videoTitle}
- 영상 태그: ${args.videoTags.slice(0, 15).join(", ") || "(없음)"}

## description
"""
${(args.videoDescription || "").slice(0, 1500) || "(없음)"}
"""

## 인기 댓글 상위 50개
${commentsBlock || "(없음)"}

# 식별 규칙 (엄격히 준수)
1. **댓글에서 명시적으로 언급된 이름만 신뢰**. 패턴: "○○씨", "○○님", "○○ 등장", "○○ 같다", "○○인줄", "○○ 남편/부인", "역시 ○○", "○○ 출연".
2. **description / 채널명에서도 출연자 정보 추출**.
3. **댓글에 자주 등장하지만 노래 가사·관용구일 수 있는 한국어 단어**(예: "보아", "달", "별", "꽃", "사랑")는 **인물로 추론하지 마라**. 단, 댓글이 "○○ 가수", "○○씨" 식으로 명시하면 인물.
4. **자막은 이 단계에서 보지 않음**. 노래 가사 함정 차단.
5. **forbidden** 배열에는 자막·가사에 자주 나오는 한국어 단어 중 **이 영상의 실제 인물이 아닌 단어**를 넣어라. 예: 댓글에서 "거미 노래", "거미인줄", "보아도 슬프지 않게 부르네"라는 표현이 있다면 → 실제 가수는 **거미**, 자막의 "보아"는 **거미 노래 가사**. 이때 forbidden에 "보아"를 넣는다.
6. 확신이 없으면 confirmed에 넣지 마라. 빈 배열도 OK.
7. reasoning에 각 confirmed/forbidden 판단의 근거를 한두 문장.

JSON만 출력.`;

  const res = await withRetry(() =>
    ai.models.generateContent({
      model: FLASH_FULL_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: IDENTIFY_SCHEMA,
        temperature: 0.3,
      },
    }),
  );
  const text = res.text || "{}";
  try {
    return JSON.parse(text) as IdentifyResult;
  } catch (e) {
    throw new Error(`Identity JSON 파싱 실패: ${(e as Error).message}`);
  }
}

// ============================================================

export async function analyzeZone(zone: HotZone, ctx: AnalysisContext): Promise<ZoneAnalysis> {
  const ai = getGeminiClient();
  const prompt = buildPrompt({ zone, ctx });
  const res = await withRetry(() =>
    ai.models.generateContent({
      model: FLASH_FULL_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 1.0,
      },
    }),
  );
  const text = res.text || "{}";
  try {
    return JSON.parse(text) as ZoneAnalysis;
  } catch (e) {
    throw new Error(`Gemini JSON 파싱 실패: ${(e as Error).message}`);
  }
}
