// Replicate HTTP API — raw fetch, no SDK
// 참고: https://replicate.com/docs/reference/http

const REPLICATE_API = "https://api.replicate.com/v1";

function getToken(): string {
  const t = process.env.REPLICATE_API_TOKEN;
  if (!t) throw new Error("REPLICATE_API_TOKEN이 .env.local에 설정되지 않았습니다.");
  return t;
}

// ── 파일 업로드 ─────────────────────────────────────────────────────────
// Replicate에 파일을 올리면 prediction에서 쓸 수 있는 URL을 받음.
// (모델이 알아서 GET해서 받아감)
export async function uploadFile(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<{ url: string; id: string }> {
  const token = getToken();
  const form = new FormData();
  form.append(
    "content",
    new Blob([new Uint8Array(buffer)], { type: contentType }),
    filename,
  );

  const res = await fetch(`${REPLICATE_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Replicate file upload 실패: ${res.status} ${text}`);
  }
  const json = await res.json();
  return { url: json.urls?.get as string, id: json.id as string };
}

// ── Prediction 생성 ─────────────────────────────────────────────────────
export type PredictionResponse = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[] | string | null;
  error?: string | null;
  logs?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  metrics?: { predict_time?: number };
};

export async function createPrediction({
  modelOwner,
  modelName,
  version,
  input,
}: {
  modelOwner?: string;
  modelName?: string;
  version?: string;
  input: Record<string, unknown>;
}): Promise<PredictionResponse> {
  const token = getToken();

  const url = version
    ? `${REPLICATE_API}/predictions`
    : `${REPLICATE_API}/models/${modelOwner}/${modelName}/predictions`;
  const body: Record<string, unknown> = { input };
  if (version) body.version = version;

  // 429 (rate limit) 자동 재시도 — retry_after 헤더/바디 존중
  const MAX_ATTEMPTS = 6;
  let lastErr: string = "";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "wait=1",
      },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      const retryAfter =
        typeof data?.retry_after === "number"
          ? (data.retry_after as number)
          : parseInt(res.headers.get("Retry-After") || "10", 10);
      // 안전 마진 1초
      const waitMs = (Math.max(1, retryAfter) + 1) * 1000;
      console.warn(
        `[replicate] 429 throttled, attempt ${attempt + 1}/${MAX_ATTEMPTS} — waiting ${waitMs}ms`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      lastErr = (data?.detail as string) || "429 throttled";
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Replicate prediction 생성 실패: ${res.status} ${text}`);
    }
    return (await res.json()) as PredictionResponse;
  }

  throw new Error(
    `Replicate prediction 생성 실패: 429 rate limit 재시도 한계 초과 (${lastErr}). https://replicate.com/account/billing 에서 잔액 추가 시 한도 완화됨.`,
  );
}

// ── Prediction 상태 조회 ────────────────────────────────────────────────
export async function getPrediction(id: string): Promise<PredictionResponse> {
  const token = getToken();
  const res = await fetch(`${REPLICATE_API}/predictions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Replicate prediction 조회 실패: ${res.status}`);
  }
  return (await res.json()) as PredictionResponse;
}

// ── ProPainter (jd7h/propainter) 입력 타입 ─────────────────────────────
export type ProPainterInput = {
  video: string; // URL
  mask: string;  // URL — 정적 이미지 OK (PNG/JPG)
  mode?: "video_inpainting" | "video_outpainting";
  fp16?: boolean;
  mask_dilation?: number;
  resize_ratio?: number;
  save_fps?: number;
  width?: number;
  height?: number;
  neighbor_length?: number;  // 로컬 이웃 프레임 개수 (default 10)
  raft_iter?: number;        // RAFT optical flow 반복 (default 20)
  ref_stride?: number;       // 글로벌 reference 프레임 stride (default 10)
  subvideo_length?: number;  // 서브비디오 길이 (default 80)
};

// 2026-06 기준 latest version (Replicate model API에서 직접 확인)
export const PROPAINTER_VERSION =
  "e5ea7ae04e97c96a0e14c70d8e4cb899abdf326a377c01f1c10966ccd6c6bae4";
