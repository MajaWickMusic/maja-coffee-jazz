import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const rootDir = dirname(fileURLToPath(import.meta.url));
const schedulerDir = resolve(rootDir, "..");
const workspaceRoot = resolve(schedulerDir, "..", "..");
const runDir = join(schedulerDir, "api-runs");
const postingPlanPath = join(rootDir, "config", "posting-plan.json");
const userConfigPath = join(rootDir, "config", "user-config.json");
const env = await loadEnv(join(rootDir, ".env"));
const setup = await loadJson(join(rootDir, "config", "instagram-setup-config.json"));
const execFileAsync = promisify(execFile);

const PORT = Number(env.PORT || 8787);
const GRAPH_VERSION = env.META_GRAPH_VERSION || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const LIVE_MODES = new Set(["test", "live", "auto-approved"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a", ".aac", ".ogg"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
let currentRenderJob = null;
let currentUploadJob = null;
let currentPublishJob = null;

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

if (process.argv.includes("--publish-due-once")) {
  const result = await publishDueFromSavedPlan();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
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
        envStatus: envPresence(),
        userConfig: await loadUserConfig()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/user-config") {
      return json(response, 200, await getUserConfig());
    }

    if (request.method === "POST" && url.pathname === "/api/user-config") {
      const payload = await readJsonBody(request);
      return json(response, 200, await saveUserConfig(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/readiness") {
      return json(response, 200, await readiness());
    }

    if (request.method === "POST" && url.pathname === "/api/setup/pick-folder") {
      const payload = await readJsonBody(request);
      return json(response, 200, await pickFolder(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/library/scan") {
      const payload = await readJsonBody(request);
      return json(response, 200, await scanLibrary(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/publish/instagram/reel") {
      const payload = await readJsonBody(request);
      return json(response, 200, await prepareInstagramReel(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/render/batch") {
      const payload = await readJsonBody(request);
      return json(response, 200, await renderBatch(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/render/start") {
      const payload = await readJsonBody(request);
      return json(response, 200, await startRenderJob(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/render/status") {
      return json(response, 200, await renderJobStatus());
    }

    if (request.method === "POST" && url.pathname === "/api/render/cancel") {
      return json(response, 200, await cancelRenderJob());
    }

    if (request.method === "GET" && url.pathname === "/api/render/latest") {
      return json(response, 200, await latestReviewBatch());
    }

    if (request.method === "GET" && url.pathname === "/api/posting-plan") {
      return json(response, 200, await getPostingPlan());
    }

    if (request.method === "GET" && url.pathname === "/api/publishing-history") {
      return json(response, 200, await getPublishingHistory());
    }

    if (request.method === "GET" && url.pathname === "/api/meta/history") {
      return json(response, 200, await getMetaHistory());
    }

    if (request.method === "GET" && url.pathname === "/api/startup/status") {
      return json(response, 200, await startupPublisherStatus());
    }

    if (request.method === "POST" && url.pathname === "/api/startup/install") {
      return json(response, 200, await runStartupScript("install"));
    }

    if (request.method === "POST" && url.pathname === "/api/startup/uninstall") {
      return json(response, 200, await runStartupScript("uninstall"));
    }

    if (request.method === "POST" && url.pathname === "/api/startup/test") {
      return json(response, 200, await runStartupPublisherTest());
    }

    if (request.method === "POST" && url.pathname === "/api/startup/dashboard/install") {
      return json(response, 200, await runStartupDashboardScript("install"));
    }

    if (request.method === "POST" && url.pathname === "/api/startup/dashboard/uninstall") {
      return json(response, 200, await runStartupDashboardScript("uninstall"));
    }

    if (request.method === "POST" && url.pathname === "/api/posting-plan") {
      const payload = await readJsonBody(request);
      return json(response, 200, await savePostingPlan(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/r2/upload-package") {
      const payload = await readJsonBody(request);
      return json(response, 200, await uploadPackageToR2(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/r2/upload-start") {
      const payload = await readJsonBody(request);
      return json(response, 200, await startUploadJob(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/r2/upload-status") {
      return json(response, 200, await uploadJobStatus());
    }

    if (request.method === "GET" && url.pathname === "/api/r2/latest-upload") {
      return json(response, 200, await latestUploadedPackage());
    }

    if (request.method === "POST" && url.pathname === "/api/r2/upload-cancel") {
      return json(response, 200, await cancelUploadJob());
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
    check("env_app_secret", Boolean(env.META_APP_SECRET), "META_APP_SECRET"),
    check("env_page_access_token", Boolean(env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN), env.META_PAGE_ACCESS_TOKEN ? "META_PAGE_ACCESS_TOKEN" : "Using META_ACCESS_TOKEN")
  ];

  const graph = {
    skipped: !env.META_ACCESS_TOKEN,
    results: []
  };

  if (env.META_ACCESS_TOKEN) {
    graph.results.push(await graphCheck("token_me", "/me?fields=id,name"));
    graph.results.push(await graphCheck("permissions", "/me/permissions"));
    if (env.META_APP_ID && env.META_APP_SECRET) {
      graph.results.push(await graphDebugToken());
    }

    if (env.FACEBOOK_PAGE_ID) {
      graph.results.push(await graphCheck("facebook_page", `/${env.FACEBOOK_PAGE_ID}?fields=id,name,instagram_business_account`));
    }

    if (env.IG_USER_ID) {
      graph.results.push(await graphCheck("instagram_user", `/${env.IG_USER_ID}?fields=id,username,name`));
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
    summary: readinessSummary(checks, graph.results),
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

async function getUserConfig() {
  const configExists = existsSync(userConfigPath);
  const config = await loadUserConfig();
  return {
    ok: true,
    message: "Loaded local user setup config.",
    configPath: userConfigPath,
    configExists,
    config
  };
}

async function saveUserConfig(payload = {}) {
  const existing = await loadUserConfig();
  const config = {
    ...existing,
    ...sanitizeUserConfig(payload),
    updatedAt: new Date().toISOString()
  };
  config.setupWizard = {
    ...(existing.setupWizard || {}),
    ...(sanitizeUserConfig(payload).setupWizard || {})
  };
  config.postingSettings = {
    ...(existing.postingSettings || {}),
    ...(sanitizeUserConfig(payload).postingSettings || {})
  };
  config.instagramSetup = {
    ...(existing.instagramSetup || {}),
    ...(sanitizeUserConfig(payload).instagramSetup || {})
  };

  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, JSON.stringify(config, null, 2), "utf8");
  return {
    ok: true,
    message: "Saved local user setup config.",
    configPath: userConfigPath,
    config
  };
}

async function loadUserConfig() {
  const defaults = defaultUserConfig();
  if (!existsSync(userConfigPath)) return defaults;
  const parsed = JSON.parse((await readFile(userConfigPath, "utf8")).replace(/^\uFEFF/, ""));
  return {
    ...defaults,
    ...sanitizeUserConfig(parsed),
    setupWizard: {
      ...defaults.setupWizard,
      ...(sanitizeUserConfig(parsed).setupWizard || {})
    },
    postingSettings: {
      ...defaults.postingSettings,
      ...(sanitizeUserConfig(parsed).postingSettings || {})
    },
    instagramSetup: {
      ...defaults.instagramSetup,
      ...(sanitizeUserConfig(parsed).instagramSetup || {})
    }
  };
}

function defaultUserConfig() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: "",
    firstRunComplete: false,
    setupWizard: {
      artistName: "Maja's Coffee Jazz Zone",
      audioRoot: "",
      artworkRoot: "",
      lastScan: null
    },
    postingSettings: {},
    instagramSetup: {}
  };
}

function sanitizeUserConfig(value = {}) {
  const allowed = {};
  if (typeof value.firstRunComplete === "boolean") allowed.firstRunComplete = value.firstRunComplete;
  if (value.setupWizard && typeof value.setupWizard === "object") {
    allowed.setupWizard = {
      artistName: String(value.setupWizard.artistName || ""),
      audioRoot: String(value.setupWizard.audioRoot || ""),
      artworkRoot: String(value.setupWizard.artworkRoot || ""),
      lastScan: value.setupWizard.lastScan && typeof value.setupWizard.lastScan === "object" ? value.setupWizard.lastScan : null
    };
  }
  if (value.postingSettings && typeof value.postingSettings === "object") {
    allowed.postingSettings = { ...value.postingSettings };
  }
  if (value.instagramSetup && typeof value.instagramSetup === "object") {
    allowed.instagramSetup = { ...value.instagramSetup };
  }
  return allowed;
}

async function startRenderJob(payload = {}) {
  if (currentRenderJob?.running) {
    return {
      ok: false,
      message: "A review batch is already rendering. Stop it before starting another.",
      job: await renderJobStatus()
    };
  }

  await mkdir(runDir, { recursive: true });
  const id = `render-${fileStamp()}`;
  const progressPath = join(runDir, `${id}-progress.json`);
  const stdoutPath = join(runDir, `${id}-stdout.txt`);
  const stderrPath = join(runDir, `${id}-stderr.txt`);
  await writeProgress(progressPath, {
    stage: "starting",
    current: 0,
    total: clamp(Number(payload.count) || 10, 1, 50),
    percent: 0,
    message: "Starting render job..."
  });

  const count = clamp(Number(payload.count) || 10, 1, 50);
  const minSeconds = clamp(Number(payload.minSeconds) || 25, 5, 180);
  const maxSeconds = clamp(Number(payload.maxSeconds) || 45, minSeconds, 180);
  const fadeOutSeconds = clamp(Number(payload.fadeOutSeconds) || 4, 0, 20);
  const renderTimeoutSeconds = clamp(Number(payload.renderTimeoutSeconds) || 300, 30, 1800);
  const cooldownDays = clamp(Number(payload.cooldownDays) || 90, 0, 1000);
  const templateMode = payload.templateMode || "rotate";
  const renderPreset = payload.renderPreset || "balanced";

  const args = [
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, "render-next-draft-reels.ps1"),
    "-Count", String(count),
    "-MinSeconds", String(minSeconds),
    "-MaxSeconds", String(maxSeconds),
    "-FadeOutSeconds", String(fadeOutSeconds),
    "-RenderTimeoutSeconds", String(renderTimeoutSeconds),
    "-CooldownDays", String(cooldownDays),
    "-RenderPreset", renderPreset,
    "-TemplateMode", templateMode,
    "-ProgressPath", progressPath
  ];

  const child = spawn("powershell", args, {
    cwd: workspaceRoot,
    windowsHide: true
  });

  currentRenderJob = {
    id,
    running: true,
    startedAt: new Date().toISOString(),
    child,
    pid: child.pid,
    progressPath,
    stdoutPath,
    stderrPath,
    stdout: "",
    stderr: "",
    result: null,
    error: null,
    cancelled: false
  };

  child.stdout.on("data", async (chunk) => {
    currentRenderJob.stdout += chunk.toString();
    await writeFile(stdoutPath, currentRenderJob.stdout, "utf8").catch(() => {});
  });

  child.stderr.on("data", async (chunk) => {
    currentRenderJob.stderr += chunk.toString();
    await writeFile(stderrPath, currentRenderJob.stderr, "utf8").catch(() => {});
  });

  child.on("close", async (code) => {
    if (!currentRenderJob || currentRenderJob.id !== id) return;
    currentRenderJob.running = false;
    currentRenderJob.finishedAt = new Date().toISOString();
    currentRenderJob.exitCode = code;

    if (currentRenderJob.cancelled) {
      currentRenderJob.error = "Render stopped by user.";
      await writeProgress(progressPath, {
        stage: "cancelled",
        current: 0,
        total: count,
        percent: 0,
        message: "Render stopped."
      });
      return;
    }

    if (code !== 0) {
      currentRenderJob.error = currentRenderJob.stderr || `Render exited with code ${code}.`;
      await writeProgress(progressPath, {
        stage: "failed",
        current: 0,
        total: count,
        percent: 0,
        message: currentRenderJob.error
      });
      return;
    }

    const manifest = matchLine(currentRenderJob.stdout, /^Review manifest:\s*(.+)$/m);
    const batchFolder = matchLine(currentRenderJob.stdout, /^Batch folder:\s*(.+)$/m);
    const items = await readReviewManifestItems(batchFolder).catch(() => []);
    currentRenderJob.result = {
      ok: true,
      message: `Rendered ${items.length || count} review draft${(items.length || count) === 1 ? "" : "s"}.`,
      batchFolder,
      manifest,
      items,
      output: currentRenderJob.stdout.trim()
    };
    await writeProgress(progressPath, {
      stage: "complete",
      current: items.length || count,
      total: count,
      percent: 100,
      message: "Render complete. Loaded into Review."
    });
  });

  child.on("error", async (error) => {
    if (!currentRenderJob || currentRenderJob.id !== id) return;
    currentRenderJob.running = false;
    currentRenderJob.error = error.message;
    await writeProgress(progressPath, {
      stage: "failed",
      current: 0,
      total: count,
      percent: 0,
      message: error.message
    });
  });

  return {
    ok: true,
    message: "Review batch started.",
    id,
    status: await renderJobStatus()
  };
}

async function renderJobStatus() {
  if (!currentRenderJob) {
    return {
      ok: true,
      running: false,
      progress: {
        stage: "idle",
        current: 0,
        total: 0,
        percent: 0,
        message: "No render job is running."
      }
    };
  }

  const progress = await readProgress(currentRenderJob.progressPath, "Rendering...");
  return {
    ok: true,
    id: currentRenderJob.id,
    running: currentRenderJob.running,
    startedAt: currentRenderJob.startedAt,
    finishedAt: currentRenderJob.finishedAt || "",
    cancelled: Boolean(currentRenderJob.cancelled),
    error: currentRenderJob.error || "",
    result: currentRenderJob.result,
    progress
  };
}

async function cancelRenderJob() {
  if (!currentRenderJob?.running) {
    return { ok: true, message: "No render job is running.", status: await renderJobStatus() };
  }

  currentRenderJob.cancelled = true;
  const pid = currentRenderJob.pid;
  if (pid) {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {
      currentRenderJob.child.kill("SIGTERM");
    });
  } else {
    currentRenderJob.child.kill("SIGTERM");
  }

  await writeProgress(currentRenderJob.progressPath, {
    stage: "cancelled",
    current: 0,
    total: 0,
    percent: 0,
    message: "Stopping render job..."
  });

  return { ok: true, message: "Stopping render job.", status: await renderJobStatus() };
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

async function pickFolder(payload = {}) {
  const title = String(payload.title || "Select folder").replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${title}'
$dialog.ShowNewFolderButton = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;

  const result = await execFileAsync("powershell", [
    "-STA",
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-Command", script
  ], {
    cwd: workspaceRoot,
    windowsHide: false,
    maxBuffer: 1024 * 1024
  });

  const path = String(result.stdout || "").trim();
  return path
    ? { ok: true, path }
    : { ok: false, message: "No folder selected." };
}

async function scanLibrary(payload = {}) {
  const audioRoot = String(payload.audioRoot || "").trim();
  const artworkRoot = String(payload.artworkRoot || "").trim();
  const artistName = String(payload.artistName || "Unknown artist").trim() || "Unknown artist";
  const writeCatalog = payload.writeCatalog !== false;

  if (!audioRoot || !existsSync(audioRoot)) {
    return { ok: false, message: "Choose a valid audio folder first." };
  }

  const audioFiles = await listMediaFiles(audioRoot, AUDIO_EXTENSIONS);
  const artworkScanRoot = artworkRoot && existsSync(artworkRoot) ? artworkRoot : audioRoot;
  const artworkFiles = await listMediaFiles(artworkScanRoot, IMAGE_EXTENSIONS);
  const unsupportedFiles = uniquePaths([
    ...await listUnsupportedMediaFiles(audioRoot, new Set([...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS])),
    ...(artworkScanRoot !== audioRoot ? await listUnsupportedMediaFiles(artworkScanRoot, new Set([...AUDIO_EXTENSIONS, ...IMAGE_EXTENSIONS])) : [])
  ]);

  if (!audioFiles.length) {
    return { ok: false, message: "No audio files were found in that folder." };
  }

  const artworkIndex = buildArtworkIndex(artworkFiles, artworkScanRoot);
  const items = audioFiles.map((audioPath, index) => {
    const rel = relative(audioRoot, audioPath);
    const parts = rel.split(/[\\/]/).filter(Boolean);
    const folderParts = parts.slice(0, -1);
    const title = cleanTitle(basename(audioPath, extname(audioPath)));
    const album = folderParts[0] || cleanTitle(basename(dirname(audioPath)));
    const artwork = findArtworkForTrack({ title, album, folderParts, artworkIndex }) || "";

    return {
      id: `scan-${index + 1}-${Date.now()}`,
      title,
      artist: artistName,
      album,
      artworkUrl: artwork,
      audioUrl: audioPath,
      storeUrl: "",
      mood: "",
      bpm: null,
      isrc: "",
      importedAt: new Date().toISOString()
    };
  });

  const eligible = items.filter((item) => item.audioUrl && item.artworkUrl).length;
  const issues = buildLibraryIssues(items, unsupportedFiles);
  const duplicates = issues.filter((issue) => issue.type === "duplicate-title").length;
  const missingArtwork = issues.filter((issue) => issue.type === "missing-artwork").length;
  const missingAudio = issues.filter((issue) => issue.type === "missing-audio").length;
  let catalogPath = "";
  if (writeCatalog) {
    catalogPath = join(schedulerDir, "majas-coffee-jazz-zone-full-catalog-with-files.csv");
    await writeCatalogCsv(catalogPath, items);
    await mkdir(join(rootDir, "config"), { recursive: true });
    await writeFile(join(rootDir, "config", "local-library.json"), JSON.stringify({
      savedAt: new Date().toISOString(),
      audioRoot,
      artworkRoot,
      artistName,
      trackCount: items.length,
      eligibleCount: eligible,
      missingArtwork,
      missingAudio,
      duplicateCount: duplicates,
      unsupportedCount: unsupportedFiles.length,
      catalogPath
    }, null, 2), "utf8");
  }

  return {
    ok: true,
    message: `Scanned ${items.length} audio file${items.length === 1 ? "" : "s"}. ${eligible} have artwork and are ready for rendering.`,
    audioRoot,
    artworkRoot,
    artistName,
    catalogPath,
    trackCount: items.length,
    artworkCount: artworkFiles.length,
    eligibleCount: eligible,
    missingArtworkCount: missingArtwork,
    missingAudioCount: missingAudio,
    duplicateCount: duplicates,
    unsupportedCount: unsupportedFiles.length,
    issues,
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

async function startUploadJob(payload = {}) {
  if (currentUploadJob?.running) {
    return {
      ok: false,
      message: "An upload is already running. Stop it before starting another.",
      job: await uploadJobStatus()
    };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, message: "No approved publishing queue items were sent." };
  }

  await mkdir(runDir, { recursive: true });
  const id = `upload-${fileStamp()}`;
  const packagePath = join(runDir, `posting-package-${id}.json`);
  const uploadedPath = join(runDir, `posting-package-uploaded-${id}.json`);
  const progressPath = join(runDir, `${id}-progress.json`);
  const stdoutPath = join(runDir, `${id}-stdout.txt`);
  const stderrPath = join(runDir, `${id}-stderr.txt`);

  await writeFile(packagePath, JSON.stringify({
    exportedAt: new Date().toISOString(),
    postingSettings: payload.postingSettings || {},
    items
  }, null, 2), "utf8");

  await writeProgress(progressPath, {
    stage: "starting",
    current: 0,
    total: items.length,
    percent: 0,
    message: "Starting video upload..."
  });

  const child = spawn(process.execPath, [
    join(rootDir, "upload-r2-reels.mjs"),
    "--package", packagePath,
    "--out", uploadedPath,
    "--progress", progressPath
  ], {
    cwd: workspaceRoot,
    windowsHide: true
  });

  currentUploadJob = {
    id,
    running: true,
    startedAt: new Date().toISOString(),
    child,
    pid: child.pid,
    packagePath,
    uploadedPath,
    progressPath,
    stdoutPath,
    stderrPath,
    stdout: "",
    stderr: "",
    result: null,
    error: null,
    cancelled: false
  };

  child.stdout.on("data", async (chunk) => {
    currentUploadJob.stdout += chunk.toString();
    await writeFile(stdoutPath, currentUploadJob.stdout, "utf8").catch(() => {});
  });

  child.stderr.on("data", async (chunk) => {
    currentUploadJob.stderr += chunk.toString();
    await writeFile(stderrPath, currentUploadJob.stderr, "utf8").catch(() => {});
  });

  child.on("close", async (code) => {
    if (!currentUploadJob || currentUploadJob.id !== id) return;
    currentUploadJob.running = false;
    currentUploadJob.finishedAt = new Date().toISOString();
    currentUploadJob.exitCode = code;

    if (currentUploadJob.cancelled) {
      currentUploadJob.error = "Upload stopped by user.";
      await writeProgress(progressPath, {
        stage: "cancelled",
        current: 0,
        total: items.length,
        percent: 0,
        message: "Upload stopped."
      });
      return;
    }

    if (code !== 0) {
      currentUploadJob.error = currentUploadJob.stderr || `Upload exited with code ${code}.`;
      await writeProgress(progressPath, {
        stage: "failed",
        current: 0,
        total: items.length,
        percent: 0,
        message: currentUploadJob.error
      });
      return;
    }

    const uploaded = JSON.parse(await readFile(uploadedPath, "utf8"));
    const uploadedCount = uploaded.items.filter((item) => item.uploadStatus === "uploaded").length;
    currentUploadJob.result = {
      ok: true,
      message: `Uploaded ${uploadedCount} Reel MP4${uploadedCount === 1 ? "" : "s"} to R2.`,
      packagePath,
      uploadedPath,
      items: uploaded.items,
      output: currentUploadJob.stdout.trim()
    };
  });

  child.on("error", async (error) => {
    if (!currentUploadJob || currentUploadJob.id !== id) return;
    currentUploadJob.running = false;
    currentUploadJob.error = error.message;
    await writeProgress(progressPath, {
      stage: "failed",
      current: 0,
      total: items.length,
      percent: 0,
      message: error.message
    });
  });

  return {
    ok: true,
    message: "Upload started.",
    id,
    status: await uploadJobStatus()
  };
}

async function uploadJobStatus() {
  if (!currentUploadJob) {
    return {
      ok: true,
      running: false,
      progress: {
        stage: "idle",
        current: 0,
        total: 0,
        percent: 0,
        message: "No upload is running."
      }
    };
  }

  const progress = await readProgress(currentUploadJob.progressPath, "Uploading...");
  return {
    ok: true,
    id: currentUploadJob.id,
    running: currentUploadJob.running,
    startedAt: currentUploadJob.startedAt,
    finishedAt: currentUploadJob.finishedAt || "",
    cancelled: Boolean(currentUploadJob.cancelled),
    error: currentUploadJob.error || "",
    result: currentUploadJob.result,
    progress
  };
}

async function cancelUploadJob() {
  if (!currentUploadJob?.running) {
    return { ok: true, message: "No upload is running.", status: await uploadJobStatus() };
  }

  currentUploadJob.cancelled = true;
  const pid = currentUploadJob.pid;
  if (pid) {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {
      currentUploadJob.child.kill("SIGTERM");
    });
  } else {
    currentUploadJob.child.kill("SIGTERM");
  }

  await writeProgress(currentUploadJob.progressPath, {
    stage: "cancelled",
    current: 0,
    total: 0,
    percent: 0,
    message: "Stopping upload..."
  });

  return { ok: true, message: "Stopping upload.", status: await uploadJobStatus() };
}

async function latestUploadedPackage() {
  if (!existsSync(runDir)) {
    return { ok: false, message: "No upload history found yet." };
  }

  const files = await readdir(runDir);
  const candidates = [];
  for (const file of files) {
    if (!file.startsWith("posting-package-uploaded-") || !file.endsWith(".json")) continue;
    const path = join(runDir, file);
    const details = await stat(path).catch(() => null);
    if (details) candidates.push({ path, modified: details.mtimeMs });
  }

  candidates.sort((a, b) => b.modified - a.modified);
  const latest = candidates[0];
  if (!latest) {
    return { ok: false, message: "No uploaded package has been created yet." };
  }

  const packageData = JSON.parse(await readFile(latest.path, "utf8"));
  const items = Array.isArray(packageData.items) ? packageData.items : [];
  const uploadedCount = items.filter((item) => item.uploadStatus === "uploaded" || item.publicVideoUrl).length;

  return {
    ok: true,
    message: `Loaded latest upload result: ${uploadedCount} uploaded Reel${uploadedCount === 1 ? "" : "s"}.`,
    uploadedPath: latest.path,
    exportedAt: packageData.exportedAt || "",
    items
  };
}

async function getPostingPlan() {
  const plan = await loadPostingPlan();
  return {
    ok: true,
    message: `Loaded ${plan.items.length} planned Reel${plan.items.length === 1 ? "" : "s"}.`,
    ...plan
  };
}

async function savePostingPlan(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  await mkdir(dirname(postingPlanPath), { recursive: true });
  const plan = {
    updatedAt: new Date().toISOString(),
    items
  };
  await writeFile(postingPlanPath, JSON.stringify(plan, null, 2), "utf8");
  return {
    ok: true,
    message: `Saved ${items.length} planned Reel${items.length === 1 ? "" : "s"} for automatic publishing.`,
    ...plan
  };
}

async function loadPostingPlan() {
  if (!existsSync(postingPlanPath)) {
    return {
      updatedAt: "",
      items: []
    };
  }

  const parsed = JSON.parse((await readFile(postingPlanPath, "utf8")).replace(/^\uFEFF/, ""));
  return {
    updatedAt: parsed.updatedAt || "",
    items: Array.isArray(parsed.items) ? parsed.items : []
  };
}

async function publishDueFromSavedPlan() {
  const plan = await loadPostingPlan();
  if (!plan.items.length) {
    return {
      ok: true,
      message: "No saved Posting Plan items found.",
      items: []
    };
  }

  const result = await publishDueContainers({
    items: plan.items,
    postingSettings: {},
    force: false
  });

  if (result.ok && Array.isArray(result.items)) {
    await savePostingPlan({ items: result.items });
  }

  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, `startup-publish-${fileStamp()}.json`), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function getPublishingHistory() {
  if (!existsSync(runDir)) {
    return { ok: true, message: "No publishing history found yet.", items: [] };
  }

  const byKey = new Map();
  const files = (await readdir(runDir))
    .filter((file) => file.startsWith("published-due-") && file.endsWith(".json"))
    .sort();

  for (const file of files) {
    const path = join(runDir, file);
    const parsed = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    const checkedAt = parsed.checkedAt || "";
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      const instagramDone = item.status === "posted" || item.publishStatus === "published" || item.instagramMediaId;
      const facebookDone = item.facebookPublishStatus === "published" || item.facebookMediaId;
      if (!instagramDone && !facebookDone) continue;

      const key = publishLedgerKey(item);
      byKey.set(key, {
        id: item.id || "",
        title: item.title || "Untitled Reel",
        album: item.album || "Unknown album",
        scheduledFor: item.scheduledFor || "",
        instagramPublishedAt: item.publishedAt || "",
        facebookPublishedAt: item.facebookPublishedAt || "",
        instagramMediaId: item.instagramMediaId || "",
        facebookMediaId: item.facebookMediaId || "",
        instagramDone: Boolean(instagramDone),
        facebookDone: Boolean(facebookDone),
        video: item.video || "",
        publicVideoUrl: item.publicVideoUrl || "",
        sourceRun: file,
        lastSeenAt: checkedAt
      });
    }
  }

  const items = [...byKey.values()].sort((a, b) => {
    const first = new Date(b.instagramPublishedAt || b.facebookPublishedAt || b.lastSeenAt || 0).getTime();
    const second = new Date(a.instagramPublishedAt || a.facebookPublishedAt || a.lastSeenAt || 0).getTime();
    return first - second;
  });

  return {
    ok: true,
    message: `Loaded ${items.length} published item${items.length === 1 ? "" : "s"} from local history.`,
    items
  };
}

async function getMetaHistory() {
  const items = [];
  const errors = [];

  if (env.IG_USER_ID) {
    const instagram = await graphGet(`/${env.IG_USER_ID}/media`, {
      fields: "id,caption,media_type,permalink,timestamp",
      limit: "25"
    });
    if (instagram.ok && Array.isArray(instagram.body?.data)) {
      items.push(...instagram.body.data.map((item) => ({
        platform: "Instagram",
        id: item.id || "",
        title: firstCaptionLine(item.caption) || item.media_type || "Instagram post",
        caption: item.caption || "",
        permalink: item.permalink || "",
        publishedAt: item.timestamp || "",
        type: item.media_type || ""
      })));
    } else {
      errors.push(`Instagram: ${graphErrorMessage(instagram)}`);
    }
  }

  if (env.FACEBOOK_PAGE_ID) {
    const facebook = await graphGet(`/${env.FACEBOOK_PAGE_ID}/posts`, {
      fields: "id,message,permalink_url,created_time",
      limit: "25"
    }, pageAccessToken());
    if (facebook.ok && Array.isArray(facebook.body?.data)) {
      items.push(...facebook.body.data.map((item) => ({
        platform: "Facebook",
        id: item.id || "",
        title: firstCaptionLine(item.message) || "Facebook post",
        caption: item.message || "",
        permalink: item.permalink_url || "",
        publishedAt: item.created_time || "",
        type: "post"
      })));
    } else {
      errors.push(`Facebook: ${graphErrorMessage(facebook)}`);
    }
  }

  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  return {
    ok: errors.length === 0,
    message: errors.length
      ? `Loaded ${items.length} live Meta post${items.length === 1 ? "" : "s"}, with ${errors.length} issue${errors.length === 1 ? "" : "s"}.`
      : `Loaded ${items.length} live Meta post${items.length === 1 ? "" : "s"}.`,
    items,
    errors
  };
}

async function startupPublisherStatus() {
  const startupPath = process.env.APPDATA
    ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Maja Coffee Jazz Daily Publisher.cmd")
    : "";
  const dashboardStartupPath = process.env.APPDATA
    ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "Maja Coffee Jazz Dashboard.cmd")
    : "";
  const logs = existsSync(runDir)
    ? (await readdir(runDir)).filter((file) => file.startsWith("startup-publish-") && file.endsWith(".json")).sort()
    : [];
  const latestLog = logs.at(-1) || "";
  let latest = null;
  let latestRunAt = "";
  if (latestLog) {
    const latestPath = join(runDir, latestLog);
    latest = JSON.parse((await readFile(latestPath, "utf8")).replace(/^\uFEFF/, ""));
    const details = await stat(latestPath).catch(() => null);
    latestRunAt = details?.mtime ? details.mtime.toISOString() : "";
  }

  return {
    ok: true,
    installed: Boolean(startupPath && existsSync(startupPath)),
    dashboardInstalled: Boolean(dashboardStartupPath && existsSync(dashboardStartupPath)),
    startupPath,
    dashboardStartupPath,
    latestLog: latestLog ? join(runDir, latestLog) : "",
    latestRunAt,
    latest
  };
}

async function runStartupScript(action) {
  const script = action === "uninstall" ? "uninstall-startup-publisher.ps1" : "install-startup-publisher.ps1";
  const result = await runPowerShell([
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, script)
  ]);
  return {
    ok: true,
    message: action === "uninstall" ? "Startup publisher removed." : "Startup publisher installed.",
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    status: await startupPublisherStatus()
  };
}

async function runStartupPublisherTest() {
  const result = await publishDueFromSavedPlan();
  return {
    ...result,
    message: `Startup publisher test finished. ${result.message || ""}`.trim(),
    status: await startupPublisherStatus()
  };
}

async function runStartupDashboardScript(action) {
  const script = action === "uninstall" ? "uninstall-startup-dashboard.ps1" : "install-startup-dashboard.ps1";
  const result = await runPowerShell([
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, script)
  ]);
  return {
    ok: true,
    message: action === "uninstall" ? "Dashboard startup opener removed." : "Dashboard startup opener installed.",
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    status: await startupPublisherStatus()
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
  if (currentPublishJob) {
    return {
      ok: false,
      message: "Publishing is already running. Wait for the current publish check to finish.",
      running: true,
      startedAt: currentPublishJob.startedAt
    };
  }

  currentPublishJob = {
    startedAt: new Date().toISOString()
  };

  try {
    return await publishDueContainersUnlocked(payload);
  } finally {
    currentPublishJob = null;
  }
}

async function publishDueContainersUnlocked(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) {
    return { ok: false, message: "No scheduled container items were sent." };
  }
  await mkdir(runDir, { recursive: true });
  const now = new Date();
  const force = Boolean(payload.force);
  const postingSettings = payload.postingSettings || {};
  const maxPublishesPerDay = force ? Number.POSITIVE_INFINITY : clamp(Number(postingSettings.maxPostsPerDay) || 1, 1, 10);
  const duplicateCooldownDays = force ? 0 : clamp(Number(postingSettings.postingCooldown) || 90, 0, 1000);
  const updated = [];
  const published = [];
  const skipped = [];
  const skipReasons = [];
  const errors = [];
  const ledger = await loadPublishLedger();
  let ledgerChanged = false;
  let publishedThisRun = 0;
  const alreadyPublishedToday = force ? 0 : countLedgerPublishesOnDate(ledger, now);

  for (const item of items) {
    const scheduledAt = parseLocalDateTime(item.scheduledFor);
    const status = String(item.status || "").toLowerCase();
    const label = item.title || item.id;
    const ledgerKey = publishLedgerKey(item);
    const facebookLedgerKey = `${ledgerKey}|facebook-page`;

    if (!force && (!scheduledAt || scheduledAt > now)) {
      updated.push(item);
      skipped.push(label);
      skipReasons.push({ item: label, reason: scheduledAt ? `not due until ${scheduledAt.toLocaleString()}` : "no scheduled time" });
      continue;
    }

    const ledgerHit = ledger.items[ledgerKey];
    if (ledgerHit) {
      const facebookLedgerHit = ledger.items[facebookLedgerKey];
      const postedItem = {
        ...item,
        status: "posted",
        publishStatus: "published",
        publishedAt: ledgerHit.publishedAt || item.publishedAt || "",
        instagramMediaId: ledgerHit.instagramMediaId || item.instagramMediaId || "",
        facebookMediaId: facebookLedgerHit?.facebookMediaId || item.facebookMediaId || "",
        facebookPublishedAt: facebookLedgerHit?.publishedAt || item.facebookPublishedAt || "",
        publishError: ""
      };

      if (!facebookLedgerHit) {
        const facebookResult = await publishFacebookPageVideo(postedItem);
        if (facebookResult.ok) {
          postedItem.facebookPublishStatus = "published";
          postedItem.facebookPublishedAt = new Date().toISOString();
          postedItem.facebookMediaId = facebookResult.mediaId || "";
          ledger.items[facebookLedgerKey] = {
            id: postedItem.id || "",
            title: postedItem.title || "",
            isrc: postedItem.isrc || postedItem.ISRC || "",
            scheduledFor: postedItem.scheduledFor || "",
            platform: "facebook-page",
            publishedAt: postedItem.facebookPublishedAt,
            facebookMediaId: postedItem.facebookMediaId || ""
          };
          ledgerChanged = true;
          published.push(`${label} Facebook Page`);
        } else {
          postedItem.facebookPublishStatus = "publish-error";
          postedItem.facebookPublishError = facebookResult.reason;
          errors.push({ item: label, step: "facebook-page", reason: facebookResult.reason });
        }
      } else {
        skipped.push(label);
        skipReasons.push({ item: label, reason: "already published to Instagram and Facebook" });
      }

      updated.push(postedItem);
      continue;
    }

    if ((alreadyPublishedToday + publishedThisRun) >= maxPublishesPerDay) {
      updated.push(item);
      skipped.push(label);
      skipReasons.push({ item: label, reason: `daily safety limit reached (${maxPublishesPerDay} per day)` });
      continue;
    }

    const recentDuplicate = findRecentPublishedDuplicate(ledger, item, duplicateCooldownDays, now);
    if (recentDuplicate) {
      updated.push({ ...item, publishStatus: "cooldown-held", publishError: recentDuplicate.reason });
      skipped.push(label);
      skipReasons.push({ item: label, reason: recentDuplicate.reason });
      continue;
    }

    if (status === "posted" || item.publishStatus === "published") {
      updated.push(item);
      skipped.push(label);
      skipReasons.push({ item: label, reason: "already posted to Instagram, but not found in the local ledger" });
      continue;
    }

    let itemToPublish = item;
    let containerId = item.containerId;
    if (!containerId) {
      const publicVideoUrl = String(item.publicVideoUrl || "").trim();
      const caption = compactCaption(item.caption, item.hashtags);
      if (!/^https:\/\//i.test(publicVideoUrl)) {
        updated.push({ ...item, publishStatus: "missing-public-video-url" });
        skipped.push(label);
        skipReasons.push({ item: label, reason: "missing public video URL" });
        continue;
      }
      if (!caption) {
        updated.push({ ...item, publishStatus: "missing-caption" });
        skipped.push(label);
        skipReasons.push({ item: label, reason: "missing caption" });
        continue;
      }

      const created = await graphPost(`/${env.IG_USER_ID}/media`, {
        media_type: "REELS",
        video_url: publicVideoUrl,
        caption,
        share_to_feed: "true"
      });

      if (!created.ok || !created.body?.id) {
        const reason = graphErrorMessage(created);
        updated.push({
          ...item,
          containerStatus: "container-error",
          publishStatus: "container-error",
          publishError: reason,
          containerError: created.body || created.error || created.status
        });
        errors.push({ item: label, step: "container", reason });
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

    const containerReady = await waitForContainerReady(containerId);
    itemToPublish = {
      ...itemToPublish,
      containerStatus: containerReady.statusCode || containerReady.reason,
      containerStatusCheckedAt: new Date().toISOString()
    };

    if (!containerReady.ready) {
      const reason = containerReady.reason || "Meta is still processing the video.";
      updated.push({
        ...itemToPublish,
        publishStatus: containerReady.retryable ? "container-processing" : "container-error",
        publishError: reason
      });
      if (containerReady.retryable) {
        skipped.push(label);
        skipReasons.push({ item: label, reason });
      } else {
        errors.push({ item: label, step: "container-status", reason });
      }
      continue;
    }

    const result = await graphPost(`/${env.IG_USER_ID}/media_publish`, {
      creation_id: containerId
    });

    if (result.ok) {
      let facebookResult = null;
      const postedItem = {
        ...itemToPublish,
        status: "posted",
        publishStatus: "published",
        publishedAt: new Date().toISOString(),
        instagramMediaId: result.body?.id || ""
      };

      facebookResult = await publishFacebookPageVideo(postedItem);
      if (facebookResult.ok) {
        postedItem.facebookPublishStatus = "published";
        postedItem.facebookPublishedAt = new Date().toISOString();
        postedItem.facebookMediaId = facebookResult.mediaId || "";
      } else {
        postedItem.facebookPublishStatus = "publish-error";
        postedItem.facebookPublishError = facebookResult.reason;
        errors.push({ item: label, step: "facebook-page", reason: facebookResult.reason });
      }

      updated.push(postedItem);
      published.push(postedItem.title || postedItem.id);
      publishedThisRun += 1;
      ledger.items[ledgerKey] = {
        id: postedItem.id || "",
        title: postedItem.title || "",
        isrc: postedItem.isrc || postedItem.ISRC || "",
        scheduledFor: postedItem.scheduledFor || "",
        platform: postedItem.platform || "",
        publishedAt: postedItem.publishedAt,
        instagramMediaId: postedItem.instagramMediaId,
        containerId: postedItem.containerId || ""
      };
      if (postedItem.facebookPublishStatus === "published") {
        ledger.items[facebookLedgerKey] = {
          id: postedItem.id || "",
          title: postedItem.title || "",
          isrc: postedItem.isrc || postedItem.ISRC || "",
          scheduledFor: postedItem.scheduledFor || "",
          platform: "facebook-page",
          publishedAt: postedItem.facebookPublishedAt,
          facebookMediaId: postedItem.facebookMediaId || ""
        };
      }
      ledgerChanged = true;
    } else {
      const reason = graphErrorMessage(result);
      const mediaUnavailable = /media id is not available/i.test(reason);
      updated.push({
        ...itemToPublish,
        publishStatus: mediaUnavailable ? "container-processing" : "publish-error",
        publishError: reason
      });
      if (mediaUnavailable) {
        skipped.push(label);
        skipReasons.push({ item: label, reason: "Meta is still processing the video. Try Publish due now again in a few minutes." });
      } else {
        errors.push({ item: label, step: "publish", reason });
      }
    }
  }

  const outPath = join(runDir, `published-due-${fileStamp()}.json`);
  if (ledgerChanged) {
    await savePublishLedger(ledger);
  }
  await writeFile(outPath, JSON.stringify({
    checkedAt: new Date().toISOString(),
    force,
    published,
    skipped,
    skipReasons,
    errors,
    items: updated
  }, null, 2), "utf8");

  const futureSkips = skipReasons.filter((entry) => /^not due until/i.test(entry.reason || ""));
  const actionableSkips = skipReasons.filter((entry) => !/^not due until/i.test(entry.reason || ""));
  const nextSkip = actionableSkips[0]?.reason ? ` First skip: ${actionableSkips[0].item} - ${actionableSkips[0].reason}.` : "";
  const nextError = errors[0]?.reason ? ` First error: ${errors[0].item} - ${errors[0].reason}.` : "";
  const outcomes = [
    ...published.map((item) => ({ item, result: "published" })),
    ...actionableSkips.map((entry) => ({ item: entry.item, result: entry.reason })),
    ...errors.map((entry) => ({ item: entry.item, result: entry.reason }))
  ];
  const outcomeParts = [];
  if (outcomes.length) {
    outcomeParts.push(`Outcomes: ${outcomes.map((entry) => `${entry.item}: ${entry.result}`).join(" | ")}`);
  }
  if (futureSkips.length) {
    outcomeParts.push(`${futureSkips.length} future Reel${futureSkips.length === 1 ? "" : "s"} not due yet.`);
  }
  const outcomeSummary = outcomeParts.length ? ` ${outcomeParts.join(" ")}` : "";
  return {
    ok: true,
    message: errors.length
      ? `Published ${published.length} Instagram Reel${published.length === 1 ? "" : "s"}. ${errors.length} follow-up step${errors.length === 1 ? "" : "s"} failed.${nextError}`
      : `Published ${published.length} due Reel${published.length === 1 ? "" : "s"}. Skipped ${skipped.length}.${nextSkip}`,
    publishedCount: published.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    outcomeSummary,
    outcomes,
    skipReasons,
    errors,
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

async function loadPublishLedger() {
  const ledgerPath = join(runDir, "published-ledger.json");
  if (existsSync(ledgerPath)) {
    const parsed = JSON.parse((await readFile(ledgerPath, "utf8")).replace(/^\uFEFF/, ""));
    return {
      updatedAt: parsed.updatedAt || "",
      items: parsed.items && typeof parsed.items === "object" ? parsed.items : {}
    };
  }

  const ledger = {
    updatedAt: new Date().toISOString(),
    items: {}
  };

  if (!existsSync(runDir)) return ledger;

  const files = await readdir(runDir).catch(() => []);
  for (const file of files.filter((entry) => entry.startsWith("published-due-") && entry.endsWith(".json"))) {
    const path = join(runDir, file);
    const parsed = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    for (const item of items) {
      if (item.status !== "posted" && item.publishStatus !== "published") continue;
      ledger.items[publishLedgerKey(item)] = {
        id: item.id || "",
        title: item.title || "",
        isrc: item.isrc || item.ISRC || "",
        scheduledFor: item.scheduledFor || "",
        platform: item.platform || "",
        publishedAt: item.publishedAt || parsed.checkedAt || "",
        instagramMediaId: item.instagramMediaId || "",
        containerId: item.containerId || ""
      };
    }
  }

  return ledger;
}

async function savePublishLedger(ledger) {
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, "published-ledger.json"), JSON.stringify({
    updatedAt: new Date().toISOString(),
    items: ledger.items || {}
  }, null, 2), "utf8");
}

async function publishFacebookPageVideo(item) {
  if (!env.FACEBOOK_PAGE_ID) {
    return { ok: false, reason: "FACEBOOK_PAGE_ID is missing." };
  }

  const publicVideoUrl = String(item.publicVideoUrl || "").trim();
  if (!/^https:\/\//i.test(publicVideoUrl)) {
    return { ok: false, reason: "Facebook Page publish needs the public MP4 URL." };
  }

  const result = await graphPost(`/${env.FACEBOOK_PAGE_ID}/videos`, {
    file_url: publicVideoUrl,
    description: compactCaption(item.caption, item.hashtags),
    published: "true"
  }, pageAccessToken());

  if (!result.ok) {
    return {
      ok: false,
      reason: graphErrorMessage(result),
      graph: result
    };
  }

  return {
    ok: true,
    mediaId: result.body?.id || "",
    graph: result
  };
}

function pageAccessToken() {
  return env.META_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN;
}

function publishLedgerKey(item) {
  const identity = item.id || item.isrc || item.ISRC || item.title || "unknown";
  const date = String(item.scheduledFor || "").slice(0, 10) || "unscheduled";
  const platform = item.platform || "instagram-reel";
  return `${identity}|${date}|${platform}`.toLowerCase();
}

function findRecentPublishedDuplicate(ledger, item, cooldownDays, now = new Date()) {
  if (!cooldownDays) return null;
  const title = normalizeKey(item.title || "");
  const isrc = normalizeKey(item.isrc || item.ISRC || "");
  const id = normalizeKey(item.id || "");
  if (!title && !isrc && !id) return null;

  const cutoff = now.getTime() - cooldownDays * 86400000;
  for (const entry of Object.values(ledger.items || {})) {
    const publishedAt = new Date(entry.publishedAt || 0).getTime();
    if (!publishedAt || publishedAt < cutoff) continue;
    const sameId = id && normalizeKey(entry.id || "") === id;
    const sameTitle = title && normalizeKey(entry.title || "") === title;
    const sameIsrc = isrc && normalizeKey(entry.isrc || "") === isrc;
    if (sameId || sameTitle || sameIsrc) {
      const last = entry.publishedAt ? new Date(entry.publishedAt).toLocaleDateString() : "recently";
      return { reason: `recently posted within ${cooldownDays} days (${last})` };
    }
  }
  return null;
}

function countLedgerPublishesOnDate(ledger, date = new Date()) {
  const target = localDateKey(date);
  let count = 0;
  for (const entry of Object.values(ledger.items || {})) {
    if (entry.platform === "facebook-page") continue;
    if (!entry.publishedAt) continue;
    if (localDateKey(new Date(entry.publishedAt)) === target) {
      count += 1;
    }
  }
  return count;
}

function localDateKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

async function graphDebugToken() {
  const params = new URLSearchParams({
    input_token: env.META_ACCESS_TOKEN,
    access_token: `${env.META_APP_ID}|${env.META_APP_SECRET}`
  });

  try {
    const result = await fetch(`${GRAPH_BASE}/debug_token?${params.toString()}`);
    const body = await result.json();
    return {
      id: "token_debug",
      ok: result.ok && body?.data?.is_valid !== false,
      status: result.status,
      body: redactGraphBody(body)
    };
  } catch (error) {
    return {
      id: "token_debug",
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

async function graphPost(path, params, token = env.META_ACCESS_TOKEN) {
  const body = new URLSearchParams({
    ...params,
    access_token: token
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

async function graphGet(path, params = {}, token = env.META_ACCESS_TOKEN) {
  const search = new URLSearchParams({
    ...params,
    access_token: token
  });

  try {
    const result = await fetch(`${GRAPH_BASE}${path}?${search.toString()}`);
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

async function waitForContainerReady(containerId) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const status = await graphGet(`/${containerId}`, { fields: "status_code,status" });
    if (!status.ok) {
      return {
        ready: false,
        retryable: false,
        reason: graphErrorMessage(status),
        graph: status
      };
    }

    const statusCode = String(status.body?.status_code || status.body?.status || "").toUpperCase();
    if (statusCode === "FINISHED") {
      return { ready: true, statusCode, graph: status };
    }
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      return {
        ready: false,
        retryable: false,
        statusCode,
        reason: `Meta container status is ${statusCode}.`,
        graph: status
      };
    }

    if (attempt < 8) {
      await delay(8000);
    }
  }

  return {
    ready: false,
    retryable: true,
    statusCode: "IN_PROGRESS",
    reason: "Meta is still processing the video. Try Publish due now again in a few minutes."
  };
}

function graphErrorMessage(result) {
  if (!result) return "Unknown Meta API error.";
  if (typeof result.error === "string") return result.error;
  const error = result.body?.error || result.error?.error || result.error;
  if (error?.message) return error.message;
  if (result.status) return `Meta API returned status ${result.status}.`;
  return "Unknown Meta API error.";
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
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
    check("perm_pages_read_engagement", granted.has("pages_read_engagement"), "pages_read_engagement"),
    check("perm_pages_manage_posts", granted.has("pages_manage_posts"), "pages_manage_posts")
  ];
}

function readinessSummary(checks = [], graphResults = []) {
  const graph = new Map(graphResults.map((item) => [item.id, item]));
  const tokenDebug = graph.get("token_debug")?.body?.data || {};
  const expiresAt = tokenDebug.expires_at ? new Date(Number(tokenDebug.expires_at) * 1000).toISOString() : "";
  const failedChecks = checks.filter((item) => !item.ok).map((item) => item.id);
  const failedGraph = graphResults.filter((item) => !item.ok).map((item) => item.id);

  return {
    failedChecks,
    failedGraph,
    tokenExpiresAt: expiresAt,
    tokenValid: tokenDebug.is_valid !== false && Boolean(graph.get("token_me")?.ok),
    instagram: {
      id: graph.get("instagram_user")?.body?.id || "",
      username: graph.get("instagram_user")?.body?.username || "",
      name: graph.get("instagram_user")?.body?.name || "",
      connected: Boolean(graph.get("instagram_user")?.ok)
    },
    facebookPage: {
      id: graph.get("facebook_page")?.body?.id || "",
      name: graph.get("facebook_page")?.body?.name || "",
      instagramBusinessAccount: graph.get("facebook_page")?.body?.instagram_business_account?.id || "",
      connected: Boolean(graph.get("facebook_page")?.ok)
    }
  };
}

function envPresence() {
  return {
    META_APP_ID: Boolean(env.META_APP_ID),
    META_APP_SECRET: Boolean(env.META_APP_SECRET),
    META_ACCESS_TOKEN: Boolean(env.META_ACCESS_TOKEN),
    META_PAGE_ACCESS_TOKEN: Boolean(env.META_PAGE_ACCESS_TOKEN),
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

async function listMediaFiles(root, extensions, limit = 10000) {
  const files = [];
  if (!root || !existsSync(root)) return files;

  async function walk(folder) {
    if (files.length >= limit) return;
    let entries = [];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
        files.push(path);
      }
      if (files.length >= limit) return;
    }
  }

  await walk(root);
  return files;
}

async function listUnsupportedMediaFiles(root, allowedExtensions, limit = 10000) {
  const interesting = new Set([
    ".wma", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".txt", ".pdf", ".bmp", ".gif", ".tif", ".tiff"
  ]);
  const files = [];
  if (!root || !existsSync(root)) return files;

  async function walk(folder) {
    if (files.length >= limit) return;
    let entries = [];
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const extension = extname(entry.name).toLowerCase();
        if (interesting.has(extension) && !allowedExtensions.has(extension)) {
          files.push(path);
        }
      }
      if (files.length >= limit) return;
    }
  }

  await walk(root);
  return files;
}

function buildLibraryIssues(items, unsupportedFiles = []) {
  const issues = [];
  const titles = new Map();

  for (const item of items) {
    const titleKey = normalizeKey(item.title || "");
    if (titleKey) {
      if (!titles.has(titleKey)) titles.set(titleKey, []);
      titles.get(titleKey).push(item);
    }

    if (!item.audioUrl) {
      issues.push(libraryIssue("missing-audio", "Missing audio", item, "This track has no usable audio file."));
    }
    if (!item.artworkUrl) {
      issues.push(libraryIssue("missing-artwork", "Missing artwork", item, "Add album artwork or place cover art in the album folder."));
    }
  }

  for (const duplicates of titles.values()) {
    if (duplicates.length < 2) continue;
    duplicates.forEach((item) => {
      issues.push(libraryIssue("duplicate-title", "Duplicate title", item, "Multiple tracks have the same title. Check these are not accidental duplicates."));
    });
  }

  unsupportedFiles.slice(0, 300).forEach((file) => {
    issues.push({
      type: "unsupported-file",
      severity: "warning",
      title: cleanTitle(basename(file, extname(file))),
      album: cleanTitle(basename(dirname(file))),
      path: file,
      message: `Unsupported file type ${extname(file).toLowerCase() || "unknown"}.`
    });
  });

  return issues;
}

function libraryIssue(type, label, item, message) {
  return {
    type,
    severity: type === "missing-audio" ? "error" : "warning",
    title: item.title || "Untitled",
    album: item.album || "Unknown album",
    path: item.audioUrl || item.artworkUrl || "",
    message: `${label}: ${message}`
  };
}

function buildArtworkIndex(files, root) {
  const index = {
    byName: new Map(),
    byFolder: new Map(),
    all: files
  };

  for (const file of files) {
    const nameKey = normalizeKey(basename(file, extname(file)));
    const folderKey = normalizeKey(basename(dirname(file)));
    const relativeFolderKey = normalizeKey(dirname(relative(root, file)));
    addMapValue(index.byName, nameKey, file);
    addMapValue(index.byFolder, folderKey, file);
    addMapValue(index.byFolder, relativeFolderKey, file);
  }

  return index;
}

function findArtworkForTrack({ title, album, folderParts, artworkIndex }) {
  const candidates = [
    normalizeKey(title),
    normalizeKey(album),
    ...folderParts.map(normalizeKey),
    normalizeKey(folderParts.join(" "))
  ].filter(Boolean);

  for (const key of candidates) {
    const byName = artworkIndex.byName.get(key);
    if (byName?.length) return byName[0];
    const byFolder = artworkIndex.byFolder.get(key);
    if (byFolder?.length) return byFolder[0];
  }

  const coverNames = ["cover", "folder", "front", "artwork", "album"];
  for (const key of coverNames) {
    const byName = artworkIndex.byName.get(key);
    if (byName?.length) return byName[0];
  }

  return artworkIndex.all[0] || "";
}

function addMapValue(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((item) => resolve(item)))];
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";
}

function firstCaptionLine(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function writeCatalogCsv(path, items) {
  const headers = ["Title", "Artist", "Album", "Artwork URL", "Audio file or URL", "Store URL", "Mood", "BPM", "ISRC"];
  const rows = items.map((item) => [
    item.title,
    item.artist,
    item.album,
    item.artworkUrl,
    item.audioUrl,
    item.storeUrl,
    item.mood,
    item.bpm || "",
    item.isrc
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  await writeFile(path, `${csv}\r\n`, "utf8");
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

async function writeProgress(path, progress) {
  await writeFile(path, JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...progress
  }, null, 2), "utf8").catch(() => {});
}

async function readProgress(path, fallbackMessage = "Working...") {
  if (!path || !existsSync(path)) {
    return {
      stage: "idle",
      current: 0,
      total: 0,
      percent: 0,
      message: "Waiting for progress..."
    };
  }

  try {
    const raw = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
    const progress = JSON.parse(raw);
    return {
      stage: progress.stage || "running",
      current: Number(progress.current) || 0,
      total: Number(progress.total) || 0,
      percent: Number(progress.percent) || 0,
      message: progress.message || fallbackMessage,
      updatedAt: progress.updatedAt || ""
    };
  } catch {
    return {
      stage: "running",
      current: 0,
      total: 0,
      percent: 0,
      message: fallbackMessage
    };
  }
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
  if (!existsSync(path)) return {};
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
