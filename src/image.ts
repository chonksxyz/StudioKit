import { getGridSize, type ReadonlyStudioGrid } from "./grid.ts";

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
const MAX_CANVAS_DIMENSION = 2 ** 32 - 1;

function resolveScale(scale: number | undefined): number {
  const resolved = scale ?? DEFAULT_SCALE;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new Error("Studio image scale must be a positive integer");
  }
  return resolved;
}

function resolveCanvasDimensions(
  rows: number,
  columns: number,
  scale: number,
): { width: number; height: number } {
  const width = columns * scale;
  const height = rows * scale;
  if (width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION) {
    throw new Error("Studio image dimensions exceed the canvas size limit");
  }
  return { width, height };
}

export function drawStudioGrid(
  context: StudioFillContext,
  grid: ReadonlyStudioGrid,
  options: StudioImageOptions = {},
): void {
  const { rows, columns } = getGridSize(grid);
  const scale = resolveScale(options.scale);

  if (options.backgroundColor) {
    context.fillStyle = options.backgroundColor;
    context.fillRect(0, 0, columns * scale, rows * scale);
  }

  grid.cells.forEach((color, index) => {
    if (color === null) return;
    context.fillStyle = color;
    context.fillRect(
      (index % columns) * scale,
      Math.floor(index / columns) * scale,
      scale,
      scale,
    );
  });
}

export function studioGridToDataUrl(
  grid: ReadonlyStudioGrid,
  options: StudioImageEncodingOptions = {},
): string {
  const { rows, columns } = getGridSize(grid);
  const scale = resolveScale(options.scale);
  const { width, height } = resolveCanvasDimensions(rows, columns, scale);
  const documentTarget = options.documentTarget ?? globalThis.document;
  const canvas = documentTarget.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) return "";

  drawStudioGrid(context, grid, options);
  return canvas.toDataURL(options.type ?? "image/png", options.quality);
}

export function saveStudioGridImage(
  grid: ReadonlyStudioGrid,
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
