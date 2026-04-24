"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useProject } from "../context";

type StoryAngle = {
  id: string;
  product_name: string;
  product_category: string | null;
  angle: string;
  hook: string | null;
  fact: string | null;
  sources: string[] | null;
  status: "idea" | "producing" | "done" | "skipped";
  created_at: string;
};

type LibraryResponse = {
  items: StoryAngle[];
  total: number;
  counts: { all: number; idea: number; producing: number; done: number; skipped: number };
};

const CATEGORIES = [
  "전체",
  "식품",
  "뷰티",
  "가전",
  "생활",
  "패션",
  "IT",
  "문구",
  "주방",
  "반려",
  "스포츠",
  "기타",
];

const STATUS_LABELS: Record<StoryAngle["status"], string> = {
  idea: "💡 아이디어",
  producing: "🎬 제작 중",
  done: "✅ 완료",
  skipped: "❌ 스킵",
};

export default function CreateResearchPage() {
  const router = useRouter();
  const { setProductName, setStoryTopic } = useProject();

  // 발굴 폼
  const [category, setCategory] = useState("전체");
  const [count, setCount] = useState(3);
  const [discovering, setDiscovering] = useState(false);
  const [discoverStatus, setDiscoverStatus] = useState("");

  // 라이브러리
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [libLoading, setLibLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("idea");
  const [filterCategory, setFilterCategory] = useState("전체");
  const [search, setSearch] = useState("");

  const [error, setError] = useState("");

  const loadLibrary = useCallback(async () => {
    setLibLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("status", filterStatus);
      params.set("category", filterCategory);
      if (search.trim()) params.set("q", search.trim());
      params.set("limit", "100");
      const res = await fetch(`/api/story-library?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "라이브러리 로드 실패");
      setLibrary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLibLoading(false);
    }
  }, [filterStatus, filterCategory, search]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const handleDiscover = async () => {
    setError("");
    setDiscoverStatus("Gemini에 ${count * 1.6}개 후보 요청 중...");
    setDiscovering(true);
    try {
      const res = await fetch("/api/discover-story-angles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "발굴 실패");
      setDiscoverStatus(
        `✅ ${data.generated}개 신규 저장 (중복 ${data.duplicatesSkipped}개 스킵)`,
      );
      await loadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
      setDiscoverStatus("");
    } finally {
      setDiscovering(false);
    }
  };

  const handleStatusChange = async (
    id: string,
    status: StoryAngle["status"],
  ) => {
    try {
      await fetch("/api/story-library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      await loadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("이 앵글을 삭제할까요?")) return;
    try {
      await fetch("/api/story-library", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      await loadLibrary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    }
  };

  const useThisAngle = async (a: StoryAngle) => {
    await handleStatusChange(a.id, "producing");
    setProductName(a.product_name);
    setStoryTopic(a.angle);
    router.push("/create/analyze");
  };

  return (
    <div className="space-y-6">
      {/* Section 1: 썰 발굴 */}
      <section className="bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/40 rounded-xl p-6">
        <h2 className="font-semibold mb-1">🔍 썰 발굴</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Gemini가 웹 검색으로 &ldquo;아는 줄 알았는데 몰랐던&rdquo; 제품 썰을
          생성합니다. 임베딩 유사도로 기존 라이브러리와 자동 중복 제거.
        </p>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value, 10))}
            className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}개씩
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleDiscover}
            disabled={discovering}
            className="bg-sky-600 hover:bg-sky-700 disabled:bg-zinc-400 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            {discovering ? "발굴 중... (30~60초)" : "✨ 썰 발굴"}
          </button>

          {discoverStatus && (
            <span className="text-xs text-zinc-500">{discoverStatus}</span>
          )}
        </div>

        {error && (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            ⚠️ {error}
          </div>
        )}
      </section>

      {/* Section 2: 라이브러리 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="font-semibold">
            📚 썰 라이브러리
            {library && (
              <span className="ml-2 text-sm text-zinc-500">
                (전체 {library.counts.all}개)
              </span>
            )}
          </h2>
        </div>

        {/* 상태 탭 */}
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          {(
            [
              ["all", "전체"],
              ["idea", STATUS_LABELS.idea],
              ["producing", STATUS_LABELS.producing],
              ["done", STATUS_LABELS.done],
              ["skipped", STATUS_LABELS.skipped],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilterStatus(key)}
              className={`px-3 py-1.5 rounded-lg ${
                filterStatus === key
                  ? "bg-red-500 text-white"
                  : "bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
              }`}
            >
              {label}{" "}
              {library &&
                `(${
                  key === "all"
                    ? library.counts.all
                    : library.counts[
                        key as Exclude<keyof typeof library.counts, "all">
                      ]
                })`}
            </button>
          ))}
        </div>

        {/* 필터 */}
        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제품명/앵글 검색..."
            className="flex-1 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={loadLibrary}
            className="text-sm text-zinc-500 hover:underline px-2"
          >
            🔄 새로고침
          </button>
        </div>

        {libLoading ? (
          <div className="text-sm text-zinc-500 py-6 text-center">
            로딩 중...
          </div>
        ) : library && library.items.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {library.items.map((a) => (
              <div
                key={a.id}
                className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold leading-snug line-clamp-2">
                      {a.angle}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-1">
                      <span className="bg-zinc-100 dark:bg-zinc-800 rounded px-1.5 py-0.5">
                        {a.product_category || "기타"}
                      </span>
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {a.product_name}
                      </span>
                    </div>
                    {a.hook && (
                      <div className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400 italic">
                        &ldquo;{a.hook}&rdquo;
                      </div>
                    )}
                    {a.fact && (
                      <div className="mt-1 text-xs text-zinc-500 line-clamp-2">
                        {a.fact}
                      </div>
                    )}
                    {a.sources && a.sources.length > 0 && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-zinc-400">
                          🔗 출처 {a.sources.length}개
                        </summary>
                        <ul className="mt-1 ml-3 list-disc space-y-0.5">
                          {a.sources.map((u) => (
                            <li key={u}>
                              <a
                                href={u}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-500 hover:underline break-all"
                              >
                                {u}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded ${
                      a.status === "done"
                        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                        : a.status === "producing"
                          ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                          : a.status === "skipped"
                            ? "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"
                            : "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300"
                    }`}
                  >
                    {STATUS_LABELS[a.status]}
                  </span>

                  <div className="ml-auto flex gap-1">
                    {a.status !== "done" && (
                      <button
                        type="button"
                        onClick={() => useThisAngle(a)}
                        className="text-xs px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded"
                      >
                        🎬 쇼츠 만들기
                      </button>
                    )}
                    <select
                      value={a.status}
                      onChange={(e) =>
                        handleStatusChange(
                          a.id,
                          e.target.value as StoryAngle["status"],
                        )
                      }
                      className="text-xs px-1.5 py-1 border border-zinc-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-950"
                    >
                      <option value="idea">아이디어</option>
                      <option value="producing">제작 중</option>
                      <option value="done">완료</option>
                      <option value="skipped">스킵</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => handleDelete(a.id)}
                      className="text-xs px-1.5 py-1 text-zinc-400 hover:text-red-500"
                      title="삭제"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500 py-8 text-center">
            라이브러리가 비어있습니다. 위에서 &ldquo;✨ 썰 발굴&rdquo; 눌러서 시작하세요.
          </div>
        )}

        {library && library.total > library.items.length && (
          <div className="mt-3 text-xs text-zinc-500 text-center">
            {library.items.length}/{library.total}개 표시 (필터 조건에
            맞는 결과)
          </div>
        )}
      </section>

      <div className="flex justify-between">
        <span />
        <Link
          href="/create/analyze"
          className="text-sm font-medium text-red-500 hover:underline"
        >
          건너뛰기 / 다음: 상품 & 대본 →
        </Link>
      </div>
    </div>
  );
}
