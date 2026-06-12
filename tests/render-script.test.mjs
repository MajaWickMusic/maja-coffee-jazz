import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("render manifest keeps a blank preview when thumbnail generation fails", async () => {
  const script = await readFile("work/render-reel-batch.ps1", "utf8");

  assert.match(script, /\$resolvedPreviewPath = ""/);
  assert.match(script, /Preview = \$resolvedPreviewPath/);
  assert.doesNotMatch(script, /Preview = \(Resolve-Path -LiteralPath \$previewPath\)\.Path/);
});
