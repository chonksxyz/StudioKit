import { getGridSize, type StudioGrid } from "./grid.ts";

export type StudioFillContext = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect: (x: number, y: number, width: number, height: number) => void;
};

export type StudioImageOptions = {
  scale?: number;
  backgroundColor?: string;
};

export type StudioImageEncodingOptions = StudioImageOptions & {
  type?: string;
  quality?: number;
  documentTarget?: Document;
};

const DEFAULT_SCALE = 16;

function resolveScale(scale: number | undefined): number {
  const resolved = scale ?? DEFAULT_SCALE;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new Error("Studio image scale must be a positive number");
  }
  return resolved;
}

export function drawStudioGrid(
  context: StudioFillContext,
  grid: StudioGrid,
  options: StudioImageOptions = {},
): void {
  const { rows, columns } = getGridSize(grid);
  const scale = resolveScale(options.scale);

  if (options.backgroundColor) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, columns * scale, rows * scale);
  }

  grid.forEach((row, y) => {
    row.forEach((color, x) => {
      if (color === null) return;
      context.fillStyle = color;
      context.fillRect(x * scale, y * scale, scale, scale);
    });
  });
}

export function studioGridToDataUrl(
  grid: StudioGrid,
  options: StudioImageEncodingOptions = {},
): string {
  const { rows, columns } = getGridSize(grid);
  const scale = resolveScale(options.scale);
  const documentTarget = options.documentTarget ?? globalThis.document;
  const canvas = documentTarget.createElement("canvas");
  canvas.width = columns * scale;
  canvas.height = rows * scale;

  const context = canvas.getContext("2d");
  if (!context) return "";

  drawStudioGrid(context, grid, options);
  return canvas.toDataURL(options.type ?? "image/png", options.quality);
}

export function saveStudioGridImage(
  grid: StudioGrid,
  options: StudioImageEncodingOptions & { fileName?: string } = {},
): boolean {
  const dataUrl = studioGridToDataUrl(grid, options);
  if (!dataUrl) return false;

  const documentTarget = options.documentTarget ?? globalThis.document;
  const link = documentTarget.createElement("a");
  link.download = options.fileName ?? "studio.png";
  link.href = dataUrl;
  link.click();
  return true;
}
