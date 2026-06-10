import { NextRequest, NextResponse } from "next/server";
import type { Part } from "@google/genai";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getGeminiClient, FLASH_FULL_MODEL, withRetry } from "@/lib/gemini";
import {
  SCRIPT_SCHEMA,
  AGGRO_TITLE_RULES,
  TONE_RULES,
  CURIOSITY_LOOP_RULES,
  koreanizeYoche,
} from "@/lib/shorts-prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

const execFileAsync = promisify(execFile);

const MAX_BYTES = 300 * 1024 * 1024; // 300MB 업로드 상한
const SAMPLE_TARGET = 120; // 1차 추출 프레임 상한 (긴 영상은 fps를 낮춤)
const MAX_FRAMES = 30; // Gemini에 보낼 최종 프레임 상한
const DEDUP_HAMMING = 10; // dHash 해밍 거리 — 이하면 중복으로 간주
const FRAME_WIDTH = 512; // Gemini에 보낼 프레임 가로 해상도

// ── ffmpeg / ffprobe 경로 해석 (macOS GUI 프로세스는 PATH가 비어있을 수 있음) ──
let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;

async function resolveBinary(
  envVar: string,
  bin: string,
  candidates: string[],
): Promise<string> {
  if (process.env[envVar]) return process.env[envVar] as string;
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return bin; // PATH에 있길 기대
}

async function getFfmpeg(): Promise<string> {
  if (!ffmpegPath) {
    ffmpegPath = await resolveBinary("FFMPEG_PATH", "ffmpeg", [
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ]);
  }
  return ffmpegPath;
}

async function getFfprobe(): Promise<string> {
  if (!ffprobePath) {
    ffprobePath = await resolveBinary("FFPROBE_PATH", "ffprobe", [
      "/opt/homebrew/bin/ffprobe",
      "/usr/local/bin/ffprobe",
      "/usr/bin/ffprobe",
    ]);
  }
  return ffprobePath;
}

async function probeDurationSec(input: string): Promise<number> {
  try {
    const ffprobe = await getFfprobe();
    const { stdout } = await execFileAsync(ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      input,
    ]);
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

// 9x8 그레이스케일 → dHash (64bit), 행마다 가로로 인접 픽셀 비교
function dHash(gray: Buffer, offset: number): boolean[] {
  const bits: boolean[] = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const left = gray[offset + r * 9 + c];
      const right = gray[offset + r * 9 + c + 1];
      bits.push(left > right);
    }
  }
  return bits;
}

function hamming(a: boolean[], b: boolean[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function buildVisionPrompt(hint: string): string {
  return `당신은 **쇼츠 retention 마스터**이자 영상 분석가입니다.

아래 이미지들은 **하나의 영상에서 시간 순서대로 추출한 프레임들**입니다.
(중복/유사 장면은 미리 제거됐어요. 첫 번째가 영상 시작, 마지막이 영상 끝.)
이 프레임들만 보고 **원본 영상에서 무슨 일이 일어났는지** 분석한 뒤, 그걸 소재로 **짧고 강한 쇼츠 대본**을 짭니다.

${hint ? `## 참고 (사용자가 준 힌트 — 방향 참고만, 없는 사실 지어내기 금지)\n${hint}\n` : ""}
## 🎯🎯 0순위: 후킹 (이게 제일 중요)
- **씬 1 첫 문장에서 시청자를 0.5초 만에 멈춰 세워라.** 잔잔한 도입·설명 ❌.
- 가장 충격적이거나 의아한 장면/순간을 **맨 앞에 던지고** 시작 — "이거 보세요", "잠깐, 이게 뭐죠?", "여기서 사고가..." 같은 즉발성 후크.
- 첫 문장은 짧게 (15자 내외) 끊고, 궁금증을 폭탄처럼 터뜨릴 것.
- 1초라도 지루하면 실패. 첫 씬은 "스크롤 멈춤" 전용.

## ✂️ 분량 — 쇼츠 적정 길이
- **각 씬 65~95자**. TTS로 8초 정도에 읽히는 분량. 군더더기·수식어는 쳐내되 내용은 충분히.
- 한 씬에 핵심 1~2개. 문장은 짧게 끊어 호흡은 빠르게, 그래도 알맹이는 담을 것.
- 전체 4씬 × 8초 ≈ 32초.

## 🚨 절대 규칙
1. **프레임에서 실제로 보이는 것만 사용**. 안 보이는 사실/대사/숫자 지어내지 말 것.
2. 인물·행동·배경·화면 속 텍스트·핵심 사건을 먼저 읽어낸 뒤 대본에 녹일 것.
3. 정답/반전은 **씬 4 (반전)** 에서만 노출. 씬 1~3에서 미리 풀지 말 것.
4. **씬 1~3 끝에 cliffhanger** — 다음 씬 안 보면 못 배기게.
5. **씬 4는 반전으로 종료** — CTA / 마무리 멘트 / "구독" / "댓글" 절대 금지.
6. emotion 필드는 단계 이름: \`배경\` / \`디테일\` / \`문제\` / \`반전\`
7. 구어체 내레이션. 마케팅 톤 ❌. 평가어 ("좋다/멋지다") ❌.

${TONE_RULES}

${CURIOSITY_LOOP_RULES}

${AGGRO_TITLE_RULES}

## 출력 JSON
- **videoSummary**: 원본 영상이 **어떻게 흘러갔는지 분석**. 시간 순서로 (시작 → 전개 → 결말) 무슨 일이 벌어졌는지 짚고, 핵심 포인트(가장 흥미로운/후킹되는 지점)가 뭔지 한 줄 분석 덧붙일 것. 3~4줄, 요체. 본 것만 객관적으로.
- **videoTitle**: 어그로 후크 제목 (위 규칙대로 자극적이게)
- storyPremise: 4단계 루프를 어떻게 풀지 2~3줄 (요체)
- newScenes: **정확히 4씬** (index 0~3, durationSec 8, emotion = 단계 이름, text **65~95자**, **모든 문장 요체**)
  - 씬 1은 **강한 후킹**으로 시작 (위 0순위 규칙)
  - 씬 1~3 끝 cliffhanger 필수, 씬 4는 반전 종료
  - ~다 / ~습니다 절대 금지`;
}

const VIDEO_SCRIPT_SCHEMA = {
  type: "object",
  properties: {
    videoSummary: { type: "string" },
    ...SCRIPT_SCHEMA.properties,
  },
  required: ["videoSummary", ...SCRIPT_SCHEMA.required],
};

export async function POST(req: NextRequest) {
  let workDir: string | null = null;
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    const form = await req.formData();
    const file = form.get("video");
    const hint = (form.get("hint") as string | null)?.trim() || "";

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "영상 파일(video)이 필요합니다." },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `영상이 너무 큽니다 (>${MAX_BYTES / 1024 / 1024}MB).` },
        { status: 400 },
      );
    }

    workDir = await fs.mkdtemp(path.join(os.tmpdir(), "vidframes-"));
    const framesDir = path.join(workDir, "frames");
    await fs.mkdir(framesDir);
    const ext = path.extname(file.name) || ".mp4";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, Buffer.from(await file.arrayBuffer()));

    const ffmpeg = await getFfmpeg();

    // 긴 영상은 추출 fps를 낮춰 1차 프레임 수를 SAMPLE_TARGET 이하로 제한
    const duration = await probeDurationSec(inputPath);
    const fps =
      duration > SAMPLE_TARGET ? (SAMPLE_TARGET / duration).toFixed(4) : "1";
    const vf = `fps=${fps}`;

    // 1) 전체 프레임 추출 (가로 512로 축소한 JPEG)
    await execFileAsync(
      ffmpeg,
      [
        "-i",
        inputPath,
        "-vf",
        `${vf},scale=${FRAME_WIDTH}:-2`,
        "-q:v",
        "5",
        path.join(framesDir, "f_%05d.jpg"),
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    // 2) 동일 fps로 9x8 그레이스케일 raw → dHash용
    const { stdout: grayBuf } = await execFileAsync(
      ffmpeg,
      [
        "-i",
        inputPath,
        "-vf",
        `${vf},scale=9:8:flags=area,format=gray`,
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ],
      { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
    );

    const frameFiles = (await fs.readdir(framesDir))
      .filter((f) => f.endsWith(".jpg"))
      .sort();

    if (frameFiles.length === 0) {
      return NextResponse.json(
        { error: "프레임을 추출하지 못했습니다. 영상 파일을 확인해주세요." },
        { status: 422 },
      );
    }

    // dHash 디듀프 — 직전에 "남긴" 프레임과 충분히 다를 때만 keep
    const hashCount = Math.floor(grayBuf.length / 72);
    const n = Math.min(frameFiles.length, hashCount || frameFiles.length);
    const keptIdx: number[] = [];
    let lastHash: boolean[] | null = null;
    for (let i = 0; i < n; i++) {
      if (hashCount > 0) {
        const h = dHash(grayBuf, i * 72);
        if (lastHash && hamming(h, lastHash) <= DEDUP_HAMMING) continue;
        lastHash = h;
      }
      keptIdx.push(i);
    }

    // 최종 프레임 수 상한 — 초과 시 균등 샘플링
    let finalIdx = keptIdx;
    if (keptIdx.length > MAX_FRAMES) {
      finalIdx = [];
      const step = (keptIdx.length - 1) / (MAX_FRAMES - 1);
      for (let k = 0; k < MAX_FRAMES; k++) {
        finalIdx.push(keptIdx[Math.round(k * step)]);
      }
    }

    const imageParts: Part[] = [];
    for (const idx of finalIdx) {
      const data = await fs.readFile(path.join(framesDir, frameFiles[idx]));
      imageParts.push({
        inlineData: { mimeType: "image/jpeg", data: data.toString("base64") },
      });
    }

    const ai = getGeminiClient();
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_FULL_MODEL,
        contents: [
          {
            role: "user",
            parts: [...imageParts, { text: buildVisionPrompt(hint) }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: VIDEO_SCRIPT_SCHEMA,
        },
      }),
    );

    const text = res.text;
    if (!text) {
      return NextResponse.json(
        { error: "대본 생성 응답이 비어있습니다." },
        { status: 500 },
      );
    }
    const parsed = JSON.parse(text);

    const scenes = (parsed.newScenes || []).map(
      (sc: { text?: string; [k: string]: unknown }) => ({
        ...sc,
        text: koreanizeYoche(sc.text || ""),
      }),
    );

    return NextResponse.json({
      videoSummary: koreanizeYoche(parsed.videoSummary || ""),
      videoTitle: parsed.videoTitle || "",
      storyPremise: koreanizeYoche(parsed.storyPremise || ""),
      scenes,
      frameStats: {
        extracted: frameFiles.length,
        afterDedup: keptIdx.length,
        sentToModel: finalIdx.length,
        fps,
        durationSec: Math.round(duration),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    if (workDir) {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
