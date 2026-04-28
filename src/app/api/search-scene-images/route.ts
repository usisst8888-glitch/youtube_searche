import { NextRequest, NextResponse } from "next/server";
import { getGeminiClient, FLASH_MODEL, withRetry } from "@/lib/gemini";

export const maxDuration = 60;
export const runtime = "nodejs";

type SceneImage = {
  imageUrl: string;
  sourceUrl: string;
  title: string;
  siteName: string;
  thumbnailUrl?: string;
};

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string" } },
  },
  required: ["queries"],
};

async function generateImageQueries(
  sceneText: string,
  storyTopic: string,
): Promise<string[]> {
  try {
    const ai = getGeminiClient();
    const prompt = `한국어 쇼츠 씬 대본에서 **그 씬에 어울리는 사진**을 Pexels(영문 스톡 사진 사이트)에서 찾기 위한 검색어를 뽑으세요.

주제: ${storyTopic}
씬 대본: "${sceneText}"

## 규칙
- **3~5개의 짧은 영어 검색어** (각 1~3 단어)
- Pexels는 영문 검색어가 압도적으로 많은 결과를 줌 → **반드시 영어**
- 씬에 등장할 만한 **구체적인 사물·인물·표정·장면** (예: "shocked woman face", "cozy korean cafe")
- 추상적 단어 금지 (예: "truth", "secret", "fact")
- 고유명사·브랜드·상품명 금지
- 일반명사 / 명사구 위주, 실제 사진이 많이 나올 키워드

## 좋은 예
대본: "그 친구는 충격에 휩싸였어요"
→ ["shocked man", "surprised face", "open mouth shock", "stunned expression"]

대본: "고양이가 가만히 쳐다보고 있어요"
→ ["staring cat", "black cat closeup", "cat watching", "intense cat eyes"]

대본: "카페에서 친구들이 웃고 있어요"
→ ["friends laughing cafe", "happy women cafe", "korean coffee shop", "cafe friends"]

JSON 출력.`;
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: FLASH_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: QUERY_SCHEMA,
        },
      }),
    );
    const data = JSON.parse(res.text || "{}");
    const queries = (data.queries as string[]) || [];
    return queries
      .filter((q): q is string => typeof q === "string" && !!q.trim())
      .slice(0, 5);
  } catch {
    return [sceneText.slice(0, 30)];
  }
}

type PexelsPhoto = {
  id: number;
  url: string;
  photographer?: string;
  photographer_url?: string;
  alt?: string;
  src?: {
    original?: string;
    large2x?: string;
    large?: string;
    medium?: string;
    small?: string;
    portrait?: string;
    landscape?: string;
    tiny?: string;
  };
};

async function pexelsImageSearch(
  query: string,
  limit: number,
): Promise<{ images: SceneImage[]; error?: string }> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    return { images: [], error: "PEXELS_API_KEY가 설정되지 않았습니다." };
  }
  try {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query);
    url.searchParams.set("per_page", String(Math.min(15, limit)));
    url.searchParams.set("orientation", "portrait"); // 9:16 쇼츠용
    const res = await fetch(url.toString(), {
      headers: { Authorization: key },
    });
    if (!res.ok) {
      let msg = `Pexels 오류 (${res.status})`;
      try {
        const errBody = await res.json();
        msg = errBody?.error || msg;
      } catch {}
      return { images: [], error: msg };
    }
    const data = (await res.json()) as { photos?: PexelsPhoto[] };
    const photos = data.photos || [];
    const images = photos.slice(0, limit).map<SceneImage>((p) => ({
      imageUrl: p.src?.large || p.src?.medium || p.src?.original || "",
      sourceUrl: p.url,
      title: p.alt || "",
      siteName: p.photographer ? `Pexels · ${p.photographer}` : "Pexels",
      thumbnailUrl: p.src?.medium || p.src?.small || p.src?.tiny,
    }));
    return { images };
  } catch (e) {
    return {
      images: [],
      error: e instanceof Error ? e.message : "네트워크 오류",
    };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sceneText: string = body.sceneText || "";
    const storyTopic: string = body.storyTopic || "";
    const limit: number = Math.max(3, Math.min(15, body.limit || 8));

    // 사용자가 직접 검색어를 보낸 경우 그걸 그대로 사용 (Gemini 호출 생략)
    const customQueries: string[] = Array.isArray(body.queries)
      ? body.queries
          .filter(
            (q: unknown): q is string => typeof q === "string" && !!q.trim(),
          )
          .map((q: string) => q.trim())
      : [];

    if (!customQueries.length && !sceneText.trim()) {
      return NextResponse.json(
        { error: "sceneText 또는 queries가 필요합니다." },
        { status: 400 },
      );
    }

    // 1) 커스텀 쿼리가 있으면 그걸 쓰고, 아니면 Gemini로 영어 검색어 추출
    const queries =
      customQueries.length > 0
        ? customQueries
        : await generateImageQueries(sceneText, storyTopic);
    if (queries.length === 0) {
      return NextResponse.json({ queries: [], images: [] });
    }

    // 2) 각 검색어로 Pexels 호출 (병렬)
    const perQuery = Math.max(2, Math.ceil(limit / queries.length));
    const groups = await Promise.all(
      queries.map((q) => pexelsImageSearch(q, perQuery)),
    );

    // 3) 중복 제거 후 limit까지
    const seen = new Set<string>();
    const merged: SceneImage[] = [];
    for (const g of groups) {
      for (const img of g.images) {
        if (!img.imageUrl || seen.has(img.imageUrl)) continue;
        seen.add(img.imageUrl);
        merged.push(img);
        if (merged.length >= limit) break;
      }
      if (merged.length >= limit) break;
    }

    // 결과가 비어있고 에러가 있으면 사용자에게 노출
    const firstError = groups.find((g) => g.error)?.error;
    if (merged.length === 0 && firstError) {
      return NextResponse.json(
        { queries, images: [], error: firstError },
        { status: 502 },
      );
    }

    return NextResponse.json({ queries, images: merged });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "서버 오류" },
      { status: 500 },
    );
  }
}
