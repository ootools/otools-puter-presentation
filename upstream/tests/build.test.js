import { describe, it, expect } from "vitest";
import { build } from "vite";
import { readFile } from "node:fs/promises";

// The build is served from wherever it is put: Vite rewrites index.html's own
// links through `base`, and whatever the app asks for while it runs has to
// follow the same base, or it is fetched from the server's root instead.
describe("asset paths", () => {
  it("asks for the app's own files through the configured base", async () => {
    const result = await build({
      configFile: false,
      root: process.cwd(),
      base: "/deep/path/",
      logLevel: "silent",
      build: { write: false },
    });
    const code = (Array.isArray(result) ? result[0] : result).output
      .filter((entry) => entry.type === "chunk")
      .map((entry) => entry.code)
      .join("");
    expect(code).toContain("/deep/path/icon.png");
    expect(code).not.toMatch(/["'`]\/icon\.png["'`]/);
  }, 60000);

  it("keeps the manifest's own paths beside the manifest", async () => {
    const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
    const paths = [
      manifest.id,
      manifest.start_url,
      manifest.scope,
      ...manifest.icons.map((entry) => entry.src),
    ];
    expect(paths.filter((path) => path.startsWith("/"))).toEqual([]);
  });
});
