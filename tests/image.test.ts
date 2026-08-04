import assert from "node:assert/strict";
import test from "node:test";
import { createGrid } from "../src/grid.ts";
import {
  drawStudioGrid,
  saveStudioGridImage,
  saveStudioGridSvg,
  studioGridToDataUrl,
  studioGridToSvg,
  studioGridToSvgDataUrl,
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

test("serializes only painted cells as scaled svg rects", () => {
  const grid = createGrid({ rows: 2, columns: 3 });
  grid[0][0] = "#111111";
  grid[1][2] = "#222222";

  const svg = studioGridToSvg(grid, { scale: 4 });

  assert.equal(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8" shape-rendering="crispEdges">' +
      '<rect x="0" y="0" width="4" height="4" fill="#111111"/>' +
      '<rect x="8" y="4" width="4" height="4" fill="#222222"/>' +
      "</svg>",
  );
  assert.throws(() => studioGridToSvg(grid, { scale: 0 }), /positive/);
  assert.throws(() => studioGridToSvg(grid, { scale: 1.5 }), /positive integer/);
});

test("merges horizontal runs of one color into single rects", () => {
  const grid = createGrid({ rows: 2, columns: 4 });
  grid[0] = ["#111111", "#111111", "#111111", "#222222"];
  grid[1] = [null, "#111111", "#111111", null];

  const svg = studioGridToSvg(grid, { scale: 2 });

  assert.equal(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4" viewBox="0 0 8 4" shape-rendering="crispEdges">' +
      '<rect x="0" y="0" width="6" height="2" fill="#111111"/>' +
      '<rect x="6" y="0" width="2" height="2" fill="#222222"/>' +
      '<rect x="2" y="2" width="4" height="2" fill="#111111"/>' +
      "</svg>",
  );
});

test("pretty printing puts one element per line", () => {
  const grid = createGrid({ rows: 1, columns: 2 });
  grid[0][0] = "#111111";

  const svg = studioGridToSvg(grid, { scale: 2, pretty: true, backgroundColor: "#ffffff" });

  assert.equal(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2" viewBox="0 0 4 2" shape-rendering="crispEdges">\n' +
      '  <rect width="4" height="2" fill="#ffffff"/>\n' +
      '  <rect x="0" y="0" width="2" height="2" fill="#111111"/>\n' +
      "</svg>",
  );
});

test("puts an optional svg background behind the pixels", () => {
  const grid = createGrid({ rows: 2, columns: 3 });
  grid[0][1] = "#abcdef";

  const svg = studioGridToSvg(grid, { scale: 2, backgroundColor: "#ffffff" });

  assert.match(
    svg,
    /^<svg [^>]*><rect width="6" height="4" fill="#ffffff"\/><rect x="2" y="0"/,
  );
});

test("escapes colors before they land in svg attributes", () => {
  const grid = createGrid({ rows: 1, columns: 1 });
  grid[0][0] = '"><script>&';

  const svg = studioGridToSvg(grid, { scale: 1 });

  assert.ok(svg.includes('fill="&quot;&gt;&lt;script&gt;&amp;"'));
  assert.ok(!svg.includes("<script>"));
});

test("drops xml-illegal characters that escaping cannot make well-formed", () => {
  const grid = createGrid({ rows: 1, columns: 1 });
  grid[0][0] = "#ff0000\u0001\uFFFE";

  assert.ok(studioGridToSvg(grid).includes('fill="#ff0000"'));

  grid[0][0] = "#00ff00\uD800"; // lone surrogate would make encodeURIComponent throw
  assert.ok(studioGridToSvg(grid).includes('fill="#00ff00"'));
  assert.doesNotThrow(() => studioGridToSvgDataUrl(grid));
});

test("skips holes and non-string cells the way the canvas path does", () => {
  const row = new Array(3) as (string | null)[]; // sparse: two holes
  row[1] = "#123456";
  const grid = [row, [null, 7 as unknown as string, "#123456"]];

  const svg = studioGridToSvg(grid, { scale: 2 });

  assert.ok(svg.includes('<rect x="2" y="0" width="2" height="2" fill="#123456"/>'));
  assert.ok(svg.includes('<rect x="4" y="2" width="2" height="2" fill="#123456"/>'));
  assert.ok(!svg.includes("undefined"));
});

test("encodes the svg into a data url that decodes back to the markup", () => {
  const grid = createGrid({ rows: 1, columns: 2 });
  grid[0][0] = "#ff0000";

  const dataUrl = studioGridToSvgDataUrl(grid, { scale: 3 });

  const prefix = "data:image/svg+xml;charset=utf-8,";
  assert.ok(dataUrl.startsWith(prefix));
  assert.equal(
    decodeURIComponent(dataUrl.slice(prefix.length)),
    studioGridToSvg(grid, { scale: 3 }),
  );
});

test("saves the svg by clicking a download link", () => {
  const grid = createGrid({ rows: 1, columns: 1 });
  grid[0][0] = "#123456";
  const { documentTarget, clickedLinks } = createFakeDocument();

  const saved = saveStudioGridSvg(grid, {
    scale: 8,
    fileName: "art.svg",
    documentTarget,
  });

  assert.equal(saved, true);
  assert.equal(clickedLinks.length, 1);
  assert.equal(clickedLinks[0].download, "art.svg");
  assert.equal(
    clickedLinks[0].href,
    studioGridToSvgDataUrl(grid, { scale: 8 }),
  );

  saveStudioGridSvg(grid, { documentTarget });
  assert.equal(clickedLinks[1].download, "studio.svg");
});
