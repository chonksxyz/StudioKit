import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

const here = dirname(fileURLToPath(import.meta.url));
const studioDist = join(here, "..", "..", "dist");
const port = Number(process.env.PORT ?? 8787);

if (!existsSync(join(studioDist, "index.js"))) {
  console.error(
    "Studio has not been built yet — run `npm run build` in the package root\n" +
      "(or `npm run dev` here, which does it for you).",
  );
  process.exit(1);
}

// A stale dist/ fails at module-link time in the browser (missing exports),
// which takes the whole page down — warn while the fix is still obvious.
const studioSrc = join(here, "..", "..", "src");
const builtAt = statSync(join(studioDist, "index.js")).mtimeMs;
const isStale = readdirSync(studioSrc).some(
  (file) => file.endsWith(".ts") && statSync(join(studioSrc, file)).mtimeMs > builtAt,
);
if (isStale) {
  console.warn("Warning: dist/ is older than src/ — run `npm run dev` to rebuild.");
}

// serveStatic resolves `root` against process.cwd(), so keep the paths relative.
const from = (absolute) => `./${relative(process.cwd(), absolute)}`;

const app = new Hono();

// The browser loads Studio as plain ES modules: the build emits relative
// "./grid.js" specifiers, so dist/ can be served as-is with no bundler.
app.use(
  "/studio/*",
  serveStatic({
    root: from(studioDist),
    rewriteRequestPath: (path) => path.replace(/^\/studio/, ""),
  }),
);
app.use("/*", serveStatic({ root: from(join(here, "public")) }));

// 0.0.0.0 so the app is reachable when it runs inside a container or VM.
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`Pixel studio running at http://localhost:${info.port}`);
});
