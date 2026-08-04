import { existsSync } from "node:fs";
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

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Pixel studio running at http://localhost:${info.port}`);
});
