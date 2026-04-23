import { VisualStyle } from "@/app/create/context";

export function buildStylePrompt(
  style: VisualStyle,
  custom: string,
): string {
  switch (style) {
    case "flat-2d":
      return "flat 2D illustration, clean vector art, bold outlines, pastel palette, storybook aesthetic";
    case "3d-cartoon":
      return "3D cartoon render, Pixar-style shading, soft warm lighting, friendly and cinematic";
    case "anime":
      return "Japanese anime art style, cel-shaded, expressive eyes, Makoto Shinkai-inspired lighting";
    case "stick-figure":
      return "minimalist stick-figure illustration, hand-drawn on white paper, doodle feel, black ink lines";
    case "watercolor":
      return "watercolor painting, soft gradient washes, gentle texture, emotional and atmospheric";
    case "low-poly-3d":
      return "low-poly 3D render, faceted geometric shapes, vibrant color blocks, stylized and modern";
    case "cyberpunk":
      return "cyberpunk aesthetic, neon pink and cyan lighting, futuristic, retro-CRT glitch elements";
    case "custom":
      return custom.trim() || "clean illustration, vivid colors";
  }
}
