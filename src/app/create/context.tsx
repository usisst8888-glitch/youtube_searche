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

type ProjectState = {
  analysis: ScriptAnalysis | null;
  setAnalysis: (a: ScriptAnalysis | null) => void;

  productName: string;
  setProductName: (v: string) => void;

  productResearch: string;
  setProductResearch: (v: string) => void;

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
  const [productName, setProductName] = useState("");
  const [productResearch, setProductResearch] = useState("");
  const [generatedScenes, setGeneratedScenes] = useState<SceneScript[]>([]);
  const [productImages, setProductImages] = useState<ProductImage[]>([]);
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("3d-cartoon");
  const [customStylePrompt, setCustomStylePrompt] = useState("");
  const [sceneAssets, setSceneAssets] = useState<GeneratedSceneAsset[]>([]);
  const [ttsAudioUrl, setTtsAudioUrl] = useState<string | null>(null);
  const [bgmAudioUrl, setBgmAudioUrl] = useState<string | null>(null);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);

  return (
    <ProjectContext.Provider
      value={{
        analysis,
        setAnalysis,
        productName,
        setProductName,
        productResearch,
        setProductResearch,
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
