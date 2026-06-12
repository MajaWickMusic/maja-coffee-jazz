import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  allowedCorsOrigin,
  loadSetup,
  publishDueContainers,
  publishingGate
} from "../outputs/jazz-content-scheduler/backend/server.mjs";

test("loadSetup falls back to non-secret defaults when the config file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jazz-setup-"));
  try {
    const setup = await loadSetup(join(dir, "missing.json"));

    assert.equal(setup.igHandle, "@majascoffeejazzzone");
    assert.equal(setup.noSecretsInBrowser, true);
    assert.equal(setup.appId, "1365265765442781");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("publishingGate blocks the default manual mode", () => {
  const gate = publishingGate({});

  assert.equal(gate.ok, false);
  assert.equal(gate.dryRun, true);
  assert.equal(gate.mode, "manual");
  assert.match(gate.message, /Publishing is disabled/);
});

test("publishingGate blocks live modes when approval has been disabled", () => {
  const gate = publishingGate({
    PUBLISHING_MODE: "test",
    REQUIRE_APPROVAL: "false"
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.dryRun, true);
  assert.match(gate.message, /approval gate is disabled/);
});

test("publishingGate allows test mode when approval remains required", () => {
  const gate = publishingGate({
    PUBLISHING_MODE: "test",
    REQUIRE_APPROVAL: "true"
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.dryRun, false);
});

test("allowedCorsOrigin permits only local dashboard origins", () => {
  assert.equal(allowedCorsOrigin("null"), "null");
  assert.equal(allowedCorsOrigin("http://127.0.0.1:8080"), "http://127.0.0.1:8080");
  assert.equal(allowedCorsOrigin("http://localhost:8080"), "http://localhost:8080");
  assert.equal(allowedCorsOrigin("https://example.com"), "null");
});

test("publishDueContainers returns before hitting Meta while publishing is disabled", async () => {
  const result = await publishDueContainers(
    {
      items: [{
        id: "due-now",
        status: "scheduled",
        scheduledFor: "2020-01-01T10:00",
        title: "Due Now",
        caption: "Ready",
        publicVideoUrl: "https://example.com/reel.mp4"
      }],
      force: true
    },
    {}
  );

  assert.equal(result.ok, false);
  assert.equal(result.dryRun, true);
  assert.equal(result.items.length, 1);
});
