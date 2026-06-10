// yt-dlp를 child_process로 호출해 영상 메타·댓글·히트맵·자막을 일괄 수집.
//
// 시스템에 yt-dlp가 설치돼 있어야 함 (brew install yt-dlp).

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { RawComment } from "./normalizer";
import type { HeatmapEntry } from "./signal-merger";

export type CollectResult = {
  videoId: string;
  workDir: string;
  title: string;
  durationSec: number;
  uploader: string;
  viewCount: number;
  likeCount: number;
  description: string;
  thumbnail: string;
  webpageUrl: string;
  heatmap: HeatmapEntry[] | null;
  comments: RawComment[];
  subtitleJson: unknown | null;
  subtitleSource: string | null;
  tags: string[];
  categories: string[];
};

function runYtDlp(args: string[], onLog?: (msg: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (onLog) onLog(s.trim());
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (onLog) onLog(s.trim());
    });
    proc.on("error", (err) => {
      reject(new Error(`yt-dlp 실행 실패 (brew install yt-dlp 했는지 확인): ${err.message}`));
    });
    proc.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`yt-dlp가 코드 ${code}로 종료: ${stderr || stdout}`));
    });
  });
}

async function extractVideoId(url: string, onLog?: (msg: string) => void): Promise<string> {
  const { stdout } = await runYtDlp(["--get-id", "--no-warnings", url], onLog);
  const id = stdout.trim().split(/\s+/)[0];
  if (!id) throw new Error("영상 ID 추출 실패 (URL 확인 필요)");
  return id;
}

export function getDefaultDataDir(): string {
  return path.join(os.tmpdir(), "shorts-analyzer-data");
}

export type ReferenceMeta = {
  videoId: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
  description: string;
  subtitleText: string;
};

/** 레퍼런스 쇼츠용 가벼운 수집: 댓글/히트맵 없이 메타+자막만 빠르게. */
export async function collectReference(
  url: string,
  dataDir: string,
  onLog?: (msg: string) => void,
): Promise<ReferenceMeta> {
  const videoId = await extractVideoId(url, onLog);
  const workDir = path.join(dataDir, `ref-${videoId}`);
  await fs.mkdir(workDir, { recursive: true });

  // yt-dlp가 자막 일부 실패해도 info.json만 받았으면 계속 진행 (HTTP 429 등 자주 발생).
  try {
    await runYtDlp(
      [
        "--skip-download",
        "--write-info-json",
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs", "ko/en",
        "--sub-format", "json3",
        "--no-warnings",
        "--no-write-playlist-metafiles",
        "-o", "%(id)s.%(ext)s",
        "-P", workDir,
        url,
      ],
      onLog,
    );
  } catch (e) {
    try {
      await fs.access(path.join(workDir, `${videoId}.info.json`));
      onLog?.(`자막 일부 실패 무시, 메타는 받음: ${(e as Error).message.split("\n")[0]}`);
    } catch {
      throw e;
    }
  }

  const info = JSON.parse(
    await fs.readFile(path.join(workDir, `${videoId}.info.json`), "utf-8"),
  ) as {
    title?: string;
    duration?: number;
    uploader?: string;
    description?: string;
    webpage_url?: string;
  };

  // 자막 텍스트 한 줄로 합치기
  const files = await fs.readdir(workDir);
  const subFile =
    files.find((f) => f.startsWith(`${videoId}.`) && f.includes(".ko.") && f.endsWith(".json3")) ||
    files.find((f) => f.startsWith(`${videoId}.`) && f.endsWith(".json3"));

  let subtitleText = "";
  if (subFile) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(workDir, subFile), "utf-8")) as {
        events?: { segs?: { utf8?: string }[] }[];
      };
      subtitleText = (data.events || [])
        .map((ev) => (ev.segs || []).map((s) => s.utf8 || "").join(""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);
    } catch (e) {
      onLog?.(`레퍼런스 자막 파싱 실패: ${(e as Error).message}`);
    }
  }

  return {
    videoId,
    url: info.webpage_url || url,
    title: info.title || "",
    uploader: info.uploader || "",
    durationSec: info.duration || 0,
    description: (info.description || "").slice(0, 800),
    subtitleText,
  };
}

export async function collect(
  url: string,
  dataDir: string,
  hooks?: { onLog?: (msg: string) => void; onStage?: (stage: string) => void },
): Promise<CollectResult> {
  const onLog = hooks?.onLog;
  const onStage = hooks?.onStage;

  await fs.mkdir(dataDir, { recursive: true });

  onStage?.("video_id");
  const videoId = await extractVideoId(url, onLog);
  onLog?.(`videoId = ${videoId}`);

  const workDir = path.join(dataDir, videoId);
  await fs.mkdir(workDir, { recursive: true });

  // 캐시 체크: info.json이 24시간 이내면 yt-dlp 호출 스킵 (누적 분석 시 빠르게)
  const infoPathPre = path.join(workDir, `${videoId}.info.json`);
  let useCached = false;
  try {
    const stat = await fs.stat(infoPathPre);
    if (Date.now() - stat.mtimeMs < 24 * 60 * 60 * 1000) {
      useCached = true;
      onLog?.(`✓ 캐시된 영상 메타 사용 (yt-dlp 호출 생략)`);
    }
  } catch {}

  if (!useCached) {
  onStage?.("downloading");
  try {
    await runYtDlp(
      [
        "--skip-download",
        "--write-info-json",
        "--write-comments",
        "--extractor-args", "youtube:max_comments=all;comment_sort=top",
        "--write-auto-subs",
        "--write-subs",
        "--sub-langs", "ko/en",
        "--sub-format", "json3",
        "--no-warnings",
        "--no-write-playlist-metafiles",
        "-o", "%(id)s.%(ext)s",
        "-P", workDir,
        url,
      ],
      onLog,
    );
  } catch (e) {
    try {
      await fs.access(path.join(workDir, `${videoId}.info.json`));
      onLog?.(`자막 일부 실패 무시, 메타·댓글은 받음: ${(e as Error).message.split("\n")[0]}`);
    } catch {
      throw e;
    }
  }
  } // end if (!useCached)

  const infoPath = path.join(workDir, `${videoId}.info.json`);
  const info = JSON.parse(await fs.readFile(infoPath, "utf-8")) as {
    title?: string;
    duration?: number;
    uploader?: string;
    channel?: string;
    view_count?: number;
    like_count?: number;
    description?: string;
    thumbnail?: string;
    webpage_url?: string;
    heatmap?: HeatmapEntry[];
    comments?: RawComment[];
    tags?: string[];
    categories?: string[];
  };

  const files = await fs.readdir(workDir);
  const subCandidates = files.filter((f) => f.startsWith(`${videoId}.`) && f.endsWith(".json3"));
  const pickOrder = ["ko", "ko-orig", "en", "en-orig"];
  let subFile: string | null = null;
  for (const lang of pickOrder) {
    const hit = subCandidates.find((f) => f.includes(`.${lang}.`));
    if (hit) { subFile = hit; break; }
  }
  if (!subFile && subCandidates.length > 0) subFile = subCandidates[0];

  let subtitleJson: unknown | null = null;
  if (subFile) {
    try {
      subtitleJson = JSON.parse(await fs.readFile(path.join(workDir, subFile), "utf-8"));
    } catch (e) {
      onLog?.(`자막 파싱 실패 (${subFile}): ${(e as Error).message}`);
    }
  }

  return {
    videoId,
    workDir,
    title: info.title || "",
    durationSec: info.duration || 0,
    uploader: info.uploader || info.channel || "",
    viewCount: info.view_count || 0,
    likeCount: info.like_count || 0,
    description: info.description || "",
    thumbnail: info.thumbnail || "",
    webpageUrl: info.webpage_url || url,
    heatmap: Array.isArray(info.heatmap) ? info.heatmap : null,
    comments: Array.isArray(info.comments) ? info.comments : [],
    subtitleJson,
    subtitleSource: subFile || null,
    tags: Array.isArray(info.tags) ? info.tags : [],
    categories: Array.isArray(info.categories) ? info.categories : [],
  };
}
