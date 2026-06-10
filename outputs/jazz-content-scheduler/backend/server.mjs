import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const rootDir = dirname(fileURLToPath(import.meta.url));
const schedulerDir = resolve(rootDir, "..");
const workspaceRoot = resolve(schedulerDir, "..", "..");
const runDir = join(schedulerDir, "api-runs");
const env = await loadEnv(join(rootDir, ".env"));
const setup = await loadJson(join(rootDir, "config", "instagram-setup-config.json"));
const execFileAsync = promisify(execFile);

const PORT = Number(env.PORT || 8787);
const GRAPH_VERSION = env.META_GRAPH_VERSION || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const LIVE_MODES = new Set(["test", "live", "auto-approved"]);

if (process.argv.includes("--check-readiness")) {
  console.log(JSON.stringify(await readiness(), null, 2));
  process.exit(0);
}

if (process.argv.includes("--smoke-publish")) {
  console.log(JSON.stringify(await prepareInstagramReel({
    id: "smoke-test",
    status: "ready",
    title: "Smoke Test",
    caption: "Test caption",
    hashtags: "#test",
    publicVideoUrl: ""
  }), null, 2));
  process.exit(0);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "OPTIONS") {
      return options(response);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        service: "jazz-scheduler-backend",
        publishingEnabled: false
      });
    }

    if (request.method === "GET" && url.pathname === "/api/setup") {
      return json(response, 200, {
        setup,
        envStatus: envPresence()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/readiness") {
      return json(response, 200, await readiness());
    }

    if (request.method === "POST" && url.pathname === "/api/publish/instagram/reel") {
      const payload = await readJsonBody(request);
      return json(response, 200, await prepareInstagramReel(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/render/batch") {
      const payload = await readJsonBody(request);
      return json(response, 200, await renderBatch(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/render/latest") {
      return json(response, 200, await latestReviewBatch());
    }

    if (request.method === "POST" && url.pathname === "/api/r2/upload-package") {
      const payload = await readJsonBody(request);
      return json(response, 200, await uploadPackageToR2(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/instagram/create-containers") {
      const payload = await readJsonBody(request);
      return json(response, 200, await createInstagramContainers(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/instagram/publish-due") {
      const payload = await readJsonBody(request);
      return json(response, 200, await publishDueContainers(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/open-path") {
      const payload = await readJsonBody(request);
      return json(response, 200, await openPath(payload));
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, {
      error: "Backend error",
      message: error.message
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Jazz Scheduler backend listening on http://127.0.0.1:${PORT}`);
});

async function readiness() {
  const checks = [
    check("instagram_account_type", setup.igType === "creator" || setup.igType === "business", `Instagram is ${setup.igType}`),
    check("facebook_page_linked", Boolean(setup.pageLinked), setup.pageName),
    check("meta_app_created", setup.appStatus !== "not-created" && Boolean(setup.appId || env.META_APP_ID), env.META_APP_ID || setup.appId || ""),
    check("approval_required", setup.requireApproval !== false && env.REQUIRE_APPROVAL !== "false", "Approval gate is on"),
    check("secrets_not_in_browser", Boolean(setup.noSecretsInBrowser), "Secrets are backend-only"),
    check("env_meta_app_id", Boolean(env.META_APP_ID), "META_APP_ID"),
    check("env_page_id", Boolean(env.FACEBOOK_PAGE_ID), "FACEBOOK_PAGE_ID"),
    check("env_access_token", Boolean(env.META_ACCESS_TOKEN), "META_ACCESS_TOKEN"),
    check("env_app_secret", Boolean(env.META_APP_SECRET), "META_APP_SECRET")
  ];

  const graph = {
    skipped: !env.META_ACCESS_TOKEN,
    results: []
  };

  if (env.META_ACCESS_TOKEN) {
    graph.results.push(await graphCheck("token_me", "/me?fields=id,name"));
    graph.results.push(await graphCheck("permissions", "/me/permissions"));

    if (env.FACEBOOK_PAGE_ID) {
      graph.results.push(await graphCheck("facebook_page", `/${env.FACEBOOK_PAGE_ID}?fields=id,name,instagram_business_account`));
    }

    if (env.IG_USER_ID) {
      graph.results.push(await graphCheck("instagram_user", `/${env.IG_USER_ID}?fields=id,username,account_type`));
    }
  }

  const permissionChecks = summarizePermissions(graph.results);
  checks.push(...permissionChecks);

  return {
    ok: checks.every((item) => item.ok) && graph.results.every((item) => item.ok),
    publishingEnabled: LIVE_MODES.has(env.PUBLISHING_MODE || ""),
    note: LIVE_MODES.has(env.PUBLISHING_MODE || "")
      ? "Publishing bridge is available, with approval checks still enforced."
      : "Readiness only. Set PUBLISHING_MODE=test when you are ready to create Instagram media containers.",
    checks,
    graph
  };
}

async function renderBatch(payload = {}) {
  const count = clamp(Number(payload.count) || 10, 1, 50);
  const minSeconds = clamp(Number(payload.minSeconds) || 25, 5, 180);
  const maxSeconds = clamp(Number(payload.maxSeconds) || 45, minSeconds, 180);
  const fadeOutSeconds = clamp(Number(payload.fadeOutSeconds) || 4, 0, 20);
  const renderTimeoutSeconds = clamp(Number(payload.renderTimeoutSeconds) || 300, 30, 1800);
  const cooldownDays = clamp(Number(payload.cooldownDays) || 90, 0, 1000);
  const templateMode = payload.templateMode || "rotate";
  const renderPreset = payload.renderPreset || "balanced";

  const result = await runPowerShell([
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, "render-next-draft-reels.ps1"),
    "-Count", String(count),
    "-MinSeconds", String(minSeconds),
    "-MaxSeconds", String(maxSeconds),
    "-FadeOutSeconds", String(fadeOutSeconds),
    "-RenderTimeoutSeconds", String(renderTimeoutSeconds),
    "-CooldownDays", String(cooldownDays),
    "-RenderPreset", renderPreset,
    "-TemplateMode", templateMode
  ]);

  const manifest = matchLine(result.stdout, /^Review manifest:\s*(.+)$/m);
  const batchFolder = matchLine(result.stdout, /^Batch folder:\s*(.+)$/m);
  const items = await readReviewManifestItems(batchFolder);

  return {
    ok: true,
    message: `Rendered ${count} review draft${count === 1 ? "" : "s"}.`,
    batchFolder,
    manifest,
    items,
    output: result.stdout.trim()
  };
}

async function latestReviewBatch() {
  const manifestPath = await latestReviewManifest();
  if (!manifestPath) {
    return { ok: false, message: "No rendered batch folders found." };
  }
  const batchFolder = dirname(manifestPath);

  const items = await readReviewManifestItems(batchFolder);
  if (!items.length) {
    return { ok: false, message: "Latest batch does not have a review manifest yet.", batchFolder };
  }

  return {
    ok: true,
    message: `Loaded ${items.length} review item${items.length === 1 ? "" : "s"} from the latest batch.`,
    batchFolder,
    manifest: manifestPath,
    items
  };
}

async function uploadPackageToR2(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, message: "No approved publishing queue items were sent." };
  }

  await mkdir(runDir, { recursive: true });
  const stamp = fileStamp();
  const packagePath = join(runDir, `posting-package-${stamp}.json`);
  const uploadedPath = join(runDir, `posting-package-uploaded-${stamp}.json`);

  await writeFile(packagePath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    postingSettings: payload.postingSettings || {},
    items
  }, null, 2), "utf8");

  const result = await runNode([
    join(rootDir, "upload-r2-reels.mjs"),
    "--package", packagePath,
    "--out", uploadedPath
  ]);

  const uploaded = JSON.parse(await readFile(uploadedPath, "utf8"));
  return {
    ok: true,
    message: `Uploaded ${uploaded.items.filter((item) => item.uploadStatus === "uploaded").length} Reel MP4${uploaded.items.length === 1 ? "" : "s"} to R2.`,
    packagePath,
    uploadedPath,
    items: uploaded.items,
    output: result.stdout.trim()
  };
}

async function createInstagramContainers(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, message: "No uploaded Reel items were sent." };
  }

  await mkdir(runDir, { recursive: true });
  const stamp = fileStamp();
  const packagePath = join(runDir, `instagram-uploaded-${stamp}.json`);
  const containersPath = join(runDir, `instagram-containers-${stamp}.json`);

  await writeFile(packagePath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    postingSettings: payload.postingSettings || {},
    items
  }, null, 2), "utf8");

  const args = [
    join(rootDir, "create-instagram-containers.mjs"),
    "--package", packagePath,
    "--out", containersPath
  ];
  if (payload.dryRun) args.push("--dry-run");

  const result = await runNode(args);
  const containers = JSON.parse(await readFile(containersPath, "utf8"));
  const createdCount = containers.items.filter((item) => item.containerStatus === "container-created").length;
  const dryRunCount = containers.items.filter((item) => item.containerStatus === "dry-run").length;

  return {
    ok: true,
    message: dryRunCount
      ? `Prepared ${dryRunCount} Instagram container request${dryRunCount === 1 ? "" : "s"} in dry-run mode.`
      : `Created ${createdCount} Instagram media container${createdCount === 1 ? "" : "s"}.`,
    packagePath,
    containersPath,
    dryRun: containers.dryRun,
    items: containers.items,
    output: result.stdout.trim()
  };
}

async function publishDueContainers(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, message: "No scheduled container items were sent." };
  }

  await mkdir(runDir, { recursive: true });
  const now = new Date();
  const force = Boolean(payload.force);
  const updated = [];
  const published = [];
  const skipped = [];

  for (const item of items) {
    const scheduledAt = parseLocalDateTime(item.scheduledFor);
    const status = String(item.status || "").toLowerCase();

    if (!force && (!scheduledAt || scheduledAt > now)) {
      updated.push(item);
      skipped.push(item.title || item.id);
      continue;
    }

    if (status === "posted" || item.publishStatus === "published") {
      updated.push(item);
      skipped.push(item.title || item.id);
      continue;
    }

    let itemToPublish = item;
    let containerId = item.containerId;
    if (!containerId) {
      const publicVideoUrl = String(item.publicVideoUrl || "").trim();
      const caption = compactCaption(item.caption, item.hashtags);
      if (!/^https:\/\//i.test(publicVideoUrl)) {
        updated.push({ ...item, publishStatus: "missing-public-video-url" });
        skipped.push(item.title || item.id);
        continue;
      }
      if (!caption) {
        updated.push({ ...item, publishStatus: "missing-caption" });
        skipped.push(item.title || item.id);
        continue;
      }

      const created = await graphPost(`/${env.IG_USER_ID}/media`, {
        media_type: "REELS",
        video_url: publicVideoUrl,
        caption,
        share_to_feed: "true"
      });

      if (!created.ok || !created.body?.id) {
        updated.push({
          ...item,
          containerStatus: "container-error",
          publishStatus: "container-error",
          containerError: created.body || created.error || created.status
        });
        continue;
      }

      containerId = created.body.id;
      itemToPublish = {
        ...item,
        containerId,
        containerStatus: "container-created",
        containerCreatedAt: new Date().toISOString()
      };
    }

    const result = await graphPost(`/${env.IG_USER_ID}/media_publish`, {
      creation_id: containerId
    });

    if (result.ok) {
      const postedItem = {
        ...itemToPublish,
        status: "posted",
        publishStatus: "published",
        publishedAt: new Date().toISOString(),
        instagramMediaId: result.body?.id || ""
      };
      updated.push(postedItem);
      published.push(postedItem.title || postedItem.id);
    } else {
      updated.push({
        ...item,
        publishStatus: "publish-error",
        publishError: result.body || result.error || result.status
      });
    }
  }

  const outPath = join(runDir, `published-due-${fileStamp()}.json`);
  await writeFile(outPath, JSON.stringify({
    checkedAt: new Date().toISOString(),
    force,
    published,
    skipped,
    items: updated
  }, null, 2), "utf8");

  return {
    ok: true,
    message: `Published ${published.length} due Reel${published.length === 1 ? "" : "s"}. Skipped ${skipped.length}.`,
    publishedCount: published.length,
    skippedCount: skipped.length,
    outPath,
    items: updated
  };
}

async function openPath(payload = {}) {
  const path = payload.latestRenderedBatch
    ? await latestRenderedBatch()
    : String(payload.path || "");

  if (!path || !existsSync(path)) {
    return { ok: false, message: "Folder not found.", path };
  }

  spawn("explorer.exe", [path], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();

  return {
    ok: true,
    message: "Opened folder in File Explorer.",
    path
  };
}

async function latestRenderedBatch() {
  const renderedDir = join(schedulerDir, "rendered-reels");
  const entries = await readdir(renderedDir, { withFileTypes: true });
  const folders = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("batch-"))
    .map((entry) => join(renderedDir, entry.name));

  let latest = "";
  let latestTime = 0;
  for (const folder of folders) {
    const folderStat = await stat(folder);
    if (folderStat.mtimeMs > latestTime) {
      latest = folder;
      latestTime = folderStat.mtimeMs;
    }
  }
  return latest;
}

async function latestReviewManifest() {
  const renderedDir = join(schedulerDir, "rendered-reels");
  const entries = await readdir(renderedDir, { withFileTypes: true });
  let latest = "";
  let latestTime = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("batch-")) continue;
    const manifestPath = join(renderedDir, entry.name, "review-manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifestStat = await stat(manifestPath);
    if (manifestStat.mtimeMs > latestTime) {
      latest = manifestPath;
      latestTime = manifestStat.mtimeMs;
    }
  }

  return latest;
}

async function readReviewManifestItems(batchFolder) {
  if (!batchFolder) return [];
  const jsonPath = join(batchFolder, "review-manifest.json");
  if (!existsSync(jsonPath)) return [];
  const text = (await readFile(jsonPath, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function prepareInstagramReel(payload = {}) {
  const item = payload.item || payload;
  const publicVideoUrl = String(item.publicVideoUrl || item.videoUrl || "").trim();
  const caption = compactCaption(item.caption, item.hashtags);
  const mode = env.PUBLISHING_MODE || "manual";

  const checks = [
    check("approval_required", env.REQUIRE_APPROVAL !== "false", "Approval gate is on"),
    check("item_ready", ["ready", "scheduled", "approved"].includes(String(item.status || "").toLowerCase()), item.status || ""),
    check("public_video_url", /^https:\/\//i.test(publicVideoUrl), "Instagram needs a public HTTPS MP4 URL"),
    check("instagram_user_id", Boolean(env.IG_USER_ID), "IG_USER_ID"),
    check("access_token", Boolean(env.META_ACCESS_TOKEN), "META_ACCESS_TOKEN"),
    check("caption", Boolean(caption), "Caption available")
  ];

  if (!checks.every((entry) => entry.ok)) {
    return {
      ok: false,
      dryRun: true,
      mode,
      message: "This Reel is not ready for Instagram yet.",
      checks
    };
  }

  const mediaParams = {
    media_type: "REELS",
    video_url: publicVideoUrl,
    caption,
    share_to_feed: "true"
  };

  if (!LIVE_MODES.has(mode)) {
    return {
      ok: true,
      dryRun: true,
      mode,
      message: "Ready for Instagram API once publishing mode is changed to test.",
      checks,
      requestPreview: {
        createContainer: `POST /${env.IG_USER_ID}/media`,
        mediaParams: redactGraphBody(mediaParams),
        publishContainer: `POST /${env.IG_USER_ID}/media_publish`
      }
    };
  }

  const created = await graphPost(`/${env.IG_USER_ID}/media`, mediaParams);
  if (!created.ok) {
    return {
      ok: false,
      dryRun: false,
      mode,
      message: "Meta did not create the Reel container.",
      checks,
      graph: created
    };
  }

  return {
    ok: true,
    dryRun: false,
    mode,
    message: "Instagram Reel container created. Publishing is still a separate confirmation step.",
    checks,
    containerId: created.body.id,
    graph: created
  };
}

function check(id, ok, detail = "") {
  return {
    id,
    ok: Boolean(ok),
    detail
  };
}

async function graphCheck(id, path) {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${GRAPH_BASE}${path}${separator}access_token=${encodeURIComponent(env.META_ACCESS_TOKEN)}`;

  try {
    const result = await fetch(url);
    const body = await result.json();
    return {
      id,
      ok: result.ok,
      status: result.status,
      body: redactGraphBody(body)
    };
  } catch (error) {
    return {
      id,
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

async function graphPost(path, params) {
  const body = new URLSearchParams({
    ...params,
    access_token: env.META_ACCESS_TOKEN
  });

  try {
    const result = await fetch(`${GRAPH_BASE}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });
    const payload = await result.json();
    return {
      ok: result.ok,
      status: result.status,
      body: redactGraphBody(payload)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

function summarizePermissions(results) {
  const permissionsResult = results.find((item) => item.id === "permissions" && item.ok);
  if (!permissionsResult?.body?.data) {
    return [
      check("perm_instagram_basic", false, "Not verified"),
      check("perm_instagram_content_publish", false, "Not verified"),
      check("perm_pages_show_list", false, "Not verified"),
      check("perm_pages_read_engagement", false, "Not verified")
    ];
  }

  const granted = new Set(
    permissionsResult.body.data
      .filter((permission) => permission.status === "granted")
      .map((permission) => permission.permission)
  );

  return [
    check("perm_instagram_basic", granted.has("instagram_basic"), "instagram_basic"),
    check("perm_instagram_content_publish", granted.has("instagram_content_publish"), "instagram_content_publish"),
    check("perm_pages_show_list", granted.has("pages_show_list"), "pages_show_list"),
    check("perm_pages_read_engagement", granted.has("pages_read_engagement"), "pages_read_engagement")
  ];
}

function envPresence() {
  return {
    META_APP_ID: Boolean(env.META_APP_ID),
    META_APP_SECRET: Boolean(env.META_APP_SECRET),
    META_ACCESS_TOKEN: Boolean(env.META_ACCESS_TOKEN),
    FACEBOOK_PAGE_ID: Boolean(env.FACEBOOK_PAGE_ID),
    IG_USER_ID: Boolean(env.IG_USER_ID)
  };
}

function redactGraphBody(body) {
  if (!body || typeof body !== "object") return body;
  const clone = structuredClone(body);
  if (clone.access_token) clone.access_token = "[redacted]";
  return clone;
}

function compactCaption(caption = "", hashtags = "") {
  return [caption, hashtags]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2200);
}

async function runPowerShell(args) {
  return execFileAsync("powershell", args, {
    cwd: workspaceRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  });
}

async function runNode(args) {
  const node = process.execPath;
  return execFileAsync(node, args, {
    cwd: workspaceRoot,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function matchLine(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
}

function fileStamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
}

function parseLocalDateTime(value) {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function loadEnv(path) {
  const values = {};
  if (!existsSync(path)) return values;

  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    values[key] = unquote(value);
  }
  return values;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "null",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function options(response) {
  response.writeHead(204, {
    "access-control-allow-origin": "null",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end();
}
