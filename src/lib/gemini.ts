import { GoogleGenAI } from "@google/genai";

let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}

export const FLASH_MODEL = "gemini-2.5-flash-lite";
export const FLASH_LITE_MODEL = "gemini-2.5-flash-lite";
export const FLASH_FULL_MODEL = "gemini-2.5-flash";
export const EMBEDDING_MODEL = "text-embedding-004";

/**
 * 여러 텍스트를 한 번에 임베딩. 각 768차원 float 배열 반환.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const ai = getGeminiClient();
  const out: number[][] = [];
  // 배치 제한 (Gemini embedContent는 호출당 텍스트 1개씩 안전)
  for (const text of texts) {
    const res = await withRetry(() =>
      ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: [{ role: "user", parts: [{ text }] }],
      }),
    );
    const values =
      (res as unknown as { embedding?: { values?: number[] } })?.embedding
        ?.values ||
      (res as unknown as { embeddings?: { values?: number[] }[] })
        ?.embeddings?.[0]?.values;
    if (values) {
      out.push(values);
    } else {
      out.push([]);
    }
  }
  return out;
}

function isRetryable(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("503") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("overloaded") ||
    msg.includes("high demand") ||
    msg.includes("429") ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("INTERNAL") ||
    msg.includes("500")
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; initialDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const initialDelay = opts.initialDelayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      const delay = initialDelay * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
