"use client";

import { useState } from "react";
import Link from "next/link";
import { useProject, WebSceneAsset, SceneScript } from "../context";

const IMAGES_PER_SCENE = 4;
// 4컷 패턴: [image, image, 짤, image]
const JJAL_SLOTS = new Set<number>([2]);
const MAIN_COUNT = 3; // 4 - 1 짤
const IMAGE_MAIN_SLOTS = 3; // 메인 3개 모두 이미지
const VIDEO_MAIN_SLOTS = 0;

type GenItem = {
  sceneIndex: number;
  slot: number;
  dataUrl: string;
  prompt: string;
  error?: string;
};

export default function AnalyzePage() {
  const {
    storyTopic,
    setStoryTopic,
    productName,
    setProductName,
    productResearch,
    setProductResearch,
    storyPremise,
    setStoryPremise,
    videoTitle,
    setVideoTitle,
    generatedScenes,
    setGeneratedScenes,
    setAnalysis,
    setFetchedSceneAssets,
    setSelectedSceneAssets,
    storyAngleData,
    sceneImages,
    setSceneImages,
    styleGuide,
    setStyleGuide,
    scenePrompts,
    setScenePrompts,
    anchorImageUrl,
    setAnchorImageUrl,
    googleSceneImages,
    setGoogleSceneImages,
    selectedGoogleImageUrls,
    setSelectedGoogleImageUrls,
    googleQueriesByScene,
    setGoogleQueriesByScene,
    shotlistByScene,
    setShotlistByScene,
    articleImagesByScene,
    setArticleImagesByScene,
  } = useProject();

  // 씬별로 편집 중인 검색어 입력 (커밋 전 임시 상태)
  const [queryDraftByScene, setQueryDraftByScene] = useState<
    Record<number, string>
  >({});

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // "all" | "scene-N" | "image-N-S"
  const [hoveredAssetKey, setHoveredAssetKey] = useState<string | null>(null);
  // 컷별 이미 본 미디어 (중복 회피용) — `${sceneIdx}-${slot}` → Set of (videoId | imageUrl)
  const [seenByShot, setSeenByShot] = useState<Record<string, string[]>>({});
  const [activeSceneIndex, setActiveSceneIndex] = useState<number | null>(
    null,
  );

  const handleAnalyze = async () => {
    setError("");
    if (!productName.trim()) return setError("상품명을 입력하세요.");

    setLoading(true);
    try {
      const res = await fetch("/api/analyze-reference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storyTopic,
          productName,
          productImageDataUrls: [],
          angleData: storyAngleData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "생성 실패");
      setGeneratedScenes(data.scenes || []);
      setProductResearch(data.productResearch || "");
      setStoryPremise(data.storyPremise || "");
      setVideoTitle(data.videoTitle || "");
      setAnalysis(null);
      // 새 대본이면 이전 이미지/앵커 초기화
      setSceneImages({});
      setStyleGuide("");
      setScenePrompts({});
      setAnchorImageUrl("");
      setGoogleSceneImages({});
      setSelectedGoogleImageUrls({});
      setGoogleQueriesByScene({});
      setShotlistByScene({});
      setArticleImagesByScene({});
      setQueryDraftByScene({});
      setFetchedSceneAssets({});
      setSelectedSceneAssets({});
      setActiveSceneIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  };

  // AI + 자동 컷 + 기사 이미지 + 수동 선택 → selectedSceneAssets 동기화
  const syncToSelectedAssets = (
    nextSceneImages: Record<number, string[]>,
    nextSelectedGoogle: Record<number, string[]>,
    nextShotlist: typeof shotlistByScene = shotlistByScene,
    nextArticleImages: Record<number, string[]> = articleImagesByScene,
  ) => {
    const selected: Record<number, WebSceneAsset[]> = {};
    const sceneIdxSet = new Set<number>([
      ...Object.keys(nextSceneImages).map(Number),
      ...Object.keys(nextSelectedGoogle).map(Number),
      ...Object.keys(nextShotlist).map(Number),
      ...Object.keys(nextArticleImages).map(Number),
    ]);
    for (const sceneIdx of sceneIdxSet) {
      const aiImages = (nextSceneImages[sceneIdx] || []).filter((u) => !!u);
      const aiAssets: WebSceneAsset[] = aiImages.map((dataUrl, i) => ({
        kind: "web-image",
        imageUrl: dataUrl,
        sourceUrl: `ai-generated://scene-${sceneIdx}-slot-${i}`,
        title: `AI 이미지 ${i + 1}`,
        siteName: "AI 생성",
      }));

      const shotAssets: WebSceneAsset[] = (nextShotlist[sceneIdx] || [])
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .filter((s) => !!s.image)
        .map<WebSceneAsset>((s) => {
          const img = s.image!;
          // 짤 (direct mp4/webm) → tiktok 모양으로 packing
          if (
            img.directVideoUrl &&
            (img.directVideoExt === "mp4" ||
              img.directVideoExt === "webm")
          ) {
            return {
              kind: "tiktok",
              videoId: img.sourceUrl,
              coverUrl: img.thumbnailUrl || img.imageUrl,
              title: s.roleLabel || img.title,
              author: img.siteName,
              playUrl: img.directVideoUrl,
              watchUrl: img.sourceUrl,
            };
          }
          // 짤 (gif) → web-image (gif는 img 태그에서 자동 재생)
          if (img.directVideoUrl && img.directVideoExt === "gif") {
            return {
              kind: "web-image",
              imageUrl: img.directVideoUrl,
              sourceUrl: img.sourceUrl,
              title: s.roleLabel || img.title,
              siteName: img.siteName,
            };
          }
          // YouTube 영상
          if (img.videoId && img.embedUrl && img.watchUrl) {
            return {
              kind: "youtube-short",
              videoId: img.videoId,
              title: s.roleLabel || img.title,
              thumbnail: img.thumbnailUrl || img.imageUrl,
              views: 0,
              channel: img.siteName,
              embedUrl: img.embedUrl,
              watchUrl: img.watchUrl,
            };
          }
          return {
            kind: "web-image",
            imageUrl: img.imageUrl,
            sourceUrl: img.sourceUrl,
            title: s.roleLabel || img.title,
            siteName: img.siteName,
          };
        });

      // 기사 이미지는 이미 shotlist에 통합되었으므로 별도 추가 없음
      void nextArticleImages;

      const googleUrls = nextSelectedGoogle[sceneIdx] || [];
      const googlePool = googleSceneImages[sceneIdx] || [];
      const googleAssets: WebSceneAsset[] = googleUrls
        .map((url) => googlePool.find((g) => g.imageUrl === url))
        .filter((g): g is NonNullable<typeof g> => !!g)
        .map<WebSceneAsset>((g) => ({
          kind: "web-image",
          imageUrl: g.imageUrl,
          sourceUrl: g.sourceUrl,
          title: g.title,
          siteName: g.siteName,
        }));

      const combined = [...aiAssets, ...shotAssets, ...googleAssets];
      if (combined.length > 0) selected[sceneIdx] = combined;
    }
    setSelectedSceneAssets(selected);
  };

  const callGen = async (params: {
    mode: "all" | "scene" | "image";
    scenes: SceneScript[];
    sceneIndex?: number;
    slot?: number;
    freshPrompts?: boolean; // true면 styleGuide/scenePrompts 보내지 않음 (서버에서 새로 생성)
  }) => {
    const res = await fetch("/api/generate-scene-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: params.mode,
        scenes: params.scenes.map((s) => ({
          index: s.index,
          text: s.text,
          emotion: s.emotion,
          durationSec: s.durationSec,
        })),
        storyTopic,
        storyPremise,
        imagesPerScene: IMAGES_PER_SCENE,
        // freshPrompts면 빈 값 전달 → 서버에서 새로 생성
        styleGuide: params.freshPrompts ? undefined : styleGuide || undefined,
        scenePrompts:
          params.freshPrompts || Object.keys(scenePrompts).length === 0
            ? undefined
            : scenePrompts,
        anchorImageUrl: anchorImageUrl || undefined,
        sceneIndex: params.sceneIndex,
        slot: params.slot,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "생성 실패");
    return data as {
      styleGuide: string;
      scenePrompts: Record<number, string>;
      anchorImageUrl: string;
      images: GenItem[];
    };
  };

  const applyResults = (data: {
    styleGuide: string;
    scenePrompts: Record<number, string>;
    anchorImageUrl: string;
    images: GenItem[];
  }) => {
    if (data.styleGuide) setStyleGuide(data.styleGuide);
    if (data.scenePrompts) setScenePrompts(data.scenePrompts);
    if (data.anchorImageUrl && !anchorImageUrl)
      setAnchorImageUrl(data.anchorImageUrl);

    setSceneImages((prev) => {
      const next = { ...prev };
      for (const img of data.images) {
        if (!img.dataUrl) continue;
        const slots = next[img.sceneIndex] || [];
        const updated = [...slots];
        // 슬롯 인덱스에 맞춰 채우기
        while (updated.length < img.slot + 1) updated.push("");
        updated[img.slot] = img.dataUrl;
        next[img.sceneIndex] = updated;
      }
      // selectedSceneAssets 동기화 (AI + 기존 선택된 구글 이미지 모두)
      syncToSelectedAssets(next, selectedGoogleImageUrls);
      return next;
    });
  };

  // === 기사 URL 이미지 자동 추출 + 씬 배정 ===
  const articleSourceUrl = (() => {
    const urls = storyAngleData?.sources || [];
    return urls.find((u) => /^https?:\/\//i.test(u)) || "";
  })();

  // 사용자 명시 요청으로만 호출 — 기사 URL → 이미지 추출 → 기존 shotlist 앞 슬롯 교체
  const fetchArticleImages = async () => {
    if (!articleSourceUrl) {
      setError("기사 URL이 없습니다. 이 썰에는 기사 출처가 없어요.");
      return;
    }
    if (generatedScenes.length === 0) {
      setError("먼저 대본을 생성하세요.");
      return;
    }
    if (Object.keys(shotlistByScene).length === 0) {
      setError("먼저 🎯 컷 일괄 생성을 실행하세요.");
      return;
    }
    setBusy("article-images");
    setError("");
    try {
      const res = await fetch("/api/extract-article-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: articleSourceUrl,
          scenes: generatedScenes.map((s) => ({
            index: s.index,
            text: s.text,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "기사 이미지 추출 실패");

      // 씬 간 중복 제거
      let byScene = (data.byScene || {}) as Record<number, string[]>;
      const usedUrls = new Set<string>();
      const deduped: Record<number, string[]> = {};
      for (const sc of generatedScenes) {
        const urls = (byScene[sc.index] || []).filter(
          (u) => !usedUrls.has(u),
        );
        if (urls.length > 0) {
          deduped[sc.index] = urls;
          urls.forEach((u) => usedUrls.add(u));
        }
      }
      byScene = deduped;
      setArticleImagesByScene(byScene);

      // 기존 shotlist의 메인 슬롯(0,1,3,4,6) 앞에서부터 기사 이미지로 교체
      setShotlistByScene((prev) => {
        const next = { ...prev };
        for (const scene of generatedScenes) {
          const articleUrls = (byScene[scene.index] || []).slice(
            0,
            MAIN_COUNT,
          );
          if (articleUrls.length === 0) continue;
          const cur = next[scene.index] || [];
          const updated = [...cur];
          let aIdx = 0;
          for (let slot = 0; slot < IMAGES_PER_SCENE; slot++) {
            if (JJAL_SLOTS.has(slot)) continue;
            if (aIdx >= articleUrls.length) break;
            const url = articleUrls[aIdx++];
            const articleShot = {
              sceneIndex: scene.index,
              slot,
              role: "article",
              roleLabel: "기사 원본",
              query: "",
              image: {
                imageUrl: url,
                sourceUrl: url,
                siteName: "기사 원본",
                title: `기사 이미지 ${aIdx}`,
                thumbnailUrl: url,
              },
            };
            const existingIdx = updated.findIndex((s) => s.slot === slot);
            if (existingIdx >= 0) updated[existingIdx] = articleShot;
            else updated.push(articleShot);
          }
          next[scene.index] = updated.sort((a, b) => a.slot - b.slot);
        }
        syncToSelectedAssets(
          sceneImages,
          selectedGoogleImageUrls,
          next,
          byScene,
        );
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // === 자동 컷 구성 (shotlist) ===
  // 메인 키워드 도출: angle 첫 토큰 → productName → storyTopic 첫 토큰
  const mainKeyword = (() => {
    const fromAngle = storyAngleData?.angle?.split(/[\s,!?.…]+/)[0]?.trim();
    if (fromAngle && fromAngle.length >= 2) return fromAngle;
    if (productName?.trim()) return productName.trim();
    const fromTopic = storyTopic.split(/[\s,!?.…]+/)[0]?.trim();
    return fromTopic || "";
  })();

  const callAutoShots = async (params: {
    mode: "all" | "scene" | "shot";
    sceneIndex?: number;
    slot?: number;
    customQuery?: string;
    excludeVideoIds?: string[];
    imageSlots?: number;
    videoSlots?: number;
  }) => {
    const res = await fetch("/api/auto-scene-shots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: params.mode,
        scenes: generatedScenes.map((s) => ({
          index: s.index,
          text: s.text,
          emotion: s.emotion,
          durationSec: s.durationSec,
        })),
        storyTopic,
        mainKeyword,
        shotsPerScene: IMAGES_PER_SCENE,
        imageSlots: params.imageSlots,
        videoSlots: params.videoSlots,
        sceneIndex: params.sceneIndex,
        slot: params.slot,
        query: params.customQuery,
        excludeVideoIds: params.excludeVideoIds,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "자동 컷 구성 실패");
    return data.shots as {
      sceneIndex: number;
      slot: number;
      role: string;
      roleLabel: string;
      query: string;
      image: {
        imageUrl: string;
        sourceUrl: string;
        siteName: string;
        thumbnailUrl?: string;
        title: string;
        videoId?: string;
        embedUrl?: string;
        watchUrl?: string;
        directVideoUrl?: string;
        directVideoExt?: "mp4" | "gif" | "webm";
      } | null;
    }[];
  };

  const autoShotsAll = async () => {
    if (generatedScenes.length === 0) return;
    setBusy("shots-all");
    setError("");
    try {
      // 컷 일괄 생성에서는 기사 이미지를 자동으로 가져오지 않음.
      // (사용자가 별도 "📰 기사 이미지 가져오기" 버튼으로 명시 요청해야만 처리됨)
      const articleByScene: Record<number, string[]> = {};
      setArticleImagesByScene({});

      // Step 2: 메인 컷 구성 — 이미지 3 + 영상 2 (총 5개 메인)
      const shots = await callAutoShots({
        mode: "all",
        imageSlots: IMAGE_MAIN_SLOTS,
        videoSlots: VIDEO_MAIN_SLOTS,
      });

      // Step 3: 짤 가져오기 — 씬당 2개 (씬 emotion 태그 + fallback)
      const usedJjalUrls = new Set<string>();
      // 인기 태그 fallback (씬 감정 태그가 결과 0이면 시도)
      const FALLBACK_TAGS = ["놀람", "황당", "당황", "웃음", "충격", "멘붕"];
      type JjalItemClient = {
        mediaUrl: string;
        thumbnailUrl: string;
        watchUrl: string;
        title: string;
        ext: "mp4" | "gif" | "webm";
        tag: string;
      };
      const jjalByScene: Record<number, JjalItemClient[]> = {};

      const fetchJjals = async (
        tag: string,
        need: number,
      ): Promise<JjalItemClient[]> => {
        try {
          const res = await fetch("/api/search-jjal", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tag,
              limit: need,
              exclude: Array.from(usedJjalUrls),
            }),
          });
          if (!res.ok) return [];
          const data = await res.json();
          return (data.items || []) as JjalItemClient[];
        } catch {
          return [];
        }
      };

      for (const scene of generatedScenes) {
        const primaryTag = (scene.emotion || "").trim() || "놀람";
        const collected: JjalItemClient[] = [];
        const tagsToTry = [
          primaryTag,
          ...FALLBACK_TAGS.filter((t) => t !== primaryTag),
        ];
        for (const tag of tagsToTry) {
          if (collected.length >= JJAL_SLOTS.size) break;
          const got = await fetchJjals(tag, JJAL_SLOTS.size - collected.length);
          for (const it of got) {
            if (usedJjalUrls.has(it.mediaUrl)) continue;
            usedJjalUrls.add(it.mediaUrl);
            collected.push(it);
            if (collected.length >= JJAL_SLOTS.size) break;
          }
        }
        jjalByScene[scene.index] = collected;
      }

      // Step 4: 씬별 합치기 — slot 0는 기사 우선, 메인 슬롯은 셔플, 짤 슬롯은 고정 위치
      const shuffle = <T,>(arr: T[]): T[] => {
        const out = [...arr];
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
      };

      const merged: typeof shotlistByScene = {};
      for (const scene of generatedScenes) {
        // 컷 일괄 생성에서는 article 슬롯 절대 안 만듦 — articleByScene는 위에서 비어있음
        void articleByScene;
        const articleUrls: string[] = [];
        const apiShots = shots.filter((s) => s.sceneIndex === scene.index);
        const jjals = jjalByScene[scene.index] || [];

        type Shot = (typeof shots)[number];
        const articleShots: Shot[] = articleUrls.map((url, i) => ({
          sceneIndex: scene.index,
          slot: -1,
          role: "article",
          roleLabel: "기사 원본",
          query: "",
          image: {
            imageUrl: url,
            sourceUrl: url,
            siteName: "기사 원본",
            title: `기사 이미지 ${i + 1}`,
            thumbnailUrl: url,
          },
        }));

        // 메인 풀 만들기 (3개)
        const mainPool: Shot[] = [];
        if (articleShots.length > 0) {
          mainPool.push(articleShots.shift()!); // 첫 기사 = slot 0
          const rest = shuffle([...articleShots, ...apiShots]);
          for (const r of rest) {
            if (mainPool.length >= MAIN_COUNT) break;
            mainPool.push(r);
          }
        } else {
          const shuffled = shuffle(apiShots);
          for (const s of shuffled) {
            if (mainPool.length >= MAIN_COUNT) break;
            mainPool.push(s);
          }
        }

        // 7-slot 배치: [main, main, 짤, main, main, 짤, main]
        const final: Shot[] = [];
        let mainIdx = 0;
        let jjalIdx = 0;
        for (let slot = 0; slot < IMAGES_PER_SCENE; slot++) {
          if (JJAL_SLOTS.has(slot)) {
            const j = jjals[jjalIdx++];
            if (j) {
              const proxiedMedia = `/api/proxy-asset?url=${encodeURIComponent(j.mediaUrl)}`;
              final.push({
                sceneIndex: scene.index,
                slot,
                role: "jjal",
                roleLabel: `짤 (${j.tag})`,
                query: "",
                image: {
                  imageUrl: proxiedMedia,
                  sourceUrl: j.watchUrl,
                  siteName: `짤방 · ${j.tag}`,
                  thumbnailUrl: proxiedMedia,
                  title: j.title,
                  directVideoUrl: proxiedMedia,
                  directVideoExt: j.ext,
                },
              });
            }
          } else {
            const m = mainPool[mainIdx++];
            if (m) {
              final.push({ ...m, slot });
            }
          }
        }

        if (final.length > 0) merged[scene.index] = final;
      }

      setShotlistByScene(merged);
      syncToSelectedAssets(
        sceneImages,
        selectedGoogleImageUrls,
        merged,
        articleByScene,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  const autoShotsForScene = async (sceneIndex: number) => {
    setBusy(`shots-scene-${sceneIndex}`);
    setError("");
    try {
      const shots = await callAutoShots({ mode: "scene", sceneIndex });
      shots.sort((a, b) => a.slot - b.slot);
      const next = { ...shotlistByScene, [sceneIndex]: shots };
      setShotlistByScene(next);
      syncToSelectedAssets(sceneImages, selectedGoogleImageUrls, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 모든 씬에서 현재 사용 중인 이미지 URL / videoId 수집 (씬 간 중복 회피)
  const collectGlobalUsage = () => {
    const usedVideoIds = new Set<string>();
    const usedImageUrls = new Set<string>();
    for (const sceneShots of Object.values(shotlistByScene)) {
      for (const sh of sceneShots) {
        const img = sh.image;
        if (!img) continue;
        if (img.videoId) usedVideoIds.add(img.videoId);
        else if (img.imageUrl) usedImageUrls.add(img.imageUrl);
      }
    }
    return { usedVideoIds, usedImageUrls };
  };

  // 특정 씬-컷을 Bing 이미지 검색 결과로 교체 (중복 회피)
  const webImageReplaceShot = async (sceneIndex: number, slot: number) => {
    const list = shotlistByScene[sceneIndex] || [];
    const target = list.find((x) => x.slot === slot);
    if (!target) return;
    const query = target.query || target.roleLabel || "";
    if (!query) {
      setError("이 컷에는 검색어가 없습니다.");
      return;
    }
    const seenKey = `${sceneIndex}-${slot}`;
    const seenList = seenByShot[seenKey] || [];
    const { usedImageUrls } = collectGlobalUsage();
    // 현재 박혀있는 이미지 URL + 이전에 본 거 + 다른 씬에서 쓰는 모든 이미지 URL
    const currentUrl = target.image?.imageUrl;
    const exclude = Array.from(
      new Set([
        ...seenList,
        ...(currentUrl ? [currentUrl] : []),
        ...usedImageUrls,
      ]),
    );

    setBusy(`web-${sceneIndex}-${slot}`);
    setError("");
    try {
      const res = await fetch("/api/search-web-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 1, exclude }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "이미지 검색 실패");
      const img = (data.images || [])[0];
      if (!img) throw new Error("더 이상 다른 결과가 없습니다.");

      setSeenByShot((prev) => {
        const list = prev[seenKey] || [];
        return {
          ...prev,
          [seenKey]: Array.from(
            new Set([...list, ...(currentUrl ? [currentUrl] : []), img.imageUrl]),
          ),
        };
      });

      setShotlistByScene((prev) => {
        const cur = prev[sceneIndex] || [];
        const idx = cur.findIndex((x) => x.slot === slot);
        if (idx < 0) return prev;
        const copy = [...cur];
        copy[idx] = {
          ...copy[idx],
          image: {
            imageUrl: img.imageUrl,
            sourceUrl: img.sourceUrl,
            siteName: img.siteName,
            thumbnailUrl: img.thumbnailUrl,
            title: img.title || target.roleLabel,
          },
        };
        const next = { ...prev, [sceneIndex]: copy };
        syncToSelectedAssets(
          sceneImages,
          selectedGoogleImageUrls,
          next,
          articleImagesByScene,
        );
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 특정 씬-컷을 AI로 교체 (shotlist의 image를 AI dataUrl로 덮어쓰기)
  const aiReplaceShot = async (sceneIndex: number, slot: number) => {
    const scene = generatedScenes.find((s) => s.index === sceneIndex);
    if (!scene) return;
    const list = shotlistByScene[sceneIndex] || [];
    const target = list.find((x) => x.slot === slot);
    setBusy(`ai-${sceneIndex}-${slot}`);
    setError("");
    try {
      // shotlist의 roleLabel을 추가 컨텍스트로 — AI가 그 역할에 맞는 이미지 만들도록
      const extraContext = target?.roleLabel
        ? ` Visual focus: ${target.roleLabel}.`
        : "";
      const res = await fetch("/api/generate-scene-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "image",
          scenes: generatedScenes.map((s) => ({
            index: s.index,
            text: s.text + extraContext,
            emotion: s.emotion,
            durationSec: s.durationSec,
          })),
          storyTopic,
          storyPremise,
          imagesPerScene: IMAGES_PER_SCENE,
          sceneIndex,
          slot,
          // 매번 새 프롬프트 (역할에 맞춰)
          styleGuide: styleGuide || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 이미지 생성 실패");
      if (data.styleGuide && !styleGuide) setStyleGuide(data.styleGuide);

      const img = (data.images || [])[0];
      if (!img || !img.dataUrl) throw new Error("AI 결과 없음");

      // shotlist의 해당 슬롯 image를 AI로 교체
      setShotlistByScene((prev) => {
        const cur = prev[sceneIndex] || [];
        const idx = cur.findIndex((x) => x.slot === slot);
        const newImage = {
          imageUrl: img.dataUrl,
          sourceUrl: `ai://scene-${sceneIndex}-slot-${slot}`,
          siteName: "AI 생성",
          title: target?.roleLabel || `AI 컷 ${slot + 1}`,
          thumbnailUrl: img.dataUrl,
        };
        let nextList: typeof cur;
        if (idx >= 0) {
          nextList = [...cur];
          nextList[idx] = { ...nextList[idx], image: newImage };
        } else {
          // shotlist에 해당 슬롯 없으면 새로 추가
          nextList = [
            ...cur,
            {
              slot,
              role: "ai",
              roleLabel: "AI 생성 컷",
              query: "",
              image: newImage,
            },
          ].sort((a, b) => a.slot - b.slot);
        }
        const next = { ...prev, [sceneIndex]: nextList };
        syncToSelectedAssets(
          sceneImages,
          selectedGoogleImageUrls,
          next,
          articleImagesByScene,
        );
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 특정 씬-컷을 짤(mp4/gif)로 교체 — 짤방 사이트 검색
  const jjalReplaceShot = async (sceneIndex: number, slot: number) => {
    const list = shotlistByScene[sceneIndex] || [];
    const target = list.find((x) => x.slot === slot);
    if (!target) return;
    const scene = generatedScenes.find((s) => s.index === sceneIndex);
    // 태그 우선순위: 씬 감정 → 컷 roleLabel 첫 단어 → "놀람" fallback
    const tag =
      (scene?.emotion || "").trim() ||
      target.roleLabel?.split(/[\s(]/)[0] ||
      "놀람";

    const seenKey = `${sceneIndex}-${slot}`;
    const seenList = seenByShot[seenKey] || [];
    const currentDirect = target.image?.directVideoUrl;
    const exclude = currentDirect
      ? Array.from(new Set([...seenList, currentDirect]))
      : seenList;

    setBusy(`jjal-${sceneIndex}-${slot}`);
    setError("");
    try {
      const res = await fetch("/api/search-jjal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, limit: 1, exclude }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "짤 검색 실패");
      const it = (data.items || [])[0];
      if (!it) throw new Error(`"${tag}" 태그 짤이 더 없습니다`);

      setSeenByShot((prev) => ({
        ...prev,
        [seenKey]: Array.from(
          new Set([
            ...(prev[seenKey] || []),
            ...(currentDirect ? [currentDirect] : []),
            it.mediaUrl,
          ]),
        ),
      }));

      setShotlistByScene((prev) => {
        const cur = prev[sceneIndex] || [];
        const idx = cur.findIndex((x) => x.slot === slot);
        if (idx < 0) return prev;
        const copy = [...cur];
        // 브라우저 표시는 proxy 경유 (hotlink 우회), 다운로드/원본 추적용은 raw URL
        const proxiedMedia = `/api/proxy-asset?url=${encodeURIComponent(it.mediaUrl)}`;
        copy[idx] = {
          ...copy[idx],
          image: {
            imageUrl: proxiedMedia,
            sourceUrl: it.watchUrl,
            siteName: `짤방 · ${tag}`,
            thumbnailUrl: proxiedMedia,
            title: it.title,
            directVideoUrl: proxiedMedia,
            directVideoExt: it.ext,
          },
        };
        const next = { ...prev, [sceneIndex]: copy };
        syncToSelectedAssets(
          sceneImages,
          selectedGoogleImageUrls,
          next,
          articleImagesByScene,
        );
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 🔄 스마트 새로고침 — 현재 슬롯 타입 유지 (이미지면 이미지, 영상이면 영상)
  // 컷 타입을 알 수 없으면(빈 슬롯 등) 이미지 우선
  const smartRefreshShot = async (sceneIndex: number, slot: number) => {
    const list = shotlistByScene[sceneIndex] || [];
    const target = list.find((x) => x.slot === slot);
    const isVideo = !!target?.image?.videoId;
    if (isVideo) {
      await autoShotSingle(sceneIndex, slot);
    } else {
      await webImageReplaceShot(sceneIndex, slot);
    }
  };

  const autoShotSingle = async (
    sceneIndex: number,
    slot: number,
    customQuery?: string,
  ) => {
    const seenKey = `${sceneIndex}-${slot}`;
    const existing = shotlistByScene[sceneIndex] || [];
    const target = existing.find((x) => x.slot === slot);
    const currentVideoId = target?.image?.videoId;
    const seenList = seenByShot[seenKey] || [];
    const { usedVideoIds } = collectGlobalUsage();
    // 이전에 본 거 + 현재 컷 + 다른 모든 씬에서 사용 중인 videoId 제외
    const excludeIds = Array.from(
      new Set([
        ...seenList,
        ...(currentVideoId ? [currentVideoId] : []),
        ...usedVideoIds,
      ]),
    );

    setBusy(`shot-${sceneIndex}-${slot}`);
    setError("");
    try {
      const shots = await callAutoShots({
        mode: "shot",
        sceneIndex,
        slot,
        customQuery,
        excludeVideoIds: excludeIds,
      });
      const got = shots[0];
      if (!got) throw new Error("결과 없음");
      if (!got.image) throw new Error("더 이상 다른 결과가 없습니다.");

      // seen에 새 결과 추가
      const newId = got.image.videoId || got.image.imageUrl;
      if (newId) {
        setSeenByShot((prev) => ({
          ...prev,
          [seenKey]: Array.from(
            new Set([
              ...(prev[seenKey] || []),
              ...(currentVideoId ? [currentVideoId] : []),
              newId,
            ]),
          ),
        }));
      }

      const updated = (() => {
        const idx = existing.findIndex((x) => x.slot === slot);
        if (idx >= 0) {
          const copy = [...existing];
          copy[idx] = got;
          return copy;
        }
        return [...existing, got].sort((a, b) => a.slot - b.slot);
      })();
      const next = { ...shotlistByScene, [sceneIndex]: updated };
      setShotlistByScene(next);
      syncToSelectedAssets(
        sceneImages,
        selectedGoogleImageUrls,
        next,
        articleImagesByScene,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 한 씬의 구글 이미지 검색 — customQueries 있으면 그걸 쓰고, 아니면 AI가 추출
  const searchGoogleImages = async (
    sceneIndex: number,
    customQueries?: string[],
  ) => {
    const scene = generatedScenes[sceneIndex];
    if (!scene) return;
    setBusy(`google-${sceneIndex}`);
    setError("");
    try {
      const res = await fetch("/api/search-scene-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneText: scene.text,
          storyTopic,
          limit: 8,
          queries: customQueries && customQueries.length > 0
            ? customQueries
            : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Pexels 이미지 검색 실패");
      setGoogleSceneImages((prev) => ({
        ...prev,
        [sceneIndex]: data.images || [],
      }));
      setGoogleQueriesByScene((prev) => ({
        ...prev,
        [sceneIndex]: data.queries || [],
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 모든 씬 구글 이미지 일괄 검색 (병렬)
  const searchGoogleAll = async () => {
    if (generatedScenes.length === 0) return;
    setBusy("google-all");
    setError("");
    try {
      const results = await Promise.all(
        generatedScenes.map(async (s) => {
          const res = await fetch("/api/search-scene-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sceneText: s.text,
              storyTopic,
              limit: 8,
            }),
          });
          const data = await res.json();
          return {
            sceneIndex: s.index,
            images: data.images || [],
            queries: data.queries || [],
          };
        }),
      );
      const nextImages: typeof googleSceneImages = {};
      const nextQueries: typeof googleQueriesByScene = {};
      for (const r of results) {
        nextImages[r.sceneIndex] = r.images;
        nextQueries[r.sceneIndex] = r.queries;
      }
      setGoogleSceneImages(nextImages);
      setGoogleQueriesByScene(nextQueries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  // 씬별 검색어 편집 → 그 검색어로 다시 검색
  const searchWithCustomQueries = (sceneIndex: number) => {
    const draft = (queryDraftByScene[sceneIndex] || "").trim();
    if (!draft) return;
    const queries = draft
      .split(/[,，\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (queries.length === 0) return;
    setQueryDraftByScene((prev) => ({ ...prev, [sceneIndex]: "" }));
    searchGoogleImages(sceneIndex, queries);
  };

  const toggleGoogleImage = (sceneIndex: number, imageUrl: string) => {
    setSelectedGoogleImageUrls((prev) => {
      const list = prev[sceneIndex] || [];
      const next = list.includes(imageUrl)
        ? list.filter((u) => u !== imageUrl)
        : [...list, imageUrl];
      const updated = { ...prev, [sceneIndex]: next };
      // sceneImages는 그대로, 선택만 변경
      syncToSelectedAssets(sceneImages, updated);
      return updated;
    });
  };

  const generateAll = async () => {
    if (generatedScenes.length === 0) return;
    setBusy("all");
    setError("");
    // 새 배치 — 스타일·프롬프트·앵커·이미지 모두 리셋해서 완전히 새로 짜기
    setAnchorImageUrl("");
    setSceneImages({});
    setStyleGuide("");
    setScenePrompts({});
    try {
      const data = await callGen({
        mode: "all",
        scenes: generatedScenes,
        freshPrompts: true,
      });
      applyResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  const regenerateScene = async (sceneIndex: number) => {
    setBusy(`scene-${sceneIndex}`);
    setError("");
    try {
      const data = await callGen({
        mode: "scene",
        scenes: generatedScenes,
        sceneIndex,
      });
      applyResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  const regenerateImage = async (sceneIndex: number, slot: number) => {
    setBusy(`image-${sceneIndex}-${slot}`);
    setError("");
    try {
      const data = await callGen({
        mode: "image",
        scenes: generatedScenes,
        sceneIndex,
        slot,
      });
      applyResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setBusy(null);
    }
  };

  const totalGenerated = Object.values(sceneImages).reduce(
    (acc, slots) => acc + slots.filter((s) => !!s).length,
    0,
  );
  const totalNeeded = generatedScenes.length * IMAGES_PER_SCENE;

  return (
    <div className="space-y-6">
      {/* 입력 */}
      <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6">
        <h2 className="font-semibold mb-1">입력</h2>
        <p className="text-xs text-zinc-500 mb-4">
          주제·상품명은{" "}
          <Link
            href="/create/research"
            className="text-blue-500 hover:underline"
          >
            0단계 썰 라이브러리
          </Link>
          에서 선택하면 자동 입력. 대본 생성 후 씬별 AI 이미지를 일괄
          생성합니다.
        </p>

        {storyAngleData && (
          <div className="mb-4 border border-amber-300 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-3">
            <div className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
              📚 썰 라이브러리에서 선택된 썰 (이 내용으로 대본 생성)
            </div>
            <div className="text-sm font-semibold">{storyAngleData.angle}</div>
            {storyAngleData.hook && (
              <div className="mt-1 text-xs italic text-zinc-700 dark:text-zinc-300">
                &ldquo;{storyAngleData.hook}&rdquo;
              </div>
            )}
            {storyAngleData.fact && (
              <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                {storyAngleData.fact}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              🎭 스토리 주제
            </label>
            <textarea
              rows={2}
              value={storyTopic}
              onChange={(e) => setStoryTopic(e.target.value)}
              placeholder="예: 왜 항아리 모양인지 아세요?"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">상품명</label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 빙그레 바나나맛 우유"
              className="w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="bg-red-500 hover:bg-red-600 disabled:bg-zinc-400 text-white font-semibold px-5 py-2.5 rounded-lg"
          >
            {loading ? "대본 생성 중... (20~40초)" : "🎬 대본 생성"}
          </button>
          {error && (
            <span className="text-sm text-red-600 dark:text-red-400">
              ⚠️ {error}
            </span>
          )}
        </div>
      </section>

      {/* 영상 어그로 제목 (편집 가능) */}
      {videoTitle && (
        <section className="bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-950/20 dark:to-orange-950/20 border border-red-300 dark:border-red-900/50 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-bold text-red-600 dark:text-red-400">
              🔥 영상 제목 (어그로 후크) — 영상 헤더에 자동 적용
            </div>
            <span className="text-[10px] text-zinc-500">{videoTitle.length}자</span>
          </div>
          <input
            type="text"
            value={videoTitle}
            onChange={(e) => setVideoTitle(e.target.value)}
            className="w-full bg-white dark:bg-zinc-950 border border-red-300 dark:border-red-900 rounded-lg px-3 py-2 text-sm font-bold leading-snug"
          />
          <p className="mt-1.5 text-[10px] text-zinc-500">
            마음에 안 들면 직접 수정하세요. finalize 페이지의 헤더 텍스트로
            자동 입력됩니다.
          </p>
        </section>
      )}

      {/* 스토리 프레미스 */}
      {storyPremise && (
        <section className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <div className="text-xs font-medium text-zinc-500 mb-1">
            🎭 스토리 프레미스
          </div>
          <p className="text-sm whitespace-pre-wrap">{storyPremise}</p>
        </section>
      )}

      {/* 전체 이미지 생성 */}
      {generatedScenes.length > 0 && (
        <section className="bg-gradient-to-br from-emerald-50 to-purple-50 dark:from-emerald-950/20 dark:to-purple-950/20 border border-emerald-200 dark:border-emerald-900/50 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold text-sm">
                🎯 씬별 컷 일괄 생성
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                씬 {generatedScenes.length}개 × {IMAGES_PER_SCENE}컷 (이미지 3
                + 짤 1) = 총 {generatedScenes.length * IMAGES_PER_SCENE}컷.
                패턴: <code>이미지 · 이미지 · 🤣 · 이미지</code>. 컷마다 🎨 AI ·
                🖼️ 웹이미지 · 🤣 짤 · 🔄 새로고침.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={autoShotsAll}
                disabled={busy !== null}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-white font-semibold text-sm px-4 py-2 rounded-lg"
              >
                {busy === "shots-all"
                  ? "🎯 분석 중..."
                  : Object.keys(shotlistByScene).length > 0
                    ? "🔄 컷 일괄 다시"
                    : "🎯 컷 일괄 생성 (씬당 4컷)"}
              </button>
              {articleSourceUrl && (
                <button
                  type="button"
                  onClick={fetchArticleImages}
                  disabled={busy !== null}
                  className="bg-amber-600 hover:bg-amber-700 disabled:bg-zinc-400 text-white font-semibold text-sm px-4 py-2 rounded-lg"
                  title={`기사 URL: ${articleSourceUrl}`}
                >
                  {busy === "article-images"
                    ? "📰 추출 중..."
                    : Object.keys(articleImagesByScene).length > 0
                      ? "🔄 기사 이미지 다시"
                      : "📰 기사 이미지 가져오기 (선택)"}
                </button>
              )}
            </div>
          </div>
          {styleGuide && (
            <details className="mt-3 text-xs">
              <summary className="cursor-pointer text-purple-700 dark:text-purple-300 font-medium">
                📐 적용된 스타일 가이드
              </summary>
              <p className="mt-2 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {styleGuide}
              </p>
            </details>
          )}
        </section>
      )}

      {/* 대본 + 씬별 이미지 */}
      {generatedScenes.length > 0 && (
        <section className="space-y-4">
          {/* 위: 씬 리스트 (가로 배열로 컴팩트하게) */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
            <h3 className="font-semibold mb-2">🎬 씬별 대본</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
            {generatedScenes.map((s) => {
              const slots = sceneImages[s.index] || [];
              const filled = slots.filter((u) => !!u).length;
              const isActive = activeSceneIndex === s.index;
              return (
                <button
                  key={s.index}
                  type="button"
                  onClick={() => setActiveSceneIndex(s.index)}
                  className={`w-full text-left border rounded-lg p-3 transition-colors ${
                    isActive
                      ? "border-purple-500 bg-purple-50 dark:bg-purple-950/20"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold">씬 {s.index + 1}</span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-zinc-500">{s.durationSec}초</span>
                      <span className="text-zinc-400">·</span>
                      <span className="text-red-500">{s.emotion}</span>
                    </div>
                    {filled > 0 ? (
                      <span className="text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded">
                        🎨 {filled}/{IMAGES_PER_SCENE}장
                      </span>
                    ) : (
                      <span className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded">
                        미생성
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-snug">{s.text}</p>
                  {filled > 0 && (
                    <div className="mt-2 flex gap-1 overflow-x-auto">
                      {slots.map((url, i) =>
                        url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={i}
                            src={url}
                            alt=""
                            className="w-10 h-[60px] object-cover rounded bg-zinc-100 dark:bg-zinc-800 shrink-0"
                          />
                        ) : null,
                      )}
                    </div>
                  )}
                </button>
              );
            })}
            </div>
          </div>

          {/* 아래: 선택된 씬의 이미지 패널 */}
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
            {activeSceneIndex === null ? (
              <div className="text-sm text-zinc-500 py-8 text-center">
                위에서 씬을 선택하면 컷이 여기 표시됩니다.
              </div>
            ) : (
              (() => {
                const scene = generatedScenes[activeSceneIndex];
                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-sm">
                        씬 {activeSceneIndex + 1} 컷 ({IMAGES_PER_SCENE}개)
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mb-3 italic">
                      &ldquo;{scene?.text}&rdquo;
                    </p>

                    {/* 자동 컷 구성 결과 (역할 기반 ordered shotlist — 기사 이미지 + Pexels 통합) */}
                    {(() => {
                      const list = shotlistByScene[activeSceneIndex] || [];
                      const sceneShotsBusy =
                        busy === `shots-scene-${activeSceneIndex}` ||
                        busy === "shots-all";
                      if (list.length === 0 && !sceneShotsBusy) return null;
                      return (
                        <div className="mb-4 border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/10 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                              🎯 자동 컷 구성 (역할 기반)
                            </h4>
                            <button
                              type="button"
                              onClick={() => autoShotsForScene(activeSceneIndex)}
                              disabled={busy !== null}
                              className="text-[11px] bg-emerald-600 hover:bg-emerald-700 disabled:bg-zinc-400 text-white px-2.5 py-1 rounded"
                            >
                              {sceneShotsBusy ? "🎯 분석 중..." : "🔄 이 씬 다시"}
                            </button>
                          </div>
                          {sceneShotsBusy && list.length === 0 ? (
                            <p className="text-[11px] text-zinc-500 py-3 text-center">
                              씬 분석 중...
                            </p>
                          ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                              {list.map((s) => {
                                const pexelsBusy =
                                  busy === `shot-${activeSceneIndex}-${s.slot}`;
                                const aiBusy =
                                  busy ===
                                  `ai-${activeSceneIndex}-${s.slot}`;
                                const webBusy =
                                  busy ===
                                  `web-${activeSceneIndex}-${s.slot}`;
                                const cellBusy = pexelsBusy || aiBusy || webBusy;
                                const isAi = s.role === "ai";
                                const isArticle = s.role === "article";
                                const isJjal = s.role === "jjal";
                                const isVideo = !!s.image?.videoId;
                                const isHovered =
                                  hoveredAssetKey ===
                                  `shot-${activeSceneIndex}-${s.slot}`;
                                return (
                                  <div
                                    key={s.slot}
                                    onMouseEnter={() =>
                                      setHoveredAssetKey(
                                        `shot-${activeSceneIndex}-${s.slot}`,
                                      )
                                    }
                                    onMouseLeave={() =>
                                      setHoveredAssetKey((c) =>
                                        c ===
                                        `shot-${activeSceneIndex}-${s.slot}`
                                          ? null
                                          : c,
                                      )
                                    }
                                    className={`relative border rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 ${
                                      isAi
                                        ? "border-purple-400 dark:border-purple-700"
                                        : isArticle
                                          ? "border-amber-400 dark:border-amber-700"
                                          : isJjal
                                            ? "border-pink-400 dark:border-pink-700"
                                            : "border-emerald-300 dark:border-emerald-800"
                                    }`}
                                  >
                                    <div className="relative w-full aspect-[9/16]">
                                      {s.image ? (
                                        // 짤 mp4/webm — <video> 자동 재생 (gif는 img 태그가 알아서 재생)
                                        s.image.directVideoUrl &&
                                        (s.image.directVideoExt === "mp4" ||
                                          s.image.directVideoExt === "webm") ? (
                                          <video
                                            src={s.image.directVideoUrl}
                                            poster={
                                              s.image.thumbnailUrl ||
                                              s.image.imageUrl
                                            }
                                            autoPlay
                                            loop
                                            muted
                                            playsInline
                                            className="absolute inset-0 w-full h-full object-cover"
                                          />
                                        ) : isHovered &&
                                          isVideo &&
                                          s.image.embedUrl ? (
                                          <iframe
                                            src={`${s.image.embedUrl}?autoplay=1&mute=1&controls=0&loop=1&playlist=${s.image.videoId}&modestbranding=1&rel=0`}
                                            title="preview"
                                            allow="autoplay; encrypted-media"
                                            className="absolute inset-0 w-full h-full pointer-events-none"
                                          />
                                        ) : (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            src={
                                              s.image.directVideoExt === "gif"
                                                ? s.image.directVideoUrl ||
                                                  s.image.imageUrl
                                                : s.image.thumbnailUrl ||
                                                  s.image.imageUrl
                                            }
                                            alt={s.roleLabel}
                                            loading="lazy"
                                            className="absolute inset-0 w-full h-full object-cover"
                                          />
                                        )
                                      ) : (
                                        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-zinc-400">
                                          {cellBusy
                                            ? aiBusy
                                              ? "🎨 생성 중..."
                                              : "🎯 검색 중..."
                                            : "이미지 없음"}
                                        </div>
                                      )}
                                      {isVideo && !isHovered && !cellBusy && (
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                          <div className="bg-black/60 rounded-full w-7 h-7 flex items-center justify-center text-white text-xs">
                                            ▶
                                          </div>
                                        </div>
                                      )}
                                      {cellBusy && (
                                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-[10px] text-white">
                                          {aiBusy
                                            ? "🎨 AI 생성 중..."
                                            : webBusy
                                              ? "🖼️ 웹 검색 중..."
                                              : "🎯 검색 중..."}
                                        </div>
                                      )}
                                    </div>
                                    <div
                                      className={`absolute top-1 left-1 text-white text-[9px] px-1.5 py-0.5 rounded font-bold ${
                                        isAi
                                          ? "bg-purple-600"
                                          : isArticle
                                            ? "bg-amber-600"
                                            : isJjal
                                              ? "bg-pink-600"
                                              : "bg-emerald-600"
                                      }`}
                                    >
                                      {s.slot + 1}.{" "}
                                      {isAi
                                        ? "AI"
                                        : isArticle
                                          ? "📰"
                                          : isJjal
                                            ? "🤣"
                                            : s.role}
                                    </div>
                                    <div className="absolute top-1.5 right-1.5 flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          aiReplaceShot(
                                            activeSceneIndex,
                                            s.slot,
                                          )
                                        }
                                        disabled={busy !== null}
                                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-base px-2.5 py-1.5 rounded-md shadow-md"
                                        title="이 컷을 AI로 생성/교체"
                                      >
                                        🎨
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          webImageReplaceShot(
                                            activeSceneIndex,
                                            s.slot,
                                          )
                                        }
                                        disabled={busy !== null}
                                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-base px-2.5 py-1.5 rounded-md shadow-md"
                                        title="웹 이미지 (뉴스/블로그) 로 교체 — 누를 때마다 다른 이미지"
                                      >
                                        🖼️
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          jjalReplaceShot(
                                            activeSceneIndex,
                                            s.slot,
                                          )
                                        }
                                        disabled={busy !== null}
                                        className="bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white text-base px-2.5 py-1.5 rounded-md shadow-md"
                                        title={`이 컷을 짤(mp4/gif)로 교체 — 씬 감정 "${
                                          generatedScenes.find(
                                            (sc) =>
                                              sc.index === activeSceneIndex,
                                          )?.emotion || "놀람"
                                        }" 태그`}
                                      >
                                        🤣
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          smartRefreshShot(
                                            activeSceneIndex,
                                            s.slot,
                                          )
                                        }
                                        disabled={busy !== null}
                                        className="bg-black/80 hover:bg-black disabled:opacity-50 text-white text-base px-2.5 py-1.5 rounded-md shadow-md"
                                        title="이 컷 새로고침 — 이미지 컷은 이미지로, 영상 컷은 영상으로"
                                      >
                                        🔄
                                      </button>
                                    </div>
                                    <div className="px-1.5 py-1 bg-zinc-900/90 text-white text-[9px] leading-tight">
                                      <div className="font-medium truncate">
                                        {s.roleLabel}
                                      </div>
                                      {s.query && (
                                        <div className="text-zinc-300 truncate font-mono">
                                          {s.query}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                  </div>
                );
              })()
            )}
          </div>
        </section>
      )}

      {/* 제품 리서치 (접이식) */}
      {productResearch && (
        <details className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            🔎 제품 사용 맥락 (리서치 결과)
          </summary>
          <div className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300 mt-3">
            {productResearch}
          </div>
        </details>
      )}

      {generatedScenes.length > 0 && (
        <div className="flex justify-between">
          <Link
            href="/create/research"
            className="text-sm text-zinc-500 hover:underline"
          >
            ← 이전: 제품 리서치
          </Link>
          <Link
            href="/create/finalize"
            className="text-sm font-medium text-red-500 hover:underline"
          >
            다음: 영상 합성 →
          </Link>
        </div>
      )}
    </div>
  );
}
