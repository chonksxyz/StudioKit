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

export type StudioSvgOptions = StudioImageOptions & {
  /** One element per line, indented — for humans. Default is compact. */
  pretty?: boolean;
};

export type StudioSvgEncodingOptions = StudioSvgOptions & {
  documentTarget?: Document;
};

/* Cells are "any CSS color string", so colors are sanitized before landing in
 * an XML attribute — a malformed color must produce a broken fill, never break
 * out of the attribute or the document. Characters XML 1.0 forbids outright
 * (C0 controls except tab/newline/return, U+FFFE/FFFF, lone surrogates) are
 * dropped, since escaping cannot make them well-formed. */
const XML_ILLEGAL =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function escapeSvgAttribute(value: string): string {
  return value
    .replace(XML_ILLEGAL, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function studioGridToSvg(
  grid: StudioGrid,
  options: StudioSvgOptions = {},
): string {
  const { rows, columns } = getGridSize(grid);
  const scale = resolveScale(options.scale);
  const width = columns * scale;
  const height = rows * scale;

  /* shape-rendering="crispEdges" keeps adjacent cells seamless at any zoom —
   * the SVG counterpart of the exact fillRect edges in drawStudioGrid. */
  const openTag = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`;

  const parts: string[] = [];

  if (options.backgroundColor) {
    parts.push(
      `<rect width="${width}" height="${height}" fill="${escapeSvgAttribute(options.backgroundColor)}"/>`,
    );
  }

  /* Horizontal runs of the same color collapse into one rect. Cells tile, so
   * merged shapes render identically even for semi-transparent colors. Runs
   * compare colors as exact strings — "#f00" and "#ff0000" stay separate
   * rects, which only costs bytes, never fidelity. The typeof check (rather
   * than === null) skips holes and non-string cells in type-invalid grids,
   * matching the canvas path's tolerance of them. */
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      const color = row[x];
      if (typeof color !== "string") {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === color) end += 1;
      parts.push(
        `<rect x="${x * scale}" y="${y * scale}" width="${(end - x) * scale}" height="${scale}" fill="${escapeSvgAttribute(color)}"/>`,
      );
      x = end;
    }
  });

  if (!options.pretty) return `${openTag}${parts.join("")}</svg>`;
  const children = parts.map((part) => `  ${part}\n`).join("");
  return `${openTag}\n${children}</svg>`;
}

export function studioGridToSvgDataUrl(
  grid: StudioGrid,
  options: StudioSvgOptions = {},
): string {
  const svg = studioGridToSvg(grid, options);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function saveStudioGridSvg(
  grid: StudioGrid,
  options: StudioSvgEncodingOptions & { fileName?: string } = {},
): boolean {
  const dataUrl = studioGridToSvgDataUrl(grid, options);
  const documentTarget = options.documentTarget ?? globalThis.document;
  const link = documentTarget.createElement("a");
  link.download = options.fileName ?? "studio.svg";
  link.href = dataUrl;
  link.click();
  /* Returns boolean for symmetry with saveStudioGridImage, though SVG
   * serialization has no canvas-context failure mode. */
  return true;
}
