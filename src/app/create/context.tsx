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

  selectedSceneAsset: Record<number, WebSceneAsset>;
  setSelectedSceneAsset: (
    v:
      | Record<number, WebSceneAsset>
      | ((
          prev: Record<number, WebSceneAsset>,
        ) => Record<number, WebSceneAsset>),
  ) => void;

  ttsAudioUrl: string | null;
  setTtsAudioUrl: (v: string | null) => void;

  bgmAudioUrl: string | null;
  setBgmAudioUrl: (v: string | null) => void;

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
  const [generatedScenes, setGeneratedScenes] = useState<SceneScript[]>([]);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("3d-cartoon");
  const [customStylePrompt, setCustomStylePrompt] = useState("");
  const [sceneAssets, setSceneAssets] = useState<GeneratedSceneAsset[]>([]);
  const [fetchedSceneAssets, setFetchedSceneAssets] = useState<
    Record<number, WebSceneAsset[]>
  >({});
  const [selectedSceneAsset, setSelectedSceneAsset] = useState<
    Record<number, WebSceneAsset>
  >({});
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [bgmAudioUrl, setBgmAudioUrl] = useState<string | null>(null);
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
        selectedSceneAsset,
        setSelectedSceneAsset,
        ttsAudioUrl,
        setTtsAudioUrl,
        bgmAudioUrl,
        setBgmAudioUrl,
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
