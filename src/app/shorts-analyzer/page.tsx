"use client";

import { useEffect, useRef, useState } from "react";

type CaptionRow = { timeRange: string; text: string; style: string };
type FxRow = { atSec: number; effect: string; reason: string };

type CapcutStep = { step: number; title: string; action: string; tip: string };
type CapcutEffect = { atSec: number; where: string; name: string; how: string };
type TextAnim = { atSec: number; text: string; enter: string; loop: string; exit: string };
type CapcutGuide = {
  overview: string;
  steps: CapcutStep[];
  capcutEffects: CapcutEffect[];
  textAnimations: TextAnim[];
  speedRamp: string;
  keyframeAnimations: string;
  referenceMatching: string;
};

type NarrationSegment = {
  insertAtSec: number;
  durationSec: number;
  role: string;
  script: string;
  captionLines: string[];
};

type NarrationPlan = {
  segments: NarrationSegment[];
  captionStyle: string;
  voiceStyle: string;
  bgmDucking: string;
  rationale: string;
};

type KeyEntity = { name: string; role: string };

type ClipSelection = {
  themeCategory: string;
  fitsUnder60s: boolean;
  hookableInFirst3s: boolean;
  retentionDriver: string;
  targetAgeFit: "high" | "medium" | "low";
  targetAgeReason: string;
  pickVerdict: "강추" | "추천" | "보류" | "비추";
  pickReason: string;
};

type PolicyRiskItem = { risk: "none" | "low" | "high"; note: string };

type PolicyRisk = {
  children: PolicyRiskItem;
  weapons: PolicyRiskItem;
  violence: PolicyRiskItem;
  sexual: PolicyRiskItem;
  politicsReligion: PolicyRiskItem;
  profanity: PolicyRiskItem;
  overall: "safe" | "caution" | "block";
  overallNote: string;
};

type ZoneAnalysis = {
  reactionType: string;
  whyItWorks: string;
  keyEntities?: KeyEntity[];
  optimalCut: { startSec: number; endSec: number; reasoning: string };
  clipSelection?: ClipSelection;
  policyRisk?: PolicyRisk;
  thumbnailText: string;
  thumbnailVisual?: string;
  titleCandidates: string[];
  capcutGuide?: CapcutGuide;
  narrationPlan?: NarrationPlan;
  productionGuide: {
    openingHook: string;
    captionStrategy: CaptionRow[];
    soundEffects: FxRow[];
    visualEffects: FxRow[];
    pacingNotes: string;
    bRoll: string;
    endingHook: string;
    koreanCulturalNotes?: string;
  };
};

type PickedComment = { text: string; likes: number; tags: string[]; author: string };

type ZoneResult = {
  startSec: number;
  endSec: number;
  centerSec: number;
  startLabel: string;
  endLabel: string;
  centerLabel: string;
  kind: "comment" | "heatmap-only";
  finalScore: number;
  mentionCount: number;
  uniqueAuthors: number;
  heatmapOverlap: boolean;
  heatmapPeakValue: number | null;
  tags: string[];
  transcript: string;
  pickedComments: PickedComment[];
  analysis: ZoneAnalysis | null;
  analysisError: string | null;
};

type AnalyzeResult = {
  video: {
    id: string;
    title: string;
    url: string;
    durationSec: number;
    uploader: string;
    viewCount: number;
    thumbnail: string;
  };
  summary: {
    commentsScanned: number;
    commentsWithTimestamp: number;
    signalCount: number;
    commentClusterCount: number;
    heatmapAvailable: boolean;
    heatmapPeakCount: number;
    hotZoneCount: number;
    analyzedZoneCount: number;
  };
  zones: ZoneResult[];
  skip?: number;
  nextSkip?: number;
  hasMore?: boolean;
};

type AutoIdentified = {
  confirmed: { name: string; role?: string }[];
  forbidden: string[];
  reasoning: string;
};

type Session = {
  id: string;
  createdAt: number;
  videoTitle: string;
  result: AnalyzeResult;
  autoIdentified: AutoIdentified | null;
  /** 누적 분석용: 분석 시 사용한 원본 query 파라미터 */
  query: {
    url: string;
    speed: number;
    cutMin: number;
    cutMax: number;
    entities: string;
    forbid: string;
  };
  /** 다음에 분석할 핫존 인덱스 */
  nextSkip: number;
  hasMore: boolean;
};

const STORAGE_KEY = "shorts-analyzer-sessions-v1";

function loadSessions(): Session[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: Session[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {}
}

function fmtMinSec(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function toMarkdown(r: AnalyzeResult): string {
  const v = r.video;
  let md = `# 🎬 ${v.title}\n\n`;
  md += `- 채널: ${v.uploader}\n- 길이: ${fmtMinSec(v.durationSec)}\n- URL: ${v.url}\n\n`;
  md += `## 분석 요약\n- 댓글 ${r.summary.commentsScanned}개 스캔 / 타임스탬프 ${r.summary.commentsWithTimestamp}개 / 시그널 ${r.summary.signalCount}개\n`;
  md += `- 댓글 클러스터 ${r.summary.commentClusterCount}개\n`;
  md += `- 히트맵: ${r.summary.heatmapAvailable ? `${r.summary.heatmapPeakCount}개 피크` : "없음"}\n`;
  md += `- 핫존 ${r.summary.hotZoneCount}개 산출, ${r.summary.analyzedZoneCount}개 분석\n\n`;
  r.zones.forEach((z, i) => {
    const a = z.analysis;
    md += `---\n\n## #${i + 1} ${z.startLabel} ~ ${z.endLabel}  (score ${z.finalScore})\n\n`;
    md += `- 신호: ${z.kind === "comment" ? "댓글 지목" : "Most Replayed"} / 댓글 ${z.mentionCount}회 / 서로 다른 사람 ${z.uniqueAuthors}명 / Most Replayed 겹침 ${z.heatmapOverlap ? "✓" : "✗"}\n`;
    if (z.tags.length) md += `- 반응 태그: ${z.tags.join(", ")}\n`;
    md += "\n";
    if (!a) {
      md += `> 분석 실패: ${z.analysisError}\n\n`;
      return;
    }
    md += `### 왜 통하는가\n${a.whyItWorks}\n\n`;

    if (a.keyEntities && a.keyEntities.length > 0) {
      md += `### 등장 인물 / 키워드\n${a.keyEntities.map((e) => `- **${e.name}** (${e.role})`).join("\n")}\n\n`;
    }

    md += `### 최적 컷\n- ${a.optimalCut.startSec}초 ~ ${a.optimalCut.endSec}초 (${a.optimalCut.endSec - a.optimalCut.startSec}초)\n- 근거: ${a.optimalCut.reasoning}\n\n`;
    md += `### 제목 후보\n${a.titleCandidates.map((t) => `- ${t}`).join("\n")}\n\n`;

    // 💭 내레이션 (이게 가장 중요)
    if (a.narrationPlan && a.narrationPlan.segments.length > 0) {
      md += `### 💭 내레이션 (TTS+자막, ${a.narrationPlan.segments.length}개)\n`;
      a.narrationPlan.segments.forEach((seg, idx) => {
        const absStart = Math.round(a.optimalCut.startSec + seg.insertAtSec);
        const absEnd = Math.round(absStart + seg.durationSec);
        md += `\n**${idx + 1}. [${seg.role}] 쇼츠 ${seg.insertAtSec}s ~ ${(seg.insertAtSec + seg.durationSec).toFixed(1)}s (원본 ${fmtMinSec(absStart)}~${fmtMinSec(absEnd)})**\n`;
        md += `- 멘트: **"${seg.script}"**\n`;
        if (seg.captionLines.length > 0) {
          md += `- 자막 줄: ${seg.captionLines.map((l) => `\`${l}\``).join(" / ")}\n`;
        }
      });
      md += `\n- 🎙️ TTS: ${a.narrationPlan.voiceStyle}\n`;
      md += `- 🔉 BGM 덕킹: ${a.narrationPlan.bgmDucking}\n`;
      md += `- 💡 ${a.narrationPlan.rationale}\n\n`;
    }

    // 🎬 캡컷 가이드
    if (a.capcutGuide) {
      md += `### 🎬 캡컷(macOS) 효과\n`;
      if (a.capcutGuide.capcutEffects.length > 0) {
        a.capcutGuide.capcutEffects.forEach((e) => {
          md += `- **${e.atSec}s** ${e.name} — \`${e.where}\`\n  - ${e.how}\n`;
        });
      }
      md += `\n- ⚡ **속도**: ${a.capcutGuide.speedRamp}\n`;
      if (a.capcutGuide.keyframeAnimations) {
        md += `- 🎯 **키프레임**: ${a.capcutGuide.keyframeAnimations}\n`;
      }
      md += `\n`;
    }

    md += `### 추가 팁\n`;
    md += `- **오프닝 (0~3초)**: ${a.productionGuide.openingHook}\n`;
    md += `- **편집 호흡**: ${a.productionGuide.pacingNotes}\n`;
    if (a.productionGuide.soundEffects.length > 0) {
      md += `- **효과음**:\n`;
      a.productionGuide.soundEffects.forEach((s) => {
        md += `  - ${s.atSec}s: ${s.effect} — ${s.reason}\n`;
      });
    }
    if (a.productionGuide.visualEffects.length > 0) {
      md += `- **시각효과**:\n`;
      a.productionGuide.visualEffects.forEach((f) => {
        md += `  - ${f.atSec}s: ${f.effect} — ${f.reason}\n`;
      });
    }
    if (a.productionGuide.bRoll && a.productionGuide.bRoll !== "불필요") {
      md += `- **B-roll**: ${a.productionGuide.bRoll}\n`;
    }
    md += `- **엔딩 (마지막 1~2초)**: ${a.productionGuide.endingHook}\n\n`;
  });
  return md;
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const STAGE_LABEL: Record<string, string> = {
  starting: "🚀 분석 준비 중…",
  collecting: "📥 yt-dlp 호출 준비 중…",
  "collect:video_id": "🔎 영상 ID·메타 정보 가져오는 중…",
  "collect:downloading": "📥 댓글·히트맵·자막 다운로드 중… (인기 영상은 1~3분 걸려요)",
  normalizing: "🧹 댓글에서 타임스탬프 추출 중…",
  merging: "🔗 댓글 클러스터 + Most Replayed 결합 중…",
  identifying: "🔍 등장 인물 자동 식별 중…",
  analyzing: "🤖 Gemini로 제작 지시사항 생성 중…",
  done: "✅ 완료!",
};

export default function ShortsAnalyzerPage() {
  const [url, setUrl] = useState("");
  const [maxZones, setMaxZones] = useState(1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.2);
  const [cutMin, setCutMin] = useState(40);
  const [cutMax, setCutMax] = useState(60);
  const [entities, setEntities] = useState("");
  const [forbidEntities, setForbidEntities] = useState("");
  const [autoIdentified, setAutoIdentified] = useState<AutoIdentified | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(true);
  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const logBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => esRef.current?.close(), []);
  useEffect(() => {
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  }, [logs]);

  // 페이지 진입 시 localStorage에서 세션 복원
  useEffect(() => {
    const loaded = loadSessions();
    if (loaded.length > 0) {
      setSessions(loaded);
      setActiveSessionId(loaded[0].id);
      setShowForm(false);
    }
  }, []);

  // 세션 변경 시 자동 저장
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const displayResult = activeSession?.result || result;
  const displayAutoIdentified = activeSession?.autoIdentified || autoIdentified;

  const startNewAnalysis = () => {
    if (running) return;
    setShowForm(true);
    setActiveSessionId(null);
    setResult(null);
    setError("");
    setStage("");
    setLogs([]);
    setProgress(null);
    setAutoIdentified(null);
  };

  const switchSession = (id: string) => {
    if (running) return;
    setActiveSessionId(id);
    setShowForm(false);
    setError("");
  };

  const analyzeMore = () => {
    if (running || !activeSession) return;
    // 기존 세션 호환: query 없으면 현재 폼 값으로 fallback
    const q = activeSession.query || {
      url: activeSession.result.video.url,
      speed: playbackSpeed,
      cutMin,
      cutMax,
      entities: entities.trim(),
      forbid: forbidEntities.trim(),
    };
    const startSkip = activeSession.nextSkip ?? activeSession.result.zones.length;
    if (startSkip >= activeSession.result.summary.hotZoneCount) return;

    esRef.current?.close();
    setRunning(true);
    setStage("starting");
    setProgress(null);
    setLogs([]);
    setError("");

    const sp = new URLSearchParams({
      url: q.url,
      maxZones: "1",
      speed: String(q.speed),
      cutMin: String(q.cutMin),
      cutMax: String(q.cutMax),
      skip: String(startSkip),
    });
    if (q.entities) sp.set("entities", q.entities);
    if (q.forbid) sp.set("forbid", q.forbid);

    const es = new EventSource(`/api/shorts-analyzer/stream?${sp.toString()}`);
    esRef.current = es;

    es.addEventListener("stage", (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      setStage(d.stage);
      if (d.total != null) setProgress({ done: 0, total: d.total });
    });
    es.addEventListener("analyze_progress", (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      setProgress({ done: d.done, total: d.total });
    });
    es.addEventListener("log", (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      setLogs((prev) => [...prev, d.msg]);
    });
    es.addEventListener("result", (ev: MessageEvent) => {
      const r: AnalyzeResult = JSON.parse(ev.data);
      setRunning(false);
      // 기존 세션의 zones에 append (기존 세션 query 없으면 보충)
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeSession.id
            ? {
                ...s,
                result: {
                  ...s.result,
                  zones: [...s.result.zones, ...r.zones],
                  summary: {
                    ...s.result.summary,
                    analyzedZoneCount: s.result.summary.analyzedZoneCount + r.zones.length,
                  },
                },
                query: s.query || q,
                nextSkip: r.nextSkip ?? (s.nextSkip ?? s.result.zones.length) + r.zones.length,
                hasMore: r.hasMore ?? false,
              }
            : s,
        ),
      );
      es.close();
    });
    es.addEventListener("error", (ev) => {
      const me = ev as MessageEvent;
      let msg = "스트리밍 끊김";
      try { if (me.data) msg = JSON.parse(me.data).message || msg; } catch {}
      setError(msg);
      setRunning(false);
      es.close();
    });
  };

  const closeSession = (id: string) => {
    if (running) return;
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (activeSessionId === id) {
        if (next.length > 0) {
          setActiveSessionId(next[0].id);
          setShowForm(false);
        } else {
          setActiveSessionId(null);
          setShowForm(true);
        }
      }
      return next;
    });
  };

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    esRef.current?.close();
    setRunning(true);
    setStage("starting");
    setProgress(null);
    setLogs([]);
    setError("");
    setResult(null);
    setAutoIdentified(null);

    const sp = new URLSearchParams({
      url: url.trim(),
      maxZones: String(maxZones),
      speed: String(playbackSpeed),
      cutMin: String(cutMin),
      cutMax: String(cutMax),
    });
    if (entities.trim()) sp.set("entities", entities.trim());
    if (forbidEntities.trim()) sp.set("forbid", forbidEntities.trim());
    const es = new EventSource(`/api/shorts-analyzer/stream?${sp.toString()}`);
    esRef.current = es;

    es.addEventListener("stage", (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      setStage(d.stage);
      if (d.total != null) setProgress({ done: 0, total: d.total });
    });
    es.addEventListener("analyze_progress", (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      setProgress({ done: d.done, total: d.total });
    });
    es.addEventListener("log", (ev: MessageEvent) => {
      const d = JSON.parse(ev.data);
      setLogs((prev) => [...prev, d.msg]);
    });
    es.addEventListener("identified", (ev: MessageEvent) => {
      setAutoIdentified(JSON.parse(ev.data));
    });
    es.addEventListener("result", (ev: MessageEvent) => {
      const r: AnalyzeResult = JSON.parse(ev.data);
      setResult(r);
      setRunning(false);
      // 새 세션으로 저장
      const newSession: Session = {
        id: (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `s-${Date.now()}`),
        createdAt: Date.now(),
        videoTitle: r.video.title,
        result: r,
        autoIdentified,
        query: {
          url: url.trim(),
          speed: playbackSpeed,
          cutMin,
          cutMax,
          entities: entities.trim(),
          forbid: forbidEntities.trim(),
        },
        nextSkip: r.nextSkip ?? r.zones.length,
        hasMore: r.hasMore ?? false,
      };
      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      setShowForm(false);
      es.close();
    });
    es.addEventListener("error", (ev) => {
      // 두 종류: 우리가 보낸 SSE error 이벤트(데이터 있음) vs EventSource native error
      const me = ev as MessageEvent;
      let msg = "스트리밍 끊김";
      try {
        if (me.data) msg = JSON.parse(me.data).message || msg;
      } catch {}
      setError(msg);
      setRunning(false);
      es.close();
    });
  };

  const stageLabel = (() => {
    if (!running && !result && !error) return "";
    if (stage.startsWith("analyzing") && progress) {
      return `🤖 Gemini로 제작 지시사항 생성 중… (${progress.done}/${progress.total})`;
    }
    // 완전 일치 우선, 없으면 prefix 매칭
    return STAGE_LABEL[stage] || STAGE_LABEL[stage.split(":")[0]] || stage;
  })();

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">🎯 쇼츠 소재 분석</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          유튜브 URL 하나로 댓글 타임스탬프 + Most Replayed 히트맵을 결합해 쇼츠 제작 지시사항을 뽑아냅니다.
        </p>
      </header>

      {/* 탭 바 — 분석한 영상들 */}
      {(sessions.length > 0 || !showForm) && (
        <div className="mb-4 flex items-center gap-1 overflow-x-auto pb-1 border-b border-zinc-200 dark:border-zinc-800">
          {sessions.map((s) => {
            const active = s.id === activeSessionId && !showForm;
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-sm whitespace-nowrap cursor-pointer transition border-b-2 ${
                  active
                    ? "bg-white dark:bg-zinc-900 border-pink-500 text-pink-700 dark:text-pink-300 font-semibold"
                    : "border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                } ${running ? "opacity-50 cursor-not-allowed" : ""}`}
                onClick={() => switchSession(s.id)}
                title={s.videoTitle}
              >
                <span className="max-w-[200px] truncate">{s.videoTitle || "(제목 없음)"}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeSession(s.id);
                  }}
                  disabled={running}
                  className="opacity-50 group-hover:opacity-100 hover:text-red-500 px-1 leading-none"
                  title="이 분석 닫기"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={startNewAnalysis}
            disabled={running}
            className={`px-3 py-1.5 rounded-t-lg text-sm whitespace-nowrap font-medium transition border-b-2 ${
              showForm
                ? "bg-white dark:bg-zinc-900 border-pink-500 text-pink-700 dark:text-pink-300"
                : "border-transparent text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            } ${running ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            + 새 분석
          </button>
        </div>
      )}

      {showForm && (
      <form onSubmit={start} className="mb-4">
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            required
            disabled={running}
            className="flex-1 px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
          <input
            type="number"
            min={1}
            max={10}
            value={maxZones}
            onChange={(e) => setMaxZones(parseInt(e.target.value, 10) || 5)}
            disabled={running}
            title="분석할 핫존 수 (1~10)"
            className="w-20 px-3 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-center"
          />
          <button
            type="submit"
            disabled={running}
            className="px-6 py-2.5 rounded-lg bg-pink-600 hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold"
          >
            {running ? "분석 중…" : "분석 시작"}
          </button>
        </div>

        <details className="bg-zinc-100 dark:bg-zinc-900 rounded-lg px-4 py-3 border border-zinc-200 dark:border-zinc-800 mb-3">
          <summary className="cursor-pointer text-sm font-medium select-none text-zinc-600 dark:text-zinc-400">
            🛠️ 고급: 자동 인물 식별을 오버라이드 (자동이 틀렸을 때만 사용)
          </summary>
          <div className="mt-3 space-y-2">
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              기본적으로 영상 메타·댓글을 기반으로 LLM이 자동으로 등장 인물을 식별합니다. 자동 식별이 틀렸을 때만 아래에 직접 박아 오버라이드 하세요.
            </div>
            <label className="text-sm block">
              <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                ✅ 강제 인물 (쉼표 구분, &quot;이름:역할&quot;). 예: <code className="text-pink-600">조정석:가수, 거미:가수</code>
              </div>
              <input
                type="text"
                value={entities}
                onChange={(e) => setEntities(e.target.value)}
                placeholder="(자동 식별로 충분하면 비워두세요)"
                disabled={running}
                className="w-full px-3 py-2 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm block">
              <div className="text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                🚫 강제 부정 (이 단어는 인물 X). 예: <code className="text-pink-600">보아</code>
              </div>
              <input
                type="text"
                value={forbidEntities}
                onChange={(e) => setForbidEntities(e.target.value)}
                placeholder="(자동 식별로 충분하면 비워두세요)"
                disabled={running}
                className="w-full px-3 py-2 text-sm rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </label>
          </div>
        </details>

        <details className="bg-zinc-100 dark:bg-zinc-900 rounded-lg px-4 py-3 border border-zinc-200 dark:border-zinc-800 mb-3" open>
          <summary className="cursor-pointer text-sm font-medium select-none">
            ⚙️ 출력 설정 — 배속/컷 길이
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <label className="text-sm">
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">출력 배속</div>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
                disabled={running}
                className="w-full px-3 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              >
                <option value={1.0}>1.0× (원본)</option>
                <option value={1.1}>1.1×</option>
                <option value={1.15}>1.15×</option>
                <option value={1.2}>1.2× (권장)</option>
                <option value={1.25}>1.25×</option>
                <option value={1.3}>1.3×</option>
              </select>
            </label>
            <label className="text-sm">
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">원본 컷 최소(초)</div>
              <input
                type="number"
                min={30}
                max={120}
                value={cutMin}
                onChange={(e) => setCutMin(parseInt(e.target.value, 10) || 60)}
                disabled={running}
                className="w-full px-3 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">원본 컷 최대(초)</div>
              <input
                type="number"
                min={35}
                max={150}
                value={cutMax}
                onChange={(e) => setCutMax(parseInt(e.target.value, 10) || 80)}
                disabled={running}
                className="w-full px-3 py-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900"
              />
            </label>
            <div className="col-span-3 text-xs text-zinc-500 dark:text-zinc-400">
              결과 영상 예상 길이:{" "}
              <b>
                {Math.round(cutMin / playbackSpeed)}~{Math.round(cutMax / playbackSpeed)}초
              </b>{" "}
              (원본 {cutMin}~{cutMax}초를 {playbackSpeed}× 배속)
            </div>
          </div>
        </details>

      </form>
      )}

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm">
          ❌ {error}
        </div>
      )}

      {displayAutoIdentified && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300 mb-1.5">
            🔍 자동 식별된 등장 인물
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {displayAutoIdentified.confirmed.length === 0 ? (
              <span className="text-xs text-zinc-500">(식별된 인물 없음)</span>
            ) : (
              displayAutoIdentified.confirmed.map((e, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs bg-white dark:bg-zinc-900 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800"
                >
                  <b>{e.name}</b>
                  {e.role && <span className="text-emerald-500/70">· {e.role}</span>}
                </span>
              ))
            )}
          </div>
          {displayAutoIdentified.forbidden.length > 0 && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              <b>가사 단어 (인물 X)</b>: {displayAutoIdentified.forbidden.join(", ")}
            </div>
          )}
          {displayAutoIdentified.reasoning && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">{displayAutoIdentified.reasoning}</div>
          )}
          <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-1.5">
            💡 잘못됐으면 위 &quot;고급&quot; 박스에서 오버라이드 후 다시 분석.
          </div>
        </div>
      )}

      {(running || stageLabel) && (
        <div className="mb-6 p-4 rounded-lg bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
          <div className="font-semibold text-zinc-800 dark:text-zinc-200 mb-2">{stageLabel}</div>
          {progress && stage.startsWith("analyzing") && (
            <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
              <div
                className="bg-pink-600 h-2 transition-all duration-300"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          )}
          <div
            ref={logBoxRef}
            className="mt-3 max-h-40 overflow-y-auto text-[11px] font-mono text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap"
          >
            {logs.join("\n")}
          </div>
        </div>
      )}

      {displayResult && (
        <>
          <section className="mb-6 p-5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
            <h2 className="font-bold text-lg mb-2">{displayResult.video.title}</h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
              <span>채널 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.video.uploader}</b></span>
              <span>길이 <b className="text-zinc-700 dark:text-zinc-300">{fmtMinSec(displayResult.video.durationSec)}</b></span>
              <span>조회수 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.video.viewCount.toLocaleString()}</b></span>
              <span>댓글 스캔 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.summary.commentsScanned}</b></span>
              <span>타임스탬프 댓글 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.summary.commentsWithTimestamp}</b></span>
              <span>댓글 시그널 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.summary.signalCount}</b></span>
              <span>클러스터 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.summary.commentClusterCount}</b></span>
              <span>히트맵 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.summary.heatmapAvailable ? `${displayResult.summary.heatmapPeakCount}개 피크` : "없음"}</b></span>
              <span>핫존 <b className="text-zinc-700 dark:text-zinc-300">{displayResult.summary.hotZoneCount}</b> (분석 {displayResult.summary.analyzedZoneCount})</span>
            </div>
          </section>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => downloadFile(`shorts-report-${displayResult.video.id}.json`, JSON.stringify(displayResult, null, 2), "application/json")}
              className="px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              📄 JSON 저장
            </button>
            <button
              onClick={() => downloadFile(`shorts-report-${displayResult.video.id}.md`, toMarkdown(displayResult), "text/markdown")}
              className="px-4 py-2 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              📝 마크다운 저장
            </button>
          </div>

          <div className="flex flex-col gap-5">
            {displayResult.zones.map((z, i) => (
              <ZoneCard key={i} z={z} idx={i} videoId={displayResult.video.id} videoUrl={displayResult.video.url} />
            ))}
          </div>

          {activeSession && (() => {
            // 기존 세션 호환: hasMore 필드 없으면 zones 개수로 추정
            const analyzed = displayResult.zones.length;
            const total = displayResult.summary.hotZoneCount;
            const stillMore = activeSession.hasMore ?? analyzed < total;
            return (
              <div className="mt-6 mb-4 flex justify-center">
                {stillMore ? (
                  <button
                    type="button"
                    onClick={analyzeMore}
                    disabled={running}
                    className="px-6 py-3 rounded-lg bg-pink-600 hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold shadow-sm inline-flex items-center gap-2"
                  >
                    {running ? (
                      <>
                        <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        다음 구간 분석 중…
                      </>
                    ) : (
                      <>
                        + 다른 구간 더 찾기 ({analyzed}/{total}개 분석됨)
                      </>
                    )}
                  </button>
                ) : (
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    ✓ 이 영상의 모든 핫존 {total}개 분석 완료
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: ClipSelection["pickVerdict"] }) {
  const map: Record<string, { label: string; bg: string; text: string }> = {
    "강추": { label: "🔥 강추", bg: "bg-pink-600", text: "text-white" },
    "추천": { label: "👍 추천", bg: "bg-emerald-500", text: "text-white" },
    "보류": { label: "⚠️ 보류", bg: "bg-amber-400", text: "text-black" },
    "비추": { label: "🚫 비추", bg: "bg-zinc-500", text: "text-white" },
  };
  const v = map[verdict] || map["보류"];
  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-bold ${v.bg} ${v.text}`}>
      {v.label}
    </span>
  );
}

function PolicyBanner({ risk }: { risk: PolicyRisk }) {
  const labels: Record<keyof Omit<PolicyRisk, "overall" | "overallNote">, string> = {
    children: "아동",
    weapons: "무기",
    violence: "폭력·혐오",
    sexual: "선정",
    politicsReligion: "정치·종교",
    profanity: "욕설",
  };
  const flagged = (Object.keys(labels) as (keyof typeof labels)[])
    .filter((k) => risk[k]?.risk && risk[k].risk !== "none")
    .map((k) => ({ key: k, label: labels[k], item: risk[k] }));
  const tone =
    risk.overall === "block"
      ? "bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
      : "bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300";
  const head = risk.overall === "block" ? "🚫 제작 가이드 위반 가능성 (비추)" : "⚠️ 편집 시 주의";
  return (
    <div className={`mb-4 px-4 py-3 rounded-lg border ${tone}`}>
      <div className="font-bold text-sm mb-1.5">{head}</div>
      {risk.overallNote && <div className="text-xs mb-2">{risk.overallNote}</div>}
      <div className="flex flex-wrap gap-1.5">
        {flagged.map((f) => (
          <span
            key={f.key}
            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${
              f.item.risk === "high"
                ? "bg-red-100 dark:bg-red-900/40 border-red-300 dark:border-red-700"
                : "bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-700"
            }`}
            title={f.item.note}
          >
            {f.item.risk === "high" ? "🔴" : "🟡"} {f.label}
            {f.item.note ? ` — ${f.item.note}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function _UnusedCapcutGuideBlock({ g }: { g: CapcutGuide }) {
  return (
    <FieldBlock label="🎬 캡컷(CapCut) 단계별 가이드">
      <div className="p-4 rounded-lg bg-gradient-to-br from-zinc-50 to-pink-50/40 dark:from-zinc-800/60 dark:to-pink-950/20 border border-pink-200/50 dark:border-pink-900/30 space-y-4">
        <div className="text-sm">
          <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-1">개요</div>
          <p>{g.overview}</p>
        </div>

        {g.referenceMatching && g.referenceMatching !== "레퍼런스 미지정" && (
          <div className="text-sm px-3 py-2 rounded bg-white/60 dark:bg-black/30">
            <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-1">🔗 레퍼런스 매칭</div>
            <p>{g.referenceMatching}</p>
          </div>
        )}

        <div>
          <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-2">📋 작업 순서</div>
          <ol className="space-y-2.5">
            {g.steps.map((s) => (
              <li key={s.step} className="px-3 py-2 rounded bg-white/60 dark:bg-black/30">
                <div className="font-semibold text-sm">{s.title}</div>
                <div className="text-sm mt-1 text-zinc-700 dark:text-zinc-300">{s.action}</div>
                {s.tip && (
                  <div className="text-xs mt-1.5 text-zinc-500 dark:text-zinc-400">💡 {s.tip}</div>
                )}
              </li>
            ))}
          </ol>
        </div>

        {g.capcutEffects.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-2">✨ 캡컷 효과 (Effects)</div>
            <div className="space-y-1.5">
              {g.capcutEffects.map((e, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr] gap-3 items-start px-3 py-2 rounded bg-white/60 dark:bg-black/30">
                  <div className="font-mono text-xs text-pink-600 font-semibold">{e.atSec}s</div>
                  <div className="text-sm">
                    <div className="font-semibold">{e.name}</div>
                    <div className="text-xs font-mono text-zinc-500 mt-0.5">📂 {e.where}</div>
                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">{e.how}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {g.textAnimations.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-2">🔤 자막 애니메이션 (Text Animations)</div>
            <div className="space-y-1.5">
              {g.textAnimations.map((t, i) => (
                <div key={i} className="grid grid-cols-[80px_1fr] gap-3 items-start px-3 py-2 rounded bg-white/60 dark:bg-black/30">
                  <div className="font-mono text-xs text-pink-600 font-semibold">{t.atSec}s</div>
                  <div className="text-sm">
                    <div className="font-semibold">&quot;{t.text}&quot;</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      In: <b>{t.enter}</b> · Loop: <b>{t.loop}</b> · Out: <b>{t.exit}</b>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-3">
          <div className="px-3 py-2 rounded bg-white/60 dark:bg-black/30">
            <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-1">⚡ 속도 (Speed)</div>
            <p className="text-sm">{g.speedRamp}</p>
          </div>
          <div className="px-3 py-2 rounded bg-white/60 dark:bg-black/30">
            <div className="text-xs font-semibold text-pink-600 dark:text-pink-400 mb-1">🎯 키프레임 애니메이션</div>
            <p className="text-sm">{g.keyframeAnimations}</p>
          </div>
        </div>
      </div>
    </FieldBlock>
  );
}

function _UnusedClipSelectionBlock({ sel }: { sel: ClipSelection }) {
  const Check = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <span className="inline-flex items-center gap-1 text-sm">
      <span className={ok ? "text-emerald-600" : "text-zinc-400"}>{ok ? "✓" : "✗"}</span>
      <span className={ok ? "" : "text-zinc-500 line-through"}>{children}</span>
    </span>
  );
  const ageLabel = { high: "🟢 잘 맞음", medium: "🟡 보통", low: "🔴 약함" }[sel.targetAgeFit] || sel.targetAgeFit;
  return (
    <FieldBlock label="클립 선정 적합도 (제작 가이드 기준)">
      <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 space-y-2">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Check ok={sel.fitsUnder60s}>1분 내외로 추리기 가능</Check>
          <Check ok={sel.hookableInFirst3s}>첫 3초 후크 가능</Check>
          <span className="text-sm">🎯 20~40대 적합도: <b>{ageLabel}</b></span>
        </div>
        {sel.targetAgeReason && (
          <div className="text-xs text-zinc-500">└ {sel.targetAgeReason}</div>
        )}
        <div className="text-sm">
          <span className="text-zinc-500">🪝 다음 장면이 궁금해지는 흐름:</span>{" "}
          <span>{sel.retentionDriver}</span>
        </div>
        <div className="text-sm mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700">
          <span className="text-zinc-500">판정 근거:</span>{" "}
          <span>{sel.pickReason}</span>
        </div>
      </div>
    </FieldBlock>
  );
}

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "good" | "warn" }) {
  const tones = {
    default: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700",
    good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800",
    warn: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300 dark:border-amber-800",
  } as const;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium border ${tones[tone]}`}>
      {children}
    </span>
  );
}

function ZoneCard({ z, idx, videoId, videoUrl }: { z: ZoneResult; idx: number; videoId: string; videoUrl: string }) {
  const a = z.analysis;
  const borderColor = z.kind === "heatmap-only" ? "border-l-blue-500" : "border-l-pink-500";
  const [clipState, setClipState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [clipError, setClipError] = useState<string>("");

  const downloadClip = async () => {
    if (!a?.optimalCut) return;
    setClipState("running");
    setClipError("");
    try {
      const resp = await fetch("/api/shorts-analyzer/clip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: videoUrl,
          videoId,
          startSec: Math.round(a.optimalCut.startSec),
          endSec: Math.round(a.optimalCut.endSec),
          label: a.thumbnailText || `zone${idx + 1}`,
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${resp.status}`);
      }
      const blob = await resp.blob();
      const cd = resp.headers.get("Content-Disposition") || "";
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m?.[1] || `clip-${videoId}-${idx + 1}.mp4`;
      const dlUrl = URL.createObjectURL(blob);
      const a2 = document.createElement("a");
      a2.href = dlUrl;
      a2.download = filename;
      document.body.appendChild(a2);
      a2.click();
      a2.remove();
      URL.revokeObjectURL(dlUrl);
      setClipState("done");
    } catch (e) {
      setClipError((e as Error).message);
      setClipState("error");
    }
  };

  return (
    <article className={`relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 border-l-4 ${borderColor}`}>
      {/* 1. 헤더 — 한 줄만 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-xl font-extrabold text-pink-600">#{idx + 1}</span>
        {a?.clipSelection?.pickVerdict && <VerdictBadge verdict={a.clipSelection.pickVerdict} />}
        <a
          href={`https://youtu.be/${videoId}?t=${z.centerSec}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-bold inline-flex items-center gap-1 hover:underline"
        >
          📍 <span className="text-pink-600">{z.centerLabel}</span>
          <span className="text-xs text-zinc-400 font-normal ml-1">↗ 영상에서 보기</span>
        </a>
        {z.heatmapOverlap && <Badge tone="good">Most Replayed</Badge>}
      </div>

      {!a ? (
        <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm">
          분석 실패: {z.analysisError || "알 수 없음"}
        </div>
      ) : (
        <>
          {/* 정책 위반 시만 */}
          {a.policyRisk && a.policyRisk.overall !== "safe" && (
            <PolicyBanner risk={a.policyRisk} />
          )}

          {/* 2. 왜 통하는가 — 한 줄 */}
          <div className="mb-4 px-3 py-2 bg-zinc-50 dark:bg-zinc-800/60 border-l-2 border-pink-400 rounded text-sm">
            {a.whyItWorks}
          </div>

          {/* 3. 컷 시간 + 다운로드 */}
          <div className="mb-4 p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <div className="text-xs text-emerald-700 dark:text-emerald-400 mb-2 font-semibold">
              ✂️ 영상에서 이 구간을 잘라 쓰세요
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`https://youtu.be/${videoId}?t=${Math.round(a.optimalCut.startSec)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xl font-bold hover:underline inline-flex items-center gap-1"
              >
                <span className="text-emerald-700 dark:text-emerald-400">{fmtMinSec(Math.round(a.optimalCut.startSec))}</span>
                <span className="text-zinc-400">~</span>
                <span className="text-emerald-700 dark:text-emerald-400">{fmtMinSec(Math.round(a.optimalCut.endSec))}</span>
                <span className="text-sm font-sans text-zinc-500 ml-1">
                  ({Math.round(a.optimalCut.endSec - a.optimalCut.startSec)}초)
                </span>
              </a>
              <button
                type="button"
                onClick={downloadClip}
                disabled={clipState === "running"}
                className="ml-auto px-4 py-2 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold inline-flex items-center gap-1.5"
              >
                {clipState === "running" ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    자르는 중…
                  </>
                ) : clipState === "done" ? (
                  <>✓ 다시 다운로드</>
                ) : (
                  <>📥 mp4 다운로드</>
                )}
              </button>
            </div>
            {clipState === "running" && (
              <div className="text-xs text-emerald-600 mt-2">
                첫 다운로드는 1~2분 (원본 영상 받는 중), 이후는 5~15초.
              </div>
            )}
            {clipState === "error" && (
              <div className="text-xs text-red-600 mt-2">❌ {clipError}</div>
            )}
          </div>

          {/* 4. 제목 후보 */}
          <div className="mb-4 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/60">
            <div className="text-[10px] tracking-widest uppercase text-zinc-500 dark:text-zinc-400 mb-1.5">
              📝 제목 후보
            </div>
            <ul className="space-y-1 text-sm font-medium">
              {a.titleCandidates.map((t, i) => (
                <li key={i} className="px-2 py-1 rounded bg-white dark:bg-zinc-900">
                  {t}
                </li>
              ))}
            </ul>
          </div>

          {/* 4.5. 추천 내레이션 (음성 공백 자동 배치) */}
          {a.narrationPlan && a.narrationPlan.segments.length > 0 && (
            <div className="mb-4 p-4 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-sm font-bold text-purple-700 dark:text-purple-300">
                  💭 내레이션 {a.narrationPlan.segments.length}개 (음성 공백 자리에 자동 배치)
                </span>
              </div>
              <div className="space-y-2.5">
                {a.narrationPlan.segments.map((seg, i) => {
                  const absStart = Math.round(a.optimalCut.startSec + seg.insertAtSec);
                  const absEnd = Math.round(absStart + seg.durationSec);
                  return (
                    <div key={i} className="px-3 py-2.5 rounded bg-white dark:bg-zinc-900 border border-purple-200/50 dark:border-purple-900/40">
                      <div className="flex items-baseline gap-2 mb-1.5 flex-wrap">
                        <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                          {seg.role}
                        </span>
                        <span className="text-xs font-mono">
                          <span className="text-purple-600 font-bold">쇼츠 {seg.insertAtSec}s~{(seg.insertAtSec + seg.durationSec).toFixed(1)}s</span>
                          <span className="text-zinc-400 mx-1.5">/</span>
                          <a
                            href={`https://youtu.be/${videoId}?t=${absStart}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-zinc-600 dark:text-zinc-400 hover:underline"
                            title="원본 영상에서 이 시점 열기"
                          >
                            원본 {fmtMinSec(absStart)}~{fmtMinSec(absEnd)} ↗
                          </a>
                        </span>
                        <span className="text-[10px] text-zinc-400">({seg.durationSec}초)</span>
                      </div>
                      <div className="text-base font-semibold mb-1.5 leading-relaxed">
                        &quot;{seg.script}&quot;
                      </div>
                      {seg.captionLines.length > 0 && (
                        <div className="space-y-0.5">
                          {seg.captionLines.map((line, j) => (
                            <div key={j} className="text-xs px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 inline-block mr-1">
                              {line}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="text-xs space-y-1 text-zinc-600 dark:text-zinc-400 mt-3 pt-2 border-t border-purple-200/50 dark:border-purple-800/30">
                <div><b className="text-zinc-500">🎙️ TTS:</b> {a.narrationPlan.voiceStyle}</div>
                <div><b className="text-zinc-500">🔉 BGM 덕킹:</b> {a.narrationPlan.bgmDucking}</div>
                <div className="text-zinc-500 italic">💡 {a.narrationPlan.rationale}</div>
              </div>
            </div>
          )}

          {/* 5. 캡컷 가이드 — 자막 / 효과 / 속도만 */}
          {a.capcutGuide && (
            <div className="mb-4 p-4 rounded-lg bg-gradient-to-br from-pink-50 to-zinc-50 dark:from-pink-950/20 dark:to-zinc-900 border border-pink-200 dark:border-pink-900/40">
              <div className="text-sm font-bold text-pink-700 dark:text-pink-400 mb-3">
                🎬 캡컷에서 이렇게 만드세요
              </div>

              {a.capcutGuide.capcutEffects.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5">✨ 효과</div>
                  <div className="space-y-1">
                    {a.capcutGuide.capcutEffects.map((e, i) => (
                      <div key={i} className="flex flex-wrap items-baseline gap-2 px-3 py-1.5 rounded bg-white/70 dark:bg-black/30 text-sm">
                        <span className="font-mono text-xs text-pink-600 font-bold min-w-[40px]">{e.atSec}s</span>
                        <span className="font-semibold">{e.name}</span>
                        <span className="text-xs text-zinc-500 font-mono">📂 {e.where}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-sm px-3 py-1.5 rounded bg-white/70 dark:bg-black/30">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">⚡ 속도: </span>
                {a.capcutGuide.speedRamp}
              </div>
            </div>
          )}

          {/* 6. 추가 팁 (접힘) */}
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-xs">
              💡 추가 팁 (오프닝/엔딩/페이싱)
            </summary>
            <div className="mt-2 p-3 rounded bg-zinc-50 dark:bg-zinc-800/60 space-y-2 text-sm">
              <div><b className="text-zinc-500 text-xs">오프닝 (0~3초):</b> {a.productionGuide.openingHook}</div>
              <div><b className="text-zinc-500 text-xs">편집 호흡:</b> {a.productionGuide.pacingNotes}</div>
              <div><b className="text-zinc-500 text-xs">엔딩 (마지막 1~2초):</b> {a.productionGuide.endingHook}</div>
              {a.productionGuide.bRoll && a.productionGuide.bRoll !== "불필요" && (
                <div><b className="text-zinc-500 text-xs">B-roll:</b> {a.productionGuide.bRoll}</div>
              )}
            </div>
          </details>

          {z.pickedComments.length > 0 && (
            <details className="mt-1 text-sm">
              <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 text-xs">
                💬 지목한 댓글 {z.pickedComments.length}개
              </summary>
              <ul className="mt-2 px-3 py-2 rounded bg-zinc-50 dark:bg-zinc-800/60 space-y-1 text-xs">
                {z.pickedComments.slice(0, 8).map((c, i) => (
                  <li key={i}>
                    &quot;{c.text}&quot; <span className="text-zinc-400">(♥ {c.likes})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] tracking-widest uppercase text-zinc-500 dark:text-zinc-400 mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}

function _UnusedGuide({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1">{title}</h4>
      <p className="text-sm">{children}</p>
    </div>
  );
}

function GuideBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1.5">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function TimelineRow({ when, what, sub }: { when: string; what: string; sub: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 items-start px-3 py-2 rounded bg-white/60 dark:bg-black/30">
      <div className="font-mono text-xs text-pink-600 font-semibold">{when}</div>
      <div className="text-sm">
        {what}
        {sub && <div className="text-xs text-zinc-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}
