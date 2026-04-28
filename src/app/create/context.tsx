"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type SceneScript = {
  index: number;
  text: string;
  emotion: string;
  durationSec: number;
};

export type ScriptAnalysis = {
  referenceUrl: string;
  originalScript: string;
  styleSummary: string;
  toneTags: string[];
  hookPattern: string;
  structureNotes: string;
};

export type VisualStyle =
  | "flat-2d"
  | "3d-cartoon"
  | "anime"
  | "stick-figure"
  | "watercolor"
  | "low-poly-3d"
  | "cyberpunk"
  | "custom";

export type ProductImage = {
  id: string;
  dataUrl: string;
  name: string;
};

export type GeneratedSceneAsset = {
  sceneIndex: number;
  imageDataUrl?: string;
  videoUrl?: string;
};

export type StoryAngleData = {
  id: string;
  angle: string;
  hook: string | null;
  fact: string | null;
  sources: string[] | null;
  productCategory: string | null;
};

export type ShotMedia = {
  imageUrl: string;
  sourceUrl: string;
  siteName: string;
  thumbnailUrl?: string;
  title: string;
  // 영상 클립인 경우만 채워짐 (YouTube)
  videoId?: string;
  embedUrl?: string;
  watchUrl?: string;
};

export type ShotEntry = {
  slot: number;
  role: string;
  roleLabel: string;
  query: string;
  image: ShotMedia | null;
};

export type WebSceneAsset =
  | {
      kind: "youtube-short";
      videoId: string;
      title: string;
      thumbnail: string;
      views: number;
      channel: string;
      embedUrl: string;
      watchUrl: string;
    }
  | {
      kind: "web-image";
      imageUrl: string;
      sourceUrl: string;
      title?: string;
      siteName?: string;
    }
  | {
      kind: "tiktok";
      videoId: string;
      coverUrl: string;
      title: string;
      author: string;
      playUrl?: string;
      watchUrl: string;
    };

type ProjectState = {
  analysis: ScriptAnalysis | null;
  setAnalysis: (a: ScriptAnalysis | null) => void;

  storyTopic: string;
  setStoryTopic: (v: string) => void;

  productName: string;
  setProductName: (v: string) => void;

  productResearch: string;
  setProductResearch: (v: string) => void;

  storyPremise: string;
  setStoryPremise: (v: string) => void;

  videoTitle: string;
  setVideoTitle: (v: string) => void;

  storyAngleData: StoryAngleData | null;
  setStoryAngleData: (v: StoryAngleData | null) => void;

  generatedScenes: SceneScript[];
  setGeneratedScenes: (s: SceneScript[]) => void;

  productImages: ProductImage[];
  setProductImages: (v: ProductImage[]) => void;

  visualStyle: VisualStyle;
  setVisualStyle: (v: VisualStyle) => void;

  customStylePrompt: string;
  setCustomStylePrompt: (v: string) => void;

  sceneAssets: GeneratedSceneAsset[];
  setSceneAssets: (v: GeneratedSceneAsset[]) => void;

  fetchedSceneAssets: Record<number, WebSceneAsset[]>;
  setFetchedSceneAssets: (
    v:
      | Record<number, WebSceneAsset[]>
      | ((
          prev: Record<number, WebSceneAsset[]>,
        ) => Record<number, WebSceneAsset[]>),
  ) => void;

  selectedSceneAssets: Record<number, WebSceneAsset[]>;
  setSelectedSceneAssets: (
    v:
      | Record<number, WebSceneAsset[]>
      | ((
          prev: Record<number, WebSceneAsset[]>,
        ) => Record<number, WebSceneAsset[]>),
  ) => void;

  // AI 이미지 생성: [sceneIndex][slot] = dataUrl ("" = 미생성/실패)
  sceneImages: Record<number, string[]>;
  setSceneImages: (
    v:
      | Record<number, string[]>
      | ((prev: Record<number, string[]>) => Record<number, string[]>),
  ) => void;

  styleGuide: string;
  setStyleGuide: (v: string) => void;

  scenePrompts: Record<number, string>;
  setScenePrompts: (
    v:
      | Record<number, string>
      | ((prev: Record<number, string>) => Record<number, string>),
  ) => void;

  anchorImageUrl: string;
  setAnchorImageUrl: (v: string) => void;

  // 구글 이미지 검색 결과 (씬별 후보)
  googleSceneImages: Record<
    number,
    {
      imageUrl: string;
      sourceUrl: string;
      title: string;
      siteName: string;
      thumbnailUrl?: string;
    }[]
  >;
  setGoogleSceneImages: (
    v:
      | Record<
          number,
          {
            imageUrl: string;
            sourceUrl: string;
            title: string;
            siteName: string;
            thumbnailUrl?: string;
          }[]
        >
      | ((
          prev: Record<
            number,
            {
              imageUrl: string;
              sourceUrl: string;
              title: string;
              siteName: string;
              thumbnailUrl?: string;
            }[]
          >,
        ) => Record<
          number,
          {
            imageUrl: string;
            sourceUrl: string;
            title: string;
            siteName: string;
            thumbnailUrl?: string;
          }[]
        >),
  ) => void;

  // 사용자가 선택한 구글 이미지 URL 집합 (씬별)
  selectedGoogleImageUrls: Record<number, string[]>;
  setSelectedGoogleImageUrls: (
    v:
      | Record<number, string[]>
      | ((prev: Record<number, string[]>) => Record<number, string[]>),
  ) => void;

  // 씬별로 사용된 (또는 사용자가 편집한) 구글 검색어
  googleQueriesByScene: Record<number, string[]>;
  setGoogleQueriesByScene: (
    v:
      | Record<number, string[]>
      | ((prev: Record<number, string[]>) => Record<number, string[]>),
  ) => void;

  // 기사 URL에서 추출한 씬별 이미지 (URL 직접)
  articleImagesByScene: Record<number, string[]>;
  setArticleImagesByScene: (
    v:
      | Record<number, string[]>
      | ((prev: Record<number, string[]>) => Record<number, string[]>),
  ) => void;

  // 씬별 자동 컷 구성 결과 (역할 기반 ordered, 5컷 — YouTube 영상 + 기사 + AI)
  shotlistByScene: Record<number, ShotEntry[]>;
  setShotlistByScene: (
    v:
      | Record<number, ShotEntry[]>
      | ((
          prev: Record<number, ShotEntry[]>,
        ) => Record<number, ShotEntry[]>),
  ) => void;

  // 클립별 자막 텍스트 (씬 단위 배열 — 클립 하나당 한 문장)
  clipCaptions: Record<number, string[]>;
  setClipCaptions: (
    v:
      | Record<number, string[]>
      | ((prev: Record<number, string[]>) => Record<number, string[]>),
  ) => void;

  ttsAudioUrl: string | null;
  setTtsAudioUrl: (v: string | null) => void;

  finalVideoUrl: string | null;
  setFinalVideoUrl: (v: string | null) => void;
};

const ProjectContext = createContext<ProjectState | null>(null);

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [analysis, setAnalysis] = useState<ScriptAnalysis | null>(null);
  const [storyTopic, setStoryTopic] = useState("");
  const [productName, setProductName] = useState("");
  const [productResearch, setProductResearch] = useState("");
  const [storyPremise, setStoryPremise] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [storyAngleData, setStoryAngleData] = useState<StoryAngleData | null>(
    null,
  );
  const [generatedScenes, setGeneratedScenes] = useState<SceneScript[]>([]);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("3d-cartoon");
  const [customStylePrompt, setCustomStylePrompt] = useState("");
  const [sceneAssets, setSceneAssets] = useState<GeneratedSceneAsset[]>([]);
  const [fetchedSceneAssets, setFetchedSceneAssets] = useState<
    Record<number, WebSceneAsset[]>
  >({});
  const [selectedSceneAssets, setSelectedSceneAssets] = useState<
    Record<number, WebSceneAsset[]>
  >({});
  const [sceneImages, setSceneImages] = useState<Record<number, string[]>>({});
  const [styleGuide, setStyleGuide] = useState("");
  const [scenePrompts, setScenePrompts] = useState<Record<number, string>>({});
  const [anchorImageUrl, setAnchorImageUrl] = useState("");
  const [googleSceneImages, setGoogleSceneImages] = useState<
    Record<
      number,
      {
        imageUrl: string;
        sourceUrl: string;
        title: string;
        siteName: string;
        thumbnailUrl?: string;
      }[]
    >
  >({});
  const [selectedGoogleImageUrls, setSelectedGoogleImageUrls] = useState<
    Record<number, string[]>
  >({});
  const [googleQueriesByScene, setGoogleQueriesByScene] = useState<
    Record<number, string[]>
  >({});
  const [articleImagesByScene, setArticleImagesByScene] = useState<
    Record<number, string[]>
  >({});
  const [shotlistByScene, setShotlistByScene] = useState<
    Record<number, ShotEntry[]>
  >({});
  const [clipCaptions, setClipCaptions] = useState<Record<number, string[]>>(
    {},
  );
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);

  return (
    <ProjectContext.Provider
      value={{
        analysis,
        setAnalysis,
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
        storyAngleData,
        setStoryAngleData,
        generatedScenes,
        setGeneratedScenes,
        productImages,
        setProductImages,
        visualStyle,
        setVisualStyle,
        customStylePrompt,
        setCustomStylePrompt,
        sceneAssets,
        setSceneAssets,
        fetchedSceneAssets,
        setFetchedSceneAssets,
        selectedSceneAssets,
        setSelectedSceneAssets,
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
        articleImagesByScene,
        setArticleImagesByScene,
        shotlistByScene,
        setShotlistByScene,
        clipCaptions,
        setClipCaptions,
        ttsAudioUrl,
        setTtsAudioUrl,
        finalVideoUrl,
        setFinalVideoUrl,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  const ctx = useContext(ProjectContext);
  if (!ctx)
    throw new Error("useProject must be used within ProjectProvider");
  return ctx;
}
