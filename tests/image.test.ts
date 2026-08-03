import assert from "node:assert/strict";
import test from "node:test";
import { createGrid } from "../src/grid.ts";
import {
  drawStudioGrid,
  saveStudioGridImage,
  studioGridToDataUrl,
} from "../src/image.ts";

type Rect = { fillStyle: string; x: number; y: number; w: number; h: number };

function createRecordingContext() {
  const rects: Rect[] = [];
  const context = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ fillStyle: String(context.fillStyle), x, y, w, h });
    },
  };
  return { context, rects };
}

function createFakeDocument() {
  const clickedLinks: Array<{ download: string; href: string }> = [];
  const canvases: Array<{ width: number; height: number }> = [];
  const documentTarget = {
    createElement(tag: string) {
      if (tag === "canvas") {
        const { context } = createRecordingContext();
        const canvas = {
          width: 0,
          height: 0,
          getContext: () => context,
          toDataURL: (type: string) =>
            `data:${type};fake,${canvas.width}x${canvas.height}`,
        };
        canvases.push(canvas);
        return canvas;
      }
      const link = {
        download: "",
        href: "",
        click() {
          clickedLinks.push({ download: link.download, href: link.href });
        },
      };
      return link;
    },
  } as unknown as Document;
  return { documentTarget, clickedLinks, canvases };
}

test("draws only painted cells at the configured scale", () => {
  const grid = createGrid({ rows: 2, columns: 3 });
  grid[0][0] = "#111111";
  grid[1][2] = "#222222";
  const { context, rects } = createRecordingContext();

  drawStudioGrid(context, grid, { scale: 4 });

  assert.deepEqual(rects, [
    { fillStyle: "#111111", x: 0, y: 0, w: 4, h: 4 },
    { fillStyle: "#222222", x: 8, y: 4, w: 4, h: 4 },
  ]);
});

test("fills an optional background behind the pixels", () => {
  const grid = createGrid({ rows: 2, columns: 3 });
  grid[0][1] = "#abcdef";
  const { context, rects } = createRecordingContext();

  drawStudioGrid(context, grid, { scale: 2, backgroundColor: "#ffffff" });

  assert.deepEqual(rects[0], { fillStyle: "#ffffff", x: 0, y: 0, w: 6, h: 4 });
  assert.equal(rects.length, 2);
  assert.throws(() => drawStudioGrid(context, grid, { scale: 0 }), /positive/);
  assert.throws(
    () => drawStudioGrid(context, grid, { scale: 1.5 }),
    /positive integer/,
  );
});

test("encodes the grid to a data URL sized from the grid dimensions", () => {
  const grid = createGrid({ rows: 2, columns: 3 });
  const { documentTarget, canvases } = createFakeDocument();

  const dataUrl = studioGridToDataUrl(grid, { scale: 10, documentTarget });

  assert.equal(dataUrl, "data:image/png;fake,30x20");
  assert.deepEqual(canvases, [canvases[0]]);
  assert.throws(
    () =>
      studioGridToDataUrl(grid, {
        scale: 2 ** 32,
        documentTarget,
      }),
    /dimensions exceed/,
  );
});

test("saves the grid by clicking a download link", () => {
  const grid = createGrid({ rows: 1, columns: 1 });
  grid[0][0] = "#123456";
  const { documentTarget, clickedLinks } = createFakeDocument();

  const saved = saveStudioGridImage(grid, {
    scale: 8,
    fileName: "art.png",
    documentTarget,
  });

  assert.equal(saved, true);
  assert.equal(clickedLinks.length, 1);
  assert.equal(clickedLinks[0].download, "art.png");
  assert.equal(clickedLinks[0].href, "data:image/png;fake,8x8");
});
