"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── 타입 ───────────────────────────────────────────────────────────────
type VideoMeta = {
  width: number;
  height: number;
  durationSec: number;
  fps?: number;
};

type JobStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

type StartResult = {
  jobId: string;
  predictionId: string;
  status: string;
  videoMeta: VideoMeta;
};

type PollResult = {
  jobId: string;
  predictionId: string;
  status: JobStatus | "expired";
  originalFilename: string | null;
  error: string | null;
  videoMeta: VideoMeta | null;
  fileUrl: string | null;
  fileSize: number | null;
  expiresAt: string | null;
  isExpired: boolean;
  completedAt: string | null;
  savedAt: string | null;
};

type JobRow = {
  jobId: string;
  predictionId: string;
  status: JobStatus | "expired";
  originalFilename: string | null;
  originalSize: number | null;
  error: string | null;
  videoMeta: VideoMeta | null;
  fileUrl: string | null;
  fileSize: number | null;
  expiresAt: string | null;
  isExpired: boolean;
  createdAt: string;
  completedAt: string | null;
  savedAt: string | null;
};

// ── 헬퍼 ───────────────────────────────────────────────────────────────
function fmtSec(sec: number | null): string {
  if (sec === null || sec === undefined) return "—";
  return `${sec.toFixed(1)}s`;
}

function fmtBytes(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtRemaining(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "만료됨";
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}시간 ${minutes}분 후 삭제`;
  return `${minutes}분 후 삭제`;
}

// ───────────────────────────────────────────────────────────────────────
export default function EraseSubtitlePage() {
  const [tab, setTab] = useState<"new" | "history">("new");

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">🇨🇳 자막 자동 제거</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          영상에 박힌 <strong>중국어 하드코딩 자막</strong>을 매 프레임마다 자동
          감지(PaddleOCR) + LaMa로 제거. <strong>박스 그릴 필요 없음</strong>{" "}
          — 업로드만 하면 끝.
        </p>
      </div>

      <div className="flex gap-1 mb-5 border-b border-zinc-200 dark:border-zinc-800">
        <button
          onClick={() => setTab("new")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "new"
              ? "border-red-500 text-red-600 dark:text-red-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          새 작업
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
            tab === "history"
              ? "border-red-500 text-red-600 dark:text-red-400"
              : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          이전 작업
        </button>
      </div>

      {tab === "new" ? <NewJobTab /> : <HistoryTab />}
    </div>
  );
}

// ── 새 작업 ────────────────────────────────────────────────────────────
function NewJobTab() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"idle" | "starting" | "processing">("idle");
  const [error, setError] = useState("");
  const [start, setStart] = useState<StartResult | null>(null);
  const [poll, setPoll] = useState<PollResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (busy !== "processing") return;
    const id = setInterval(() => {
      if (startedAtRef.current) {
        setElapsed((Date.now() - startedAtRef.current) / 1000);
      }
    }, 200);
    return () => clearInterval(id);
  }, [busy]);

  useEffect(() => {
    if (busy !== "processing" || !start?.jobId) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/erase-subtitle/poll?jobId=${start.jobId}`,
        );
        const json = (await res.json()) as PollResult;
        if (stopped) return;
        setPoll(json);
        if (
          json.status === "succeeded" ||
          json.status === "failed" ||
          json.status === "canceled"
        ) {
          setBusy("idle");
        }
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : "폴링 오류");
      }
    };
    void tick();
    const id = setInterval(() => {
      if (!stopped) void tick();
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [busy, start?.jobId]);

  async function handleStart() {
    if (!file) {
      setError("영상 파일을 선택해주세요.");
      return;
    }
    setBusy("starting");
    setError("");
    setStart(null);
    setPoll(null);
    setElapsed(0);

    try {
      const fd = new FormData();
      fd.append("video", file);
      const res = await fetch("/api/erase-subtitle/start", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "시작 실패");
        setBusy("idle");
        return;
      }
      setStart(json as StartResult);
      startedAtRef.current = Date.now();
      setBusy("processing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 오류");
      setBusy("idle");
    }
  }

  function reset() {
    setFile(null);
    setStart(null);
    setPoll(null);
    setError("");
    setBusy("idle");
    setElapsed(0);
    startedAtRef.current = null;
  }

  const isStarting = busy === "starting";
  const isProcessing = busy === "processing";

  return (
    <>
      {!start && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 mb-6">
          <label className="block text-sm font-medium mb-2">영상 파일</label>
          <input
            type="file"
            accept="video/*"
            disabled={isStarting}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setError("");
            }}
            className="block w-full text-sm text-zinc-600 dark:text-zinc-300 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-red-500 file:text-white hover:file:bg-red-600 file:cursor-pointer"
          />
          {file && (
            <p className="mt-2 text-xs text-zinc-500">
              {file.name} · {(file.size / 1024 / 1024).toFixed(1)}MB
            </p>
          )}

          <button
            onClick={handleStart}
            disabled={isStarting || !file}
            className="mt-5 w-full py-2.5 rounded-lg bg-red-500 text-white font-medium hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isStarting
              ? "업로드 + Modal 호출 중…"
              : "🪄 자막 제거 시작"}
          </button>

          {error && (
            <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <div className="mt-5 pt-4 border-t border-zinc-100 dark:border-zinc-800 text-xs text-zinc-500 leading-relaxed">
            💡 흐름: ① 업로드 → ② Modal 서버리스 GPU에서 PaddleOCR로 매
            프레임 한자 자동 감지 → ③ LaMa로 정밀 inpainting → ④ 결과 로컬
            저장
            <br />
            영상 1개당 비용 ≈ <strong>20~50원 (Modal A10G)</strong>
            <br />
            <strong>박스 그릴 필요 없음</strong> · 자막 위치 자동 추적
          </div>
        </section>
      )}

      {start && (
        <ProgressView
          start={start}
          poll={poll}
          isProcessing={isProcessing}
          elapsed={elapsed}
          onReset={reset}
        />
      )}
    </>
  );
}

// ── 진행 상태 + 결과 ───────────────────────────────────────────────────
function ProgressView({
  start,
  poll,
  isProcessing,
  elapsed,
  onReset,
}: {
  start: StartResult;
  poll: PollResult | null;
  isProcessing: boolean;
  elapsed: number;
  onReset: () => void;
}) {
  return (
    <section className="space-y-5">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <StatusDot status={poll?.status || "starting"} />
          <div>
            <div className="text-sm font-semibold">
              {poll?.status === "succeeded"
                ? "✅ 완료 — 로컬에 저장됨"
                : poll?.status === "failed"
                  ? "❌ 실패"
                  : poll?.status === "canceled"
                    ? "⏹ 취소됨"
                    : isProcessing
                      ? "🎨 Modal에서 처리 중…"
                      : "⏳ 시작 중"}
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {isProcessing && `${elapsed.toFixed(1)}초 경과`}
              {!isProcessing &&
                poll?.completedAt &&
                ` · ${fmtDateTime(poll.completedAt)}`}
            </div>
          </div>
          <button
            onClick={onReset}
            className="ml-auto text-xs text-zinc-400 hover:text-rose-500"
          >
            새 영상으로
          </button>
        </div>

        {poll?.error && (
          <div className="text-xs text-rose-600 dark:text-rose-400 mb-3 p-2 rounded bg-rose-50 dark:bg-rose-950/30 whitespace-pre-wrap">
            {poll.error}
          </div>
        )}

        <div className="text-sm space-y-2">
          <Row
            label="영상"
            value={`${start.videoMeta.width}×${start.videoMeta.height} · ${fmtSec(start.videoMeta.durationSec)}${
              start.videoMeta.fps
                ? ` · ${start.videoMeta.fps}fps (총 ${Math.round(
                    start.videoMeta.durationSec * start.videoMeta.fps,
                  )}프레임)`
                : ""
            }`}
          />
          <Row label="Job ID" value={start.jobId} mono />
          <Row label="Modal Job ID" value={start.predictionId} mono />
        </div>
      </div>

      {poll?.status === "succeeded" && poll.fileUrl && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3 gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">🎬 결과 영상</h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {fmtBytes(poll.fileSize)} · 24시간 임시 보관 (
                <strong className="text-amber-600 dark:text-amber-400">
                  {fmtRemaining(poll.expiresAt)}
                </strong>
                )
              </p>
            </div>
            <a
              href={`${poll.fileUrl}?dl=1`}
              className="shrink-0 text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
            >
              📥 지금 다운로드
            </a>
          </div>
          <video
            src={poll.fileUrl}
            controls
            playsInline
            className="max-w-[320px] w-full mx-auto rounded-lg bg-black"
          />
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            ⚠️ 24시간 후 자동 삭제됩니다. 필요한 영상은 지금 다운받아두세요.
          </p>
        </div>
      )}

      {poll?.status === "expired" && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl p-5 text-sm text-amber-700 dark:text-amber-300">
          ⏰ 24시간이 지나 결과 영상이 자동 삭제됐어요. 영상을 다시 업로드해서
          처리해주세요.
        </div>
      )}
    </section>
  );
}

// ── 히스토리 ────────────────────────────────────────────────────────────
function HistoryTab() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/erase-subtitle/jobs?limit=50");
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || "조회 실패");
        } else {
          setJobs(json.jobs || []);
          setError("");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "조회 실패");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const reload = useCallback(() => {
    setLoading(true);
    setRefreshKey((k) => k + 1);
  }, []);

  async function handleDelete(jobId: string, filename: string | null) {
    if (
      !confirm(
        `"${filename || jobId}" 작업을 삭제할까요? 로컬 파일도 같이 지워져요.`,
      )
    )
      return;
    await fetch(`/api/erase-subtitle/jobs?id=${jobId}`, { method: "DELETE" });
    reload();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">최근 작업 {jobs.length}개</p>
        <button
          onClick={reload}
          className="text-xs text-zinc-400 hover:text-red-500"
        >
          새로고침
        </button>
      </div>

      {error && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-zinc-400 text-sm">
          불러오는 중…
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-zinc-400 text-sm">
          아직 작업한 영상이 없어요.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <JobCard key={j.jobId} job={j} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  onDelete,
}: {
  job: JobRow;
  onDelete: (id: string, filename: string | null) => void;
}) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center gap-3 text-xs">
        <StatusDot status={job.status} />
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">
          {job.status === "succeeded"
            ? "완료"
            : job.status === "failed"
              ? "실패"
              : job.status === "canceled"
                ? "취소"
                : "진행 중"}
        </span>
        <span className="text-zinc-400">·</span>
        <span className="text-zinc-500">{fmtDateTime(job.createdAt)}</span>
      </div>

      <div className="text-sm font-medium truncate">
        {job.originalFilename || "(이름 없음)"}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
        {job.videoMeta && (
          <span>
            {job.videoMeta.width}×{job.videoMeta.height} ·{" "}
            {fmtSec(job.videoMeta.durationSec)}
          </span>
        )}
        {job.fileSize && <span>📦 {fmtBytes(job.fileSize)}</span>}
      </div>

      {job.error && (
        <div
          className="text-xs text-rose-600 dark:text-rose-400 truncate"
          title={job.error}
        >
          ⚠ {job.error}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 flex-wrap">
        {job.fileUrl && job.status === "succeeded" && !job.isExpired ? (
          <>
            <a
              href={job.fileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs px-3 py-1.5 rounded border border-zinc-200 dark:border-zinc-800 hover:border-red-300 dark:hover:border-red-700"
            >
              ▶ 재생
            </a>
            <a
              href={`${job.fileUrl}?dl=1`}
              className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600"
            >
              📥 다운로드
            </a>
            {job.expiresAt && (
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                ⏰ {fmtRemaining(job.expiresAt)}
              </span>
            )}
          </>
        ) : job.isExpired ? (
          <span className="text-xs px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300">
            ⏰ 만료됨 (24h 경과)
          </span>
        ) : (
          <span className="text-xs text-zinc-400">파일 없음</span>
        )}
        <button
          onClick={() => onDelete(job.jobId, job.originalFilename)}
          className="ml-auto text-xs text-zinc-400 hover:text-rose-500"
        >
          삭제
        </button>
      </div>
    </div>
  );
}

// ── 공통 ───────────────────────────────────────────────────────────────
function StatusDot({ status }: { status: string }) {
  const color =
    status === "succeeded"
      ? "bg-emerald-500"
      : status === "failed" || status === "canceled"
        ? "bg-rose-500"
        : "bg-amber-500 animate-pulse";
  return <div className={`w-2.5 h-2.5 rounded-full ${color}`} />;
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="text-zinc-500 shrink-0 w-24">{label}</span>
      <span
        className={`text-zinc-700 dark:text-zinc-200 break-all ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
