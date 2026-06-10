// Modal Labs HTTP API 클라이언트
// 배포된 endpoint 3개 (start/status/result) 호출

const START_URL = process.env.MODAL_START_URL;
const STATUS_URL = process.env.MODAL_STATUS_URL;
const RESULT_URL = process.env.MODAL_RESULT_URL;

function checkEnv() {
  if (!START_URL || !STATUS_URL || !RESULT_URL) {
    throw new Error(
      "MODAL_START_URL / MODAL_STATUS_URL / MODAL_RESULT_URL이 .env.local에 설정되지 않았습니다.",
    );
  }
}

export type ModalJobStatus = "running" | "done" | "failed" | "expired";

/**
 * Modal에 처리 작업 시작.
 * @returns jobId (Modal FunctionCall ID)
 */
export async function startModalJob(videoUrl: string): Promise<string> {
  checkEnv();
  const res = await fetch(START_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video_url: videoUrl }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal start 실패 ${res.status}: ${text}`);
  }
  const data = await res.json();
  if (data?.error) {
    throw new Error(`Modal start 오류: ${data.error}`);
  }
  if (!data?.job_id) {
    throw new Error("Modal start: job_id가 응답에 없습니다.");
  }
  return data.job_id as string;
}

/** Modal 작업 상태 조회. */
export async function getModalJobStatus(jobId: string): Promise<{
  status: ModalJobStatus;
  sizeBytes?: number;
  error?: string;
}> {
  checkEnv();
  const url = new URL(STATUS_URL!);
  url.searchParams.set("job_id", jobId);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal status 실패 ${res.status}: ${text}`);
  }
  const data = await res.json();
  return {
    status: (data?.status as ModalJobStatus) || "failed",
    sizeBytes: data?.size_bytes,
    error: data?.error,
  };
}

/**
 * Modal 결과 영상 다운로드 → Buffer 반환.
 * 한 번만 호출 (큰 파일).
 */
export async function fetchModalResult(jobId: string): Promise<Buffer> {
  checkEnv();
  const url = new URL(RESULT_URL!);
  url.searchParams.set("job_id", jobId);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal result 다운로드 실패 ${res.status}: ${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}
