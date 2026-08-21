import { createHash, createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { appendFile, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const rootDir = dirname(fileURLToPath(import.meta.url));
const schedulerDir = resolve(rootDir, "..");
const workspaceRoot = resolve(schedulerDir, "..", "..");
const runDir = join(schedulerDir, "api-runs");
const publishLockPath = join(runDir, "publish-cycle.lock.json");
const envPath = join(rootDir, ".env");
const DEFAULT_PROFILE_ID = "majas-coffee-jazz-zone";
const defaultCatalogPath = join(schedulerDir, "majas-coffee-jazz-zone-full-catalog-with-files.csv");
const DEFAULT_SETUP = {
  igHandle: "@majascoffeejazzzone",
  igType: "creator",
  igProfessional: true,
  pageName: "Maja's Coffee Jazz Zone",
  pageUrl: "https://www.facebook.com/profile.php?id=61590381973296&sk=about",
  pageLinked: true,
  appStatus: "created",
  appId: "1365265765442781",
  backendRequired: true,
  publishMode: "manual",
  requireApproval: true,
  noSecretsInBrowser: true,
  permissions: {
    instagramBasic: false,
    instagramPublish: false,
    pagesShow: false,
    pagesEngagement: false
  }
};
const postingPlanPath = join(rootDir, "config", "posting-plan.json");
const youtubeVideoPlanPath = join(rootDir, "config", "youtube-video-plan.json");
const userConfigPath = join(rootDir, "config", "user-config.json");
const visualSourcesDir = join(schedulerDir, "visual-sources");
const approvedVisualVideosDir = join(visualSourcesDir, "approved-videos");
const approvedVisualSourcesPath = join(visualSourcesDir, "approved-visual-sources.csv");
const albumVisualThemesPath = join(visualSourcesDir, "album-visual-themes.csv");
const env = await loadEnv(envPath);
const setup = await loadSetup(join(rootDir, "config", "instagram-setup-config.json"));
const execFileAsync = promisify(execFile);

const PORT = Number(env.PORT || 8787);
const GRAPH_VERSION = env.META_GRAPH_VERSION || "v23.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const LIVE_MODES = new Set(["test", "live", "auto-approved"]);
const AUDIO_EXTENSIONS = new Set([".wav", ".mp3", ".flac", ".aiff", ".aif", ".m4a", ".aac", ".ogg"]);
const SONG_FACTORY_CONVERT_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ".mp4", ".m4v", ".webm", ".mov"]);
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const DEFAULT_AUDIO_ROOT = "E:\\FL Studio 20\\Data\\MaJaWick Music\\YouTube Topic streaming\\Maja's Coffee Jazz Zone\\Songs\\Completed albums";
const DEFAULT_CATCH_UP_SPACING_HOURS = 2;
const DAILY_PLATFORM_LIMITS = {
  metaReels: 1,
  youtubeShorts: 3,
  youtubeVideos: 0
};
const YOUTUBE_SAME_TRACK_SPACING_HOURS = 48;
const YOUTUBE_ARTWORK_SHORT_DAILY_LIMIT = 0;
const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly"
];
const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
  "public_profile"
];
const metaOAuthStates = new Map();
const SUPPRESSED_PUBLISHING_ITEMS = [
  {
    title: "Streamside Serenade",
    isrc: "GXJ8K2565177",
    ids: new Set(["review::1hm4xaq", "review::gxg35b"])
  }
];
const HARD_BANNED_SOURCE_ITEMS = [
  { title: "Nightcap Fugue", album: "The Mike McKenzie Trio - Midnight at the Keys" },
  { title: "Ashes in the Ashtray", album: "The Mike McKenzie Trio - Midnight at the Keys" },
  { title: "A Whisper in D Minor", album: "The Mike McKenzie Trio - Midnight at the Keys" },
  { title: "Fusion of the Two Minds", album: "Fusion of Two Minds" },
  { title: "Soft Etude in Cream", album: "The Chamber Sessions" },
  { title: "Steam & Saxophones", album: "Maja's Coffee Jazz Moments, Pt. 2" }
];
const parentPidArgIndex = process.argv.indexOf("--parent-pid");
const parentPid = parentPidArgIndex >= 0 ? Number(process.argv[parentPidArgIndex + 1] || 0) : 0;
let currentRenderJob = null;
let currentYouTubeVideoJob = null;
let currentUploadJob = null;
let currentPublishJob = null;
let currentSongFactoryAudioJob = null;

function normalizeProfileId(value = "") {
  return String(value || DEFAULT_PROFILE_ID)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || DEFAULT_PROFILE_ID;
}

function requestProfileId(payload = {}) {
  return normalizeProfileId(payload.profileId || payload.activeProfileId || DEFAULT_PROFILE_ID);
}

function isSuppressedPublishingItem(item = {}) {
  const title = String(item.title || item.Title || "").trim().toLowerCase();
  const isrc = String(item.isrc || item.ISRC || "").trim().toUpperCase();
  const id = String(item.id || item.ID || "").trim();
  return SUPPRESSED_PUBLISHING_ITEMS.some((suppressed) => (
    suppressed.ids.has(id)
    || (suppressed.isrc && isrc === suppressed.isrc)
    || (suppressed.title && title === suppressed.title.toLowerCase())
  ));
}

function filterSuppressedPublishingItems(items = []) {
  return Array.isArray(items) ? items.filter((item) => !isSuppressedPublishingItem(item)) : [];
}

function isHardBannedSourceItem(item = {}) {
  const title = normalizeKey(item.title || item.Title || "");
  const album = normalizeKey(item.album || item.Album || "");
  return HARD_BANNED_SOURCE_ITEMS.some((banned) => (
    normalizeKey(banned.title) === title && normalizeKey(banned.album) === album
  ));
}

function profilePaths(profileId = DEFAULT_PROFILE_ID) {
  const id = normalizeProfileId(profileId);
  if (id === DEFAULT_PROFILE_ID) {
    return {
      id,
      root: schedulerDir,
      configDir: join(rootDir, "config"),
      runDir,
      postingPlanPath,
      youtubeVideoPlanPath,
      catalogPath: defaultCatalogPath,
      localLibraryPath: join(rootDir, "config", "local-library.json"),
      youtubePerformancePath: join(rootDir, "config", "youtube-performance.json"),
      performanceGeneratePresetPath: join(rootDir, "config", "performance-generate-preset.json"),
      reviewCachePath: join(rootDir, "config", "review-cache.json"),
      visualSourcesDir,
      approvedVisualVideosDir,
      approvedVisualSourcesPath,
      albumVisualThemesPath
    };
  }

  const profileRoot = join(schedulerDir, "profiles", id);
  const profileVisualSourcesDir = join(profileRoot, "visual-sources");
  return {
    id,
    root: profileRoot,
    configDir: join(profileRoot, "config"),
    runDir: join(profileRoot, "api-runs"),
    postingPlanPath: join(profileRoot, "config", "posting-plan.json"),
    youtubeVideoPlanPath: join(profileRoot, "config", "youtube-video-plan.json"),
    catalogPath: join(profileRoot, "catalog", "catalog-with-files.csv"),
    localLibraryPath: join(profileRoot, "config", "local-library.json"),
    youtubePerformancePath: join(profileRoot, "config", "youtube-performance.json"),
    performanceGeneratePresetPath: join(profileRoot, "config", "performance-generate-preset.json"),
    reviewCachePath: join(profileRoot, "config", "review-cache.json"),
    visualSourcesDir: profileVisualSourcesDir,
    approvedVisualVideosDir: join(profileVisualSourcesDir, "approved-videos"),
    approvedVisualSourcesPath: join(profileVisualSourcesDir, "approved-visual-sources.csv"),
    albumVisualThemesPath: join(profileVisualSourcesDir, "album-visual-themes.csv")
  };
}

function normalizeLocalFolderInput(value = "") {
  let text = String(value || "").trim();
  text = text.replace(/^["']+|["']+$/g, "").trim();
  if (!text) return "";
  if (/^file:\/\//i.test(text)) {
    try {
      return fileURLToPath(text);
    } catch {
      return text;
    }
  }
  return text;
}

function isRemoteFolderUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

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
  const result = await publishAllDueFromSavedPlans();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv.includes("--merge-folder-catalog")) {
  const result = await mergeFolderAlbumsIntoCatalog({});
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    applyCors(response, request);

    if (request.method === "OPTIONS") {
      return options(response);
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        ok: true,
        service: "jazz-scheduler-backend",
        publishingEnabled: publishingGate(env).ok
      });
    }

    if (request.method === "POST" && url.pathname === "/api/shutdown") {
      json(response, 200, { ok: true, message: "Jazz Scheduler backend is closing." });
      setTimeout(() => gracefulShutdown("app-request"), 100);
      return;
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

    if (request.method === "POST" && url.pathname === "/api/open-url") {
      const payload = await readJsonBody(request);
      return json(response, 200, await openUrlInChrome(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/review-feedback") {
      const payload = await readJsonBody(request);
      return json(response, 200, await saveReviewFeedback(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/review/cache") {
      return json(response, 200, await getReviewCache({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "POST" && url.pathname === "/api/review/cache") {
      const payload = await readJsonBody(request);
      return json(response, 200, await updateReviewCache(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/readiness") {
      return json(response, 200, await readiness());
    }

    if (request.method === "POST" && url.pathname === "/api/meta/env") {
      const payload = await readJsonBody(request);
      return json(response, 200, await saveMetaEnv(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/meta/oauth/start") {
      return json(response, 200, await metaOAuthStart(request, url));
    }

    if (request.method === "GET" && url.pathname === "/api/meta/oauth/callback") {
      return metaOAuthCallback(url, response);
    }

    if (request.method === "GET" && url.pathname === "/api/youtube/readiness") {
      return json(response, 200, await youtubeReadiness());
    }

    if (request.method === "GET" && url.pathname === "/api/performance/youtube") {
      return json(response, 200, await getYouTubePerformance({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "POST" && url.pathname === "/api/performance/youtube/sync") {
      const payload = await readJsonBody(request);
      return json(response, 200, await syncYouTubePerformance(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/performance/generate-preset") {
      const payload = await readJsonBody(request);
      return json(response, 200, await buildPerformanceGeneratePreset(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/visual-sources/pexels/readiness") {
      return json(response, 200, await pexelsReadiness({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "POST" && url.pathname === "/api/visual-sources/pexels/search") {
      const payload = await readJsonBody(request);
      return json(response, 200, await searchPexelsVideos(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/visual-sources/videos/search") {
      const payload = await readJsonBody(request);
      return json(response, 200, await searchStockVisualVideos(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/visual-sources/pexels/download") {
      const payload = await readJsonBody(request);
      return json(response, 200, await downloadPexelsVideo(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/visual-sources/videos/download") {
      const payload = await readJsonBody(request);
      return json(response, 200, await downloadStockVisualVideo(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/visual-sources/pexels/clear-approved") {
      const payload = await readJsonBody(request);
      return json(response, 200, await clearApprovedPexelsSources(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/youtube/oauth/start") {
      return json(response, 200, await youtubeOAuthStart(request));
    }

    if (request.method === "GET" && url.pathname === "/api/youtube/oauth/callback") {
      return youtubeOAuthCallback(url, response);
    }

    if (request.method === "POST" && url.pathname === "/api/setup/pick-folder") {
      const payload = await readJsonBody(request);
      return json(response, 200, await pickFolder(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/library/scan") {
      const payload = await readJsonBody(request);
      return json(response, 200, await scanLibrary(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/library/merge-folder-catalog") {
      const payload = await readJsonBody(request);
      return json(response, 200, await mergeFolderAlbumsIntoCatalog(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/catalog/albums") {
      return json(response, 200, await listCatalogAlbums({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "POST" && url.pathname === "/api/song-factory/save-completed-album") {
      const payload = await readJsonBody(request);
      return json(response, 200, await saveSongFactoryCompletedAlbum(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/song-factory/convert-artwork") {
      const payload = await readJsonBody(request);
      return json(response, 200, await convertSongFactoryArtworkUtility(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/song-factory/rename-audio-files") {
      const payload = await readJsonBody(request);
      return json(response, 200, await renameSongFactoryAudioFiles(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/song-factory/prepare-audio") {
      const payload = await readJsonBody(request);
      return json(response, 200, await prepareSongFactoryAudio(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/song-factory/prepare-audio/start") {
      const payload = await readJsonBody(request);
      return json(response, 200, await startSongFactoryAudioJob(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/song-factory/prepare-audio/status") {
      return json(response, 200, await songFactoryAudioJobStatus());
    }

    if (request.method === "POST" && url.pathname === "/api/song-factory/open-downloader") {
      const payload = await readJsonBody(request);
      return json(response, 200, await openSongFactoryDownloader(payload));
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
      return json(response, 200, await latestReviewBatch({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "GET" && url.pathname === "/api/posting-plan") {
      return json(response, 200, await getPostingPlan({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "GET" && url.pathname === "/api/publishing-history") {
      return json(response, 200, await getPublishingHistory());
    }

    if (request.method === "POST" && url.pathname === "/api/publishing-history/clear") {
      return json(response, 200, await clearPublishingHistory());
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

    if (request.method === "POST" && url.pathname === "/api/schedule/clear-pipeline") {
      return json(response, 200, await clearSchedulePipeline());
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

    if (request.method === "POST" && url.pathname === "/api/r2/cleanup-unused") {
      const payload = await readJsonBody(request);
      return json(response, 200, await cleanupUnusedR2Uploads(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/storage/cleanup-preview") {
      return json(response, 200, await localStorageCleanupPlan({ apply: false }));
    }

    if (request.method === "POST" && url.pathname === "/api/storage/cleanup") {
      const payload = await readJsonBody(request);
      return json(response, 200, await localStorageCleanupPlan({ apply: Boolean(payload.apply) }));
    }

    if (request.method === "POST" && url.pathname === "/api/instagram/create-containers") {
      const payload = await readJsonBody(request);
      return json(response, 200, await createInstagramContainers(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/instagram/publish-due") {
      const payload = await readJsonBody(request);
      const youtubePlan = await loadYouTubeVideoPlan();
      return json(response, 200, await publishAllDue({
        ...payload,
        youtubeVideoItems: Array.isArray(payload.youtubeVideoItems) ? payload.youtubeVideoItems : youtubePlan.items
      }));
    }

    if (request.method === "POST" && url.pathname === "/api/publish/all-due") {
      const payload = await readJsonBody(request);
      return json(response, 200, await publishAllDue(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/publish/resend") {
      const payload = await readJsonBody(request);
      return json(response, 200, await resendDueToDestination(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/youtube/video-plan") {
      return json(response, 200, await getYouTubeVideoPlan({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "POST" && url.pathname === "/api/youtube/video-plan") {
      const payload = await readJsonBody(request);
      return json(response, 200, await saveYouTubeVideoPlan(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/open-path") {
      const payload = await readJsonBody(request);
      return json(response, 200, await openPath(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/youtube/upload-test") {
      const payload = await readJsonBody(request);
      return json(response, 200, await uploadYouTubeShortTest(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/youtube/upload-video") {
      const payload = await readJsonBody(request);
      return json(response, 200, await uploadYouTubeVideo(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/youtube/videos/render/start") {
      const payload = await readJsonBody(request);
      return json(response, 200, await startYouTubeVideoRenderJob(payload));
    }

    if (request.method === "GET" && url.pathname === "/api/youtube/videos/render/status") {
      return json(response, 200, await youtubeVideoRenderJobStatus());
    }

    if (request.method === "POST" && url.pathname === "/api/youtube/videos/render/cancel") {
      return json(response, 200, await cancelYouTubeVideoRenderJob());
    }

    if (request.method === "GET" && url.pathname === "/api/youtube/videos/latest") {
      return json(response, 200, await latestYouTubeVideoBatch());
    }

    if (request.method === "GET" && url.pathname === "/api/album-videos/albums") {
      return json(response, 200, await listAlbumVideoAlbums({ profileId: url.searchParams.get("profileId") || "" }));
    }

    if (request.method === "POST" && url.pathname === "/api/album-videos/render/start") {
      const payload = await readJsonBody(request);
      return json(response, 200, await startAlbumVideoRenderJob(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/album-videos/render/test") {
      const payload = await readJsonBody(request);
      return json(response, 200, await startAlbumVideoTestRenderJob(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/album-videos/upload") {
      const payload = await readJsonBody(request);
      return json(response, 200, await uploadAlbumVideoItems(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/album-videos/compile") {
      const payload = await readJsonBody(request);
      return json(response, 200, await compileAlbumVideoItems(payload));
    }

    if (request.method === "POST" && url.pathname === "/api/album-videos/cleanup-partials") {
      const payload = await readJsonBody(request);
      return json(response, 200, await cleanupPartialAlbumVideoRenders(payload));
    }

    return json(response, 404, { error: "Not found" });
  } catch (error) {
    return json(response, 500, {
      error: "Backend error",
      message: error.message
    });
  }
});

export async function readiness() {
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
  const permissionsResult = graph.results.find((item) => item.id === "permissions");
  if (permissionsResult && !permissionsResult.ok && permissionChecks.every((item) => item.ok)) {
    permissionsResult.ok = true;
    permissionsResult.detail = "Verified through token debug scopes.";
    permissionsResult.body = {
      ...(permissionsResult.body || {}),
      verifiedFromTokenDebug: true
    };
  }
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

async function saveMetaEnv(payload = {}) {
  const updates = {};
  const add = (key, value) => {
    const text = String(value || "").trim();
    if (text) updates[key] = text;
  };

  add("META_APP_ID", payload.metaAppId);
  add("META_APP_SECRET", payload.metaAppSecret);
  add("META_ACCESS_TOKEN", payload.userAccessToken);
  add("META_PAGE_ACCESS_TOKEN", payload.pageAccessToken);
  add("FACEBOOK_PAGE_ID", payload.facebookPageId);
  add("IG_USER_ID", payload.igUserId);

  const extracted = extractMetaAccountsJson(payload.accountsJson);
  Object.entries(extracted).forEach(([key, value]) => add(key, value));

  const allowedKeys = new Set([
    "META_APP_ID",
    "META_APP_SECRET",
    "META_ACCESS_TOKEN",
    "META_PAGE_ACCESS_TOKEN",
    "FACEBOOK_PAGE_ID",
    "IG_USER_ID"
  ]);
  const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([key]) => allowedKeys.has(key)));
  const updatedKeys = Object.keys(safeUpdates);
  if (!updatedKeys.length) {
    return {
      ok: false,
      message: "Paste at least one Meta value or a /me/accounts JSON response."
    };
  }

  await updateEnvFile(envPath, safeUpdates);
  Object.assign(env, safeUpdates);

  return {
    ok: true,
    message: `Saved ${updatedKeys.length} Meta setting${updatedKeys.length === 1 ? "" : "s"} to backend .env.`,
    updatedKeys,
    envStatus: envPresence()
  };
}

function extractMetaAccountsJson(raw = "") {
  const text = String(raw || "").trim();
  if (!text) return {};
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  const pages = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
  const page = pages.find((item) => item?.access_token || item?.instagram_business_account?.id || item?.id) || {};
  const updates = {};
  if (page.access_token) updates.META_PAGE_ACCESS_TOKEN = page.access_token;
  if (page.id) updates.FACEBOOK_PAGE_ID = page.id;
  if (page.instagram_business_account?.id) updates.IG_USER_ID = page.instagram_business_account.id;
  if (parsed.access_token) updates.META_ACCESS_TOKEN = parsed.access_token;
  return updates;
}

async function metaOAuthStart(request, url) {
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return {
      ok: false,
      message: "Add META_APP_ID and META_APP_SECRET first, then start Meta connection."
    };
  }
  const redirectUri = metaRedirectUri(request);
  const state = randomBytes(16).toString("hex");
  const returnUrl = String(url.searchParams.get("returnUrl") || "").trim();
  metaOAuthStates.set(state, {
    createdAt: Date.now(),
    returnUrl: isLocalReturnUrl(returnUrl) ? returnUrl : ""
  });
  for (const [key, value] of metaOAuthStates) {
    if (Date.now() - Number(value?.createdAt || 0) > 15 * 60 * 1000) {
      metaOAuthStates.delete(key);
    }
  }
  const params = new URLSearchParams({
    client_id: env.META_APP_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: META_OAUTH_SCOPES.join(","),
    auth_type: "rerequest",
    state
  });
  return {
    ok: true,
    message: "Open the Meta login URL, approve permissions, then ReleasePilot will save the tokens locally.",
    authUrl: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params}`,
    redirectUri,
    scope: META_OAUTH_SCOPES.join(",")
  };
}

async function metaOAuthCallback(url, response) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error") || url.searchParams.get("error_reason");
  const savedState = metaOAuthStates.get(state || "");
  if (state) metaOAuthStates.delete(state);
  if (error) {
    return html(response, 400, metaCallbackPage("Meta connection failed", `Meta returned: ${error}`, savedState?.returnUrl));
  }
  if (!code || !savedState) {
    return html(response, 400, metaCallbackPage("Meta connection failed", "No valid OAuth code/state was returned. Start the Meta connection again from ReleasePilot.", savedState?.returnUrl));
  }
  try {
    const redirectUri = `http://localhost:${PORT}/api/meta/oauth/callback`;
    const shortToken = await fetchGraphJson("/oauth/access_token", {
      client_id: env.META_APP_ID || "",
      client_secret: env.META_APP_SECRET || "",
      redirect_uri: redirectUri,
      code
    });
    if (!shortToken.access_token) {
      throw new Error("Meta did not return a user access token.");
    }

    const longToken = await fetchGraphJson("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: env.META_APP_ID || "",
      client_secret: env.META_APP_SECRET || "",
      fb_exchange_token: shortToken.access_token
    });
    const userAccessToken = longToken.access_token || shortToken.access_token;
    const accounts = await fetchGraphJson("/me/accounts", {
      fields: "id,name,access_token,instagram_business_account",
      access_token: userAccessToken
    });
    const page = selectMetaPage(accounts?.data || []);
    if (!page?.id || !page?.access_token) {
      throw new Error("Meta connected, but no accessible Facebook Page token was returned. Check Page access and selected permissions.");
    }
    const updates = {
      META_ACCESS_TOKEN: userAccessToken,
      META_PAGE_ACCESS_TOKEN: page.access_token,
      FACEBOOK_PAGE_ID: page.id
    };
    if (page.instagram_business_account?.id) {
      updates.IG_USER_ID = page.instagram_business_account.id;
    }
    await updateEnvFile(envPath, updates);
    Object.assign(env, updates);
    return html(response, 200, metaCallbackPage(
      "Meta connected",
      `Saved tokens for ${page.name || "your Facebook Page"}. Return to ReleasePilot and run Check Meta health.`,
      savedState.returnUrl
    ));
  } catch (error) {
    return html(response, 500, metaCallbackPage("Meta connection failed", error.message, savedState.returnUrl));
  }
}

async function fetchGraphJson(path, params = {}) {
  const search = new URLSearchParams(params);
  const response = await fetch(`${GRAPH_BASE}${path}?${search.toString()}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `Meta request failed with HTTP ${response.status}.`);
  }
  return body;
}

function selectMetaPage(pages = []) {
  const configured = String(env.FACEBOOK_PAGE_ID || "").trim();
  if (configured) {
    const match = pages.find((page) => String(page?.id || "") === configured);
    if (match) return match;
  }
  return pages.find((page) => page?.instagram_business_account?.id && page?.access_token)
    || pages.find((page) => page?.access_token)
    || null;
}

function metaRedirectUri(request) {
  const host = request.headers.host || `127.0.0.1:${PORT}`;
  const safeHost = /^localhost/i.test(host) ? host : `localhost:${PORT}`;
  return `http://${safeHost}/api/meta/oauth/callback`;
}

function isLocalReturnUrl(value = "") {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "file:" || /^localhost$|^127\.0\.0\.1$|\[::1\]/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function metaCallbackPage(title, message, returnUrl = "") {
  const safeReturnUrl = isLocalReturnUrl(returnUrl) ? returnUrl : "";
  const returnLink = safeReturnUrl
    ? `<p><a href="${escapeHtml(safeReturnUrl)}">Return to ReleasePilot</a></p>`
    : "<p>You can close this tab and return to ReleasePilot.</p>";
  return `<!doctype html>
  <html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;background:#f5f3ff;color:#151022;padding:40px}main{max-width:720px;margin:auto;background:#fff;border:1px solid #e5e0ef;border-radius:10px;padding:30px;box-shadow:0 18px 42px rgba(34,13,78,.12)}h1{margin-top:0;color:#6f1fe8}p{line-height:1.55}a{display:inline-block;background:#8b35f6;color:white;text-decoration:none;font-weight:800;padding:11px 15px;border-radius:8px}</style>
  </head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${returnLink}</main></body></html>`;
}

async function youtubeReadiness() {
  const required = [
    ["clientId", "YOUTUBE_CLIENT_ID", "Google OAuth client ID"],
    ["clientSecret", "YOUTUBE_CLIENT_SECRET", "Google OAuth client secret"],
    ["refreshToken", "YOUTUBE_REFRESH_TOKEN", "Long-lived refresh token for the channel"],
    ["channelId", "YOUTUBE_CHANNEL_ID", "YouTube channel ID"]
  ];
  const credentials = Object.fromEntries(required.map(([key, envKey]) => [key, Boolean(env[envKey])]));
  const checks = required.map(([key, envKey, help]) => ({
    id: key,
    label: envKey,
    ok: Boolean(env[envKey]),
    help
  }));
  const presentCount = checks.filter((item) => item.ok).length;
  const requiredCount = checks.length;
  return {
    ok: presentCount === requiredCount,
    ready: presentCount === requiredCount,
    message: presentCount === requiredCount
      ? "YouTube credentials are present. Upload testing can be added next."
      : "YouTube setup is planned. Add Google OAuth values to .env before upload testing.",
    credentials,
    checks,
    presentCount,
    requiredCount,
    channelConfigured: Boolean(env.YOUTUBE_CHANNEL_ID),
    uploadTestAvailable: presentCount >= 3,
    nextPhase: presentCount >= 3 ? "Run a private upload test from the YouTube setup page." : "Connect Google OAuth to create a refresh token."
  };
}

async function youtubeOAuthStart(request) {
  if (!env.YOUTUBE_CLIENT_ID || !env.YOUTUBE_CLIENT_SECRET) {
    return {
      ok: false,
      message: "Add YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET to backend .env first."
    };
  }
  const redirectUri = youtubeRedirectUri(request);
  const params = new URLSearchParams({
    client_id: env.YOUTUBE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: YOUTUBE_OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true"
  });
  return {
    ok: true,
    message: "Open the Google sign-in URL and allow YouTube upload access.",
    authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
    redirectUri,
    scope: YOUTUBE_OAUTH_SCOPES.join(" ")
  };
}

async function youtubeOAuthCallback(url, response) {
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (error) {
    return html(response, 400, youtubeCallbackPage("YouTube connection failed", `Google returned: ${escapeHtml(error)}`));
  }
  if (!code) {
    return html(response, 400, youtubeCallbackPage("YouTube connection failed", "No OAuth code was returned."));
  }
  try {
    const redirectUri = `http://127.0.0.1:${PORT}/api/youtube/oauth/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.YOUTUBE_CLIENT_ID || "",
        client_secret: env.YOUTUBE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok || token.error) {
      throw new Error(token.error_description || token.error || "Google token exchange failed.");
    }
    if (!token.refresh_token) {
      throw new Error("Google did not return a refresh token. Try Start Google OAuth again and approve consent.");
    }
    env.YOUTUBE_REFRESH_TOKEN = token.refresh_token;
    await updateEnvFile(envPath, { YOUTUBE_REFRESH_TOKEN: token.refresh_token });
    return html(response, 200, youtubeCallbackPage("YouTube connected", "Refresh token saved locally. You can close this tab and return to the scheduler."));
  } catch (error) {
    return html(response, 500, youtubeCallbackPage("YouTube connection failed", error.message));
  }
}

function youtubeRedirectUri(request) {
  const host = request.headers.host || `127.0.0.1:${PORT}`;
  const safeHost = /^localhost|^127\.0\.0\.1|\[::1\]/i.test(host) ? host : `127.0.0.1:${PORT}`;
  return `http://${safeHost}/api/youtube/oauth/callback`;
}

function youtubeCallbackPage(title, message) {
  return `<!doctype html>
  <html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
  <style>body{font-family:Segoe UI,Arial,sans-serif;background:#f3f4f6;color:#1f2937;padding:40px}main{max-width:680px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:28px}h1{margin-top:0;color:#5b21b6}p{line-height:1.5}</style>
  </head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`;
}

async function openUrlInChrome(payload = {}) {
  const targetUrl = String(payload.url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    return { ok: false, message: "Only http/https links can be opened in Chrome." };
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { ok: false, message: "That link is not a valid URL." };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, message: "Only web links can be opened in Chrome." };
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    return {
      ok: false,
      message: "Chrome was not found in the usual install locations. Copy the link and paste it into Chrome.",
      url: targetUrl
    };
  }

  try {
    const child = execFile(chromePath, ["--new-window", targetUrl], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    child.unref();
    return { ok: true, message: "Opened in Chrome.", url: targetUrl, chromePath };
  } catch (error) {
    return {
      ok: false,
      message: `Could not open Chrome: ${error.message || "unknown error"}`,
      url: targetUrl
    };
  }
}

function findChromePath() {
  const candidates = [
    env.CHROME_PATH,
    process.env.CHROME_PATH,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : "",
    process.env["PROGRAMFILES(X86)"] ? join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe") : ""
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function html(response, status, body) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

async function uploadYouTubeShortTest(payload = {}) {
  return uploadYouTubeVideoPayload(payload, { shorts: true });
}

async function uploadYouTubeVideo(payload = {}) {
  return uploadYouTubeVideoPayload(payload, { shorts: false });
}

async function uploadYouTubeVideoPayload(payload = {}, options = {}) {
  if (!payload.confirmUpload) {
    return { ok: false, message: "Upload test was not confirmed." };
  }
  const videoPath = resolve(String(payload.videoPath || ""));
  if (!videoPath || !existsSync(videoPath)) {
    return { ok: false, message: "Choose or generate a local MP4 before testing YouTube upload." };
  }
  if (extname(videoPath).toLowerCase() !== ".mp4") {
    return { ok: false, message: "YouTube test upload currently expects an MP4 file." };
  }
  if (!options.shorts) {
    const fullTrackCheck = validateYouTubeFullTrackUpload({
      ...payload,
      video: videoPath
    });
    if (!fullTrackCheck.ok) {
      return fullTrackCheck;
    }
  }
  const missing = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"].filter((key) => !env[key]);
  if (missing.length) {
    return { ok: false, message: `Missing YouTube credential${missing.length === 1 ? "" : "s"} in .env: ${missing.join(", ")}` };
  }

  const fileInfo = await stat(videoPath);
  let accessToken = "";
  try {
    accessToken = await youtubeAccessToken();
  } catch (error) {
    return {
      ok: false,
      message: `YouTube login token has expired or been revoked. Open Setup > YouTube, reconnect Google OAuth, then try again. ${error.message || ""}`.trim(),
      tokenType: "youtube",
      reason: error.message || "YouTube token refresh failed."
    };
  }
  const privacy = ["private", "unlisted", "public"].includes(payload.privacy) ? payload.privacy : "private";
  const title = String(payload.title || (options.shorts ? "YouTube Shorts upload test" : "YouTube full-track upload test")).slice(0, 100);
  const baseDescription = appendYouTubeProfileLinks(String(payload.description || (options.shorts ? "A short instrumental jazz moment for a quieter part of the day. #Shorts" : "A full-length instrumental jazz track for background listening, focus, or a slower evening.")));
  const descriptionWithShorts = options.shorts && !baseDescription.includes("#Shorts") ? `${baseDescription}\n\n#Shorts` : baseDescription;
  const description = descriptionWithShorts.slice(0, 4500);
  const metadata = {
    snippet: {
      title,
      description,
      categoryId: "10",
      tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : (options.shorts ? ["jazz", "coffee jazz", "shorts"] : ["jazz", "coffee jazz", "instrumental music"])
    },
    status: {
      privacyStatus: privacy,
      selfDeclaredMadeForKids: Boolean(payload.madeForKids)
    }
  };

  const createSession = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-type": "video/mp4",
      "x-upload-content-length": String(fileInfo.size)
    },
    body: JSON.stringify(metadata)
  });
  if (!createSession.ok) {
    const body = await createSession.text();
    const detail = googleApiErrorMessage(body);
    return {
      ok: false,
      message: detail
        ? `YouTube upload session could not be created: ${detail}`
        : "YouTube upload session could not be created.",
      status: createSession.status,
      body: body.slice(0, 1200)
    };
  }
  const uploadUrl = createSession.headers.get("location");
  if (!uploadUrl) {
    return { ok: false, message: "YouTube did not return an upload URL." };
  }

  const bytes = await readFile(videoPath);
  const upload = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": "video/mp4",
      "content-length": String(fileInfo.size)
    },
    body: bytes
  });
  const resultText = await upload.text();
  let result = {};
  try {
    result = resultText ? JSON.parse(resultText) : {};
  } catch {
    result = { raw: resultText.slice(0, 1200) };
  }
  if (!upload.ok) {
    return { ok: false, message: "YouTube upload failed.", status: upload.status, result };
  }
  return {
    ok: true,
    message: options.shorts
      ? `Uploaded test Short to YouTube as ${privacy}.`
      : `Uploaded full-track YouTube video as ${privacy}.`,
    videoId: result.id || "",
    url: result.id ? `https://www.youtube.com/watch?v=${result.id}` : "",
    privacy,
    result
  };
}

function validateYouTubeFullTrackUpload(item = {}) {
  const video = resolve(String(item.video || item.videoPath || ""));
  const relativeVideo = relative(schedulerDir, video).replace(/\\/g, "/").toLowerCase();
  const template = String(item.template || item.Template || "").toLowerCase();
  const isAlbumCompilation = template === "youtube-full-album";
  const durationSeconds = Number(item.durationSeconds || item.DurationSeconds || 0);
  const audio = String(item.audio || item.Audio || "").trim();

  if (!relativeVideo.startsWith("rendered-youtube-videos/")) {
    return {
      ok: false,
      message: "Blocked YouTube full-video upload: this file is not a rendered 16:9 full-track video. Render/approve it in YouTube Videos first."
    };
  }
  if (template && !["youtube-full-track", "youtube-full-album"].includes(template)) {
    return {
      ok: false,
      message: "Blocked YouTube full-video upload: the selected item is not using a recognised YouTube long-form template."
    };
  }
  if (isAlbumCompilation ? !/-youtube-album\.mp4$/i.test(video) : !/-youtube\.mp4$/i.test(video)) {
    return {
      ok: false,
      message: "Blocked YouTube full-video upload: the MP4 does not look like a full-track YouTube render."
    };
  }
  if (durationSeconds > 0 && durationSeconds < 90) {
    return {
      ok: false,
      message: "Blocked YouTube full-video upload: duration is too short for long-form. Use the full-length audio render."
    };
  }
  if (!isAlbumCompilation && !audio) {
    return {
      ok: false,
      message: "Blocked YouTube full-video upload: no source audio is attached, so it cannot be confirmed as full length."
    };
  }

  return { ok: true };
}

async function probeAudioFile(audioPath = "") {
  const filePath = resolveSafe(audioPath);
  if (!filePath || !existsSync(filePath)) {
    return { ok: false, message: "source audio file was not found" };
  }

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "format=duration,bit_rate",
      "-of", "json",
      filePath
    ], { timeout: 15000, maxBuffer: 1024 * 1024 });
    const parsed = JSON.parse(stdout || "{}");
    const durationSeconds = Number(parsed?.format?.duration || 0);
    const bitRate = Number(parsed?.format?.bit_rate || 0);
    return { ok: true, durationSeconds, bitRate };
  } catch (error) {
    return { ok: false, message: `could not inspect source audio: ${error.message || error}` };
  }
}

function artworkLooksStaleForAudio(artworkPath = "", audioPath = "") {
  const artwork = resolveSafe(artworkPath);
  const audio = resolveSafe(audioPath);
  if (!artwork || /^https?:\/\//i.test(String(artworkPath || "")) || !existsSync(artwork) || !audio || !existsSync(audio)) {
    return false;
  }

  const audioFolder = dirname(audio);
  const albumFolder = dirname(audioFolder);
  return !isInsidePath(audioFolder, artwork) && !isInsidePath(albumFolder, artwork);
}

async function validateQueuedSourceMedia(item = {}, paths = profilePaths(DEFAULT_PROFILE_ID), options = {}) {
  const catalogRows = await loadProfileCatalogRows(paths);
  const libraryConfig = await loadProfileLibraryConfig(paths);
  const match = findProfileCatalogMatch(item, catalogRows);
  const label = item.title || item.Title || item.id || "selected item";
  if (isHardBannedSourceItem(item) || isHardBannedSourceItem(match || {})) {
    return {
      ok: false,
      status: "source-banned",
      message: `Blocked upload: ${label} is hard-banned because the source audio is damaged or incorrect.`
    };
  }
  if (!match) {
    return {
      ok: false,
      status: "source-error",
      message: `Blocked upload: ${label} is not in the active profile catalogue. Regenerate or remove this queued item.`
    };
  }

  const audio = item.audio || item.Audio || match["Audio file or URL"] || match.Audio || "";
  if (!profileMediaFileAllowed(audio, paths, libraryConfig, AUDIO_EXTENSIONS)) {
    return {
      ok: false,
      status: "source-error",
      message: `Blocked upload: source audio for ${label} is missing or outside this profile's library.`
    };
  }

  const probe = await probeAudioFile(audio);
  if (!probe.ok) {
    return { ok: false, status: "source-error", message: `Blocked upload: ${label} ${probe.message}.` };
  }
  if (probe.durationSeconds > 1800 || (probe.bitRate > 0 && probe.bitRate < 64000)) {
    return {
      ok: false,
      status: "source-error",
      message: `Blocked upload: source audio for ${label} looks invalid for a single track (${Math.round(probe.durationSeconds)}s, ${Math.round(probe.bitRate / 1000)} kbps).`
    };
  }

  const artwork = item.artwork || item.Artwork || "";
  if (!options.allowRenderedShortArtworkReference && artworkLooksStaleForAudio(artwork, audio)) {
    return {
      ok: false,
      status: "source-error",
      message: `Blocked upload: artwork mismatch for ${label}. The queued artwork is outside this track/album folder, so this Reel may have old or wrong artwork. Remove and regenerate this scheduled item.`
    };
  }

  return { ok: true, audio, match, probe };
}

function canAutoRenderYouTubeFullTrack(item = {}) {
  const audio = String(item.audio || item.Audio || "").trim();
  const artwork = String(item.artwork || item.Artwork || item.preview || item.Preview || "").trim();
  const title = String(item.title || item.Title || "").trim();
  return Boolean(audio && artwork && title && existsSync(resolve(audio)));
}

async function loadProfileCatalogRows(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  if (!existsSync(paths.catalogPath)) return [];
  const parsed = parseCsvRecords((await readFile(paths.catalogPath, "utf8")).replace(/^\uFEFF/, ""));
  return parsed.rows || [];
}

async function listCatalogAlbums(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const rows = await loadProfileCatalogRows(paths);
  const themeRows = await readAlbumVisualThemeRows(paths);
  const themesByAlbum = new Map(themeRows.map((row) => [normalizeKey(row.Album || row.album || ""), row]));
  const albums = new Map();

  rows.forEach((row) => {
    const album = String(row.Album || row.album || "").trim();
    if (!album) return;
    const key = normalizeKey(album);
    const theme = themesByAlbum.get(key) || {};
    const entry = albums.get(key) || {
      album,
      count: 0,
      titles: [],
      moods: new Set(),
      themes: new Set(),
      styles: new Set(),
      scenes: new Set(),
      instruments: new Set(),
      searchTerms: new Set()
    };
    entry.count += 1;
    [
      row.Title,
      row.title
    ].filter(Boolean).forEach((value) => addCatalogAlbumValue(entry.titles, value, 80));
    [
      row.Mood,
      row.mood,
      theme.Mood
    ].filter(Boolean).forEach((value) => splitCatalogAlbumValues(value).forEach((item) => addCatalogAlbumValue(entry.moods, item)));
    [
      theme.Theme
    ].filter(Boolean).forEach((value) => splitCatalogAlbumValues(value).forEach((item) => addCatalogAlbumValue(entry.themes, item)));
    [
      theme.Style
    ].filter(Boolean).forEach((value) => splitCatalogAlbumValues(value).forEach((item) => addCatalogAlbumValue(entry.styles, item)));
    [
      theme.Scene
    ].filter(Boolean).forEach((value) => splitCatalogAlbumValues(value).forEach((item) => addCatalogAlbumValue(entry.scenes, item)));
    [
      row.Instruments,
      row.instruments,
      row.Instrument,
      row.instrument,
      theme.Instruments
    ].filter(Boolean).forEach((value) => splitCatalogAlbumValues(value).forEach((item) => addCatalogAlbumValue(entry.instruments, item)));
    [
      theme.SearchTerms
    ].filter(Boolean).forEach((value) => splitCatalogAlbumValues(value).forEach((item) => addCatalogAlbumValue(entry.searchTerms, item)));
    albums.set(key, entry);
  });

  return {
    ok: true,
    profileId: paths.id,
    catalogPath: paths.catalogPath,
    albums: [...albums.values()]
      .map((entry) => ({
        ...entry,
        moods: [...entry.moods],
        themes: [...entry.themes],
        styles: [...entry.styles],
        scenes: [...entry.scenes],
        instruments: [...entry.instruments],
        searchTerms: [...entry.searchTerms]
      }))
      .sort((a, b) => a.album.localeCompare(b.album))
  };
}

function addCatalogAlbumValue(target, value, limit = 24) {
  const text = String(value || "").trim();
  if (!text) return;
  if (Array.isArray(target)) {
    if (target.length < limit && !target.some((item) => normalizeKey(item) === normalizeKey(text))) target.push(text);
    return;
  }
  if (target.size < limit) target.add(text);
}

function splitCatalogAlbumValues(value = "") {
  return String(value || "")
    .split(/[,;|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadProfileLibraryConfig(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  if (!existsSync(paths.localLibraryPath)) return {};
  try {
    return JSON.parse((await readFile(paths.localLibraryPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return {};
  }
}

function pathWithinFolder(filePath = "", folder = "") {
  if (!filePath || !folder) return false;
  const resolvedFile = resolve(filePath).toLowerCase();
  const resolvedFolder = resolve(folder).toLowerCase();
  return resolvedFile === resolvedFolder || resolvedFile.startsWith(`${resolvedFolder}\\`) || resolvedFile.startsWith(`${resolvedFolder}/`);
}

function profileFileAllowed(filePath = "", paths = profilePaths(DEFAULT_PROFILE_ID), libraryConfig = {}) {
  if (!filePath) return false;
  const resolved = resolveSafe(filePath);
  if (!resolved || !existsSync(resolved)) return false;
  const roots = [
    libraryConfig.audioRoot,
    libraryConfig.artworkRoot
  ].filter(Boolean);
  return roots.some((root) => pathWithinFolder(resolved, root));
}

function profileMediaFileAllowed(filePath = "", paths = profilePaths(DEFAULT_PROFILE_ID), libraryConfig = {}, extensions = new Set()) {
  if (!profileFileAllowed(filePath, paths, libraryConfig)) return false;
  if (!extensions.size) return true;
  return extensions.has(extname(resolveSafe(filePath)).toLowerCase());
}

async function findLocalArtworkNearAudio(audioPath = "", paths = profilePaths(DEFAULT_PROFILE_ID), libraryConfig = {}) {
  const audio = resolveSafe(audioPath);
  if (!profileMediaFileAllowed(audio, paths, libraryConfig, AUDIO_EXTENSIONS)) return "";
  let folder = dirname(audio);
  const preferredNames = new Set(["cover", "folder", "front", "artwork", "album"]);

  for (let depth = 0; depth < 4 && folder; depth += 1) {
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    const images = entries
      .filter((entry) => entry.isFile() && IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => join(folder, entry.name))
      .filter((file) => profileMediaFileAllowed(file, paths, libraryConfig, IMAGE_EXTENSIONS));

    if (images.length) {
      const preferred = images.find((file) => preferredNames.has(normalizeKey(basename(file, extname(file)))));
      return preferred || images[0];
    }

    const parent = dirname(folder);
    if (!parent || parent === folder) break;
    folder = parent;
  }

  return "";
}

function findProfileCatalogMatch(item = {}, catalogRows = []) {
  const audio = resolveSafe(item.audio || item.Audio || "");
  const isrc = normalizeKey(item.isrc || item.ISRC || "");
  const titleAlbum = normalizeKey(`${item.title || item.Title || ""}|${item.album || item.Album || ""}`);

  return catalogRows.find((row) => {
    const rowAudio = resolveSafe(row["Audio file or URL"] || row.Audio || "");
    return audio && rowAudio && rowAudio.toLowerCase() === audio.toLowerCase();
  }) || catalogRows.find((row) => (
    isrc && normalizeKey(row.ISRC || "") === isrc
  )) || catalogRows.find((row) => (
    titleAlbum && normalizeKey(`${row.Title || ""}|${row.Album || ""}`) === titleAlbum
  ));
}

async function resolveProfileYouTubeSourceItem(item = {}, paths = profilePaths(DEFAULT_PROFILE_ID)) {
  const catalogRows = await loadProfileCatalogRows(paths);
  const libraryConfig = await loadProfileLibraryConfig(paths);
  const match = findProfileCatalogMatch(item, catalogRows);
  if (!match) {
    return {
      ok: false,
      message: `Blocked YouTube full-video render: ${item.title || item.Title || "selected item"} was not found in the active profile catalogue. Run Setup > Scan library for this profile.`
    };
  }

  const audioCandidates = [
    match["Audio file or URL"],
    match.Audio,
    item.audio,
    item.Audio
  ].filter(Boolean);
  const audio = audioCandidates.find((candidate) => profileMediaFileAllowed(candidate, paths, libraryConfig, AUDIO_EXTENSIONS)) || audioCandidates[0] || "";
  const localArtworkNearAudio = await findLocalArtworkNearAudio(audio, paths, libraryConfig);
  const artworkCandidates = [
    localArtworkNearAudio,
    match["Artwork URL"],
    match.Artwork,
    item.artwork,
    item.Artwork,
    item.preview,
    item.Preview
  ].filter(Boolean);
  const artwork = artworkCandidates.find((candidate) => profileMediaFileAllowed(candidate, paths, libraryConfig, IMAGE_EXTENSIONS)) || artworkCandidates[0] || "";
  if (!profileMediaFileAllowed(audio, paths, libraryConfig, AUDIO_EXTENSIONS)) {
    return {
      ok: false,
      message: `Blocked YouTube full-video render: source audio for ${match.Title || item.title || "selected item"} is outside this profile's library.`
    };
  }
  const artworkIsRemote = /^https?:\/\//i.test(String(artwork || ""));
  const artworkIsLocalAllowed = profileMediaFileAllowed(artwork, paths, libraryConfig, IMAGE_EXTENSIONS);
  if (artwork && !artworkIsRemote && !artworkIsLocalAllowed) {
    return {
      ok: false,
      message: `Blocked YouTube full-video render: source artwork for ${match.Title || item.title || "selected item"} is missing, not an image, or outside this profile's artwork/library folders.`
    };
  }

  return {
    ok: true,
    item: {
      ...item,
      title: match.Title || item.title || item.Title || "",
      album: match.Album || item.album || item.Album || "",
      isrc: match.ISRC || item.isrc || item.ISRC || "",
      audio,
      artwork,
      preview: item.preview || item.Preview || artwork,
      profileSourceProfileId: paths.id,
      profileSourceLocked: true
    }
  };
}

async function renderYouTubeFullTrackForItem(item = {}, options = {}) {
  const paths = profilePaths(requestProfileId(options));
  await mkdir(paths.runDir, { recursive: true });
  await ensureApprovedVisualSourcesCsv(paths);
  await ensureAlbumVisualThemesCsv(paths);
  const source = await resolveProfileYouTubeSourceItem(item, paths);
  if (!source.ok) {
    return source;
  }
  const sourceItem = source.item;
  const id = `youtube-video-single-${fileStamp()}`;
  const inputManifestPath = join(paths.runDir, `${id}-source.csv`);
  const progressPath = join(paths.runDir, `${id}-progress.json`);
  const stdoutPath = join(paths.runDir, `${id}-stdout.txt`);
  const stderrPath = join(paths.runDir, `${id}-stderr.txt`);

  await writeCsvRecords(inputManifestPath, ["Title", "Album", "ISRC", "Audio file or URL", "Artwork URL", "Caption", "Hashtags", "ScheduledFor"], [{
    Title: sourceItem.title || sourceItem.Title || "",
    Album: sourceItem.album || sourceItem.Album || "",
    ISRC: sourceItem.isrc || sourceItem.ISRC || "",
    "Audio file or URL": sourceItem.audio || sourceItem.Audio || "",
    "Artwork URL": sourceItem.artwork || sourceItem.Artwork || "",
    Caption: sourceItem.caption || sourceItem.Caption || "",
    Hashtags: sourceItem.hashtags || sourceItem.Hashtags || "",
    ScheduledFor: sourceItem.scheduledFor || sourceItem.ScheduledFor || ""
  }]);

  await writeProgress(progressPath, {
    stage: "rendering",
    current: 0,
    total: 1,
    percent: 0,
    message: `Creating full-track YouTube video for ${sourceItem.title || sourceItem.Title || "selected item"}...`
  });

  let result;
  try {
    result = await runPowerShell([
      "-ExecutionPolicy", "Bypass",
      "-File", join(schedulerDir, "render-next-youtube-videos.ps1"),
      "-Count", "1",
      "-FadeOutSeconds", String(clamp(Number(options.fadeOutSeconds) || 8, 0, 30)),
      "-RenderTimeoutSeconds", String(clamp(Number(options.renderTimeoutSeconds) || 1800, 120, 7200)),
      "-CooldownDays", "0",
      "-RenderPreset", String(options.renderPreset || "balanced"),
      "-CatalogPath", paths.catalogPath,
      "-LibraryConfigPath", paths.localLibraryPath,
      "-InputManifestPath", inputManifestPath,
      "-ProgressPath", progressPath
    ]);
  } catch (error) {
    await writeFile(stdoutPath, error.stdout || "", "utf8").catch(() => {});
    await writeFile(stderrPath, error.stderr || error.message || "", "utf8").catch(() => {});
    return {
      ok: false,
      message: `Could not render full-track YouTube video for ${item.title || item.Title || "selected item"}: ${String(error.stderr || error.message || "render failed").trim()}`
    };
  }

  await writeFile(stdoutPath, result.stdout || "", "utf8").catch(() => {});
  await writeFile(stderrPath, result.stderr || "", "utf8").catch(() => {});
  const batchFolder = matchLine(result.stdout, /^Batch folder:\s*(.+)$/m);
  const renderedItems = await readReviewManifestItems(batchFolder).catch(() => []);
  const rendered = renderedItems.find((entry) => sameCampaignItem(entry, sourceItem) && String(entry.Status || entry.status || "").toLowerCase() !== "render_failed")
    || renderedItems.find((entry) => String(entry.Status || entry.status || "").toLowerCase() !== "render_failed");

  if (!rendered) {
    return {
      ok: false,
      message: `Could not render full-track YouTube video for ${item.title || item.Title || "selected item"}.`
    };
  }

  const normalized = normalizeYouTubeRenderedItem(rendered, sourceItem);
  const check = validateYouTubeFullTrackUpload(normalized);
  if (!check.ok) {
    return {
      ok: false,
      message: check.message
    };
  }

  return {
    ok: true,
    item: normalized,
    batchFolder
  };
}

function normalizeYouTubeRenderedItem(rendered = {}, source = {}) {
  return {
    ...source,
    id: source.id || source.isrc || source.ISRC || rendered.ISRC || rendered.Title || "",
    status: "approved",
    title: rendered.Title || rendered.title || source.title || source.Title || "",
    album: rendered.Album || rendered.album || source.album || source.Album || "",
    isrc: rendered.ISRC || rendered.isrc || source.isrc || source.ISRC || "",
    video: rendered.Video || rendered.video || "",
    preview: rendered.Preview || rendered.preview || source.preview || source.Preview || "",
    audio: rendered.Audio || rendered.audio || source.audio || source.Audio || "",
    artwork: rendered.Artwork || rendered.artwork || source.artwork || source.Artwork || "",
    template: rendered.Template || rendered.template || "youtube-full-track",
    durationSeconds: Number(rendered.DurationSeconds || rendered.durationSeconds || source.durationSeconds || source.DurationSeconds || 0),
    scheduledFor: rendered.ScheduledFor || rendered.scheduledFor || source.scheduledFor || source.ScheduledFor || "",
    caption: rendered.Caption || rendered.caption || source.caption || source.Caption || "",
    hashtags: rendered.Hashtags || rendered.hashtags || source.hashtags || source.Hashtags || "",
    youtubeVideoId: "",
    youtubeUrl: "",
    youtubePublishedAt: "",
    youtubePublishStatus: "",
    youtubePublishError: "",
    profileSourceProfileId: source.profileSourceProfileId || "",
    profileSourceLocked: Boolean(source.profileSourceLocked)
  };
}

function appendYouTubeProfileLinks(description) {
  const text = cleanPublicYouTubeDescription(description);
  if (/open\.spotify\.com\/artist\/0S6IzRQRufNIAl55OxmCSG/i.test(text)) return text;
  return `${text}\n\nListen / follow:\nSpotify: https://open.spotify.com/artist/0S6IzRQRufNIAl55OxmCSG?si=sHoguMfmTrmKvb9e2yrRoA\nInstagram: https://www.instagram.com/majascoffeejazzzone/?hl=en\nSoundCloud: https://soundcloud.com/majascoffeejazzzone`;
}

function cleanPublicYouTubeDescription(description) {
  return String(description || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !/^(description style|concept|inspired by|visual mood|theme basis|visual search|safe visual plan|licensing):/i.test(part))
    .join("\n\n")
    .trim();
}

function youtubeShortTags(item = {}) {
  const campaignTags = String(item.keywords || item.Keywords || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return [...new Set([
    ...campaignTags,
    "coffee jazz",
    "jazz shorts",
    "instrumental jazz",
    "relaxing music",
    "shorts"
  ])].slice(0, 20);
}

function youtubeShortDescription(item = {}) {
  const keywords = item.keywords || item.Keywords || "";
  const parts = [
    item.caption || item.Caption || "A short instrumental jazz moment for a quieter part of the day.",
    keywords ? `Keywords: ${keywords}` : "",
    "#Shorts #coffeejazz"
  ].filter(Boolean);
  return appendYouTubeProfileLinks(parts.join("\n\n"));
}

function youtubeShortTitle(item = {}) {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const shorten = (value, maxLength) => {
    const text = clean(value);
    if (text.length <= maxLength) return text;
    if (maxLength <= 3) return text.slice(0, Math.max(0, maxLength));
    return `${text.slice(0, maxLength - 3).trimEnd()}...`;
  };
  const trackTitle = shorten(item.title || item.Title || "Coffee Jazz Short", 64);
  let base = clean(item.seoTitle || item.SeoTitle || "Coffee Jazz Short");
  if (trackTitle && clean(base).toLowerCase() === trackTitle.toLowerCase()) {
    base = "Coffee Jazz Short";
  }
  if (!/#shorts/i.test(base)) {
    base = `${base} #Shorts`;
  }
  const suffix = trackTitle ? ` | ${trackTitle}` : "";
  const maxBaseLength = Math.max(0, 100 - suffix.length);
  return `${shorten(base, maxBaseLength)}${suffix}`.slice(0, 100);
}

function googleApiErrorMessage(body) {
  try {
    const parsed = JSON.parse(body || "{}");
    const error = parsed.error || {};
    const reason = Array.isArray(error.errors) && error.errors[0]?.reason ? error.errors[0].reason : "";
    const message = error.message || parsed.message || "";
    return [reason, message].filter(Boolean).join(" - ");
  } catch {
    return String(body || "").replace(/\s+/g, " ").trim().slice(0, 300);
  }
}

async function youtubeAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID || "",
      client_secret: env.YOUTUBE_CLIENT_SECRET || "",
      refresh_token: env.YOUTUBE_REFRESH_TOKEN || "",
      grant_type: "refresh_token"
    })
  });
  const result = await response.json();
  if (!response.ok || result.error || !result.access_token) {
    throw new Error(result.error_description || result.error || "Could not refresh YouTube access token.");
  }
  return result.access_token;
}

async function checkYouTubeUploadToken() {
  const missing = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"].filter((key) => !env[key]);
  if (missing.length) {
    return {
      ok: false,
      message: `Missing YouTube credential${missing.length === 1 ? "" : "s"} in .env: ${missing.join(", ")}`
    };
  }
  try {
    await youtubeAccessToken();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: `YouTube login token has expired or been revoked. Open Setup > YouTube, reconnect Google OAuth, then try again. ${error.message || ""}`.trim()
    };
  }
}

async function pexelsReadiness(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  await mkdir(paths.approvedVisualVideosDir, { recursive: true });
  await ensureApprovedVisualSourcesCsv(paths);
  await ensureAlbumVisualThemesCsv(paths);
  const videoFiles = await listLocalVisualVideos(paths);
  const records = await readApprovedVisualSourceRecords(paths);
  const themeRows = await readAlbumVisualThemeRows(paths);
  return {
    ok: true,
    profileId: paths.id,
    ready: Boolean(env.PEXELS_API_KEY || env.PIXABAY_API_KEY),
    provider: "Stock visual sources",
    apiKeyPresent: Boolean(env.PEXELS_API_KEY),
    pexelsApiKeyPresent: Boolean(env.PEXELS_API_KEY),
    pixabayApiKeyPresent: Boolean(env.PIXABAY_API_KEY),
    approvedVideoDir: paths.approvedVisualVideosDir,
    sourceManifestPath: paths.approvedVisualSourcesPath,
    albumThemePath: paths.albumVisualThemesPath,
    localVideoCount: videoFiles.length,
    sourceRecordCount: records.length,
    albumThemeCount: themeRows.length,
    albumThemeFilledCount: themeRows.filter((row) => row.Mood || row.Theme || row.Style || row.Scene || row.Instruments || row.SearchTerms).length,
    checks: [
      {
        id: "api-key",
        label: "Pexels API key",
        ok: Boolean(env.PEXELS_API_KEY),
        help: env.PEXELS_API_KEY ? "Key is present in backend .env." : "Add PEXELS_API_KEY to backend .env, then restart the app."
      },
      {
        id: "pixabay-api-key",
        label: "Pixabay API key",
        ok: Boolean(env.PIXABAY_API_KEY),
        help: env.PIXABAY_API_KEY ? "Key is present in backend .env." : "Optional: add PIXABAY_API_KEY to backend .env for a second stock video source."
      },
      {
        id: "approved-folder",
        label: "Approved video folder",
        ok: true,
        help: paths.approvedVisualVideosDir
      },
      {
        id: "source-records",
        label: "Source records",
        ok: existsSync(paths.approvedVisualSourcesPath),
        help: paths.approvedVisualSourcesPath
      },
      {
        id: "album-themes",
        label: "Album visual themes",
        ok: existsSync(paths.albumVisualThemesPath),
        help: paths.albumVisualThemesPath
      }
    ]
  };
}

async function searchPexelsVideos(payload = {}) {
  if (!env.PEXELS_API_KEY) {
    return { ok: false, message: "PEXELS_API_KEY is missing from backend .env. Add it and restart the app." };
  }
  const query = stockSearchQuery(String(payload.query || "jazz cafe coffee shop").trim(), payload.breadth);
  if (!query) return { ok: false, message: "Enter a Pexels search query first." };
  const params = new URLSearchParams({
    query,
    orientation: payload.orientation || "portrait",
    size: payload.size || "medium",
    per_page: String(clamp(Number(payload.perPage) || 15, 1, 20)),
    page: String(stockSearchPage(payload))
  });
  const endpoint = `https://api.pexels.com/v1/videos/search?${params}`;
  const response = await fetch(endpoint, {
    headers: {
      Authorization: env.PEXELS_API_KEY
    }
  });
  const body = await response.text();
  let parsed = {};
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    return {
      ok: false,
      message: parsed.error || parsed.message || `Pexels search failed with HTTP ${response.status}.`,
      status: response.status,
      body: body.slice(0, 500)
    };
  }

  const videos = (parsed.videos || []).map((video) => normalizePexelsVideo(video, query)).filter(Boolean);
  return {
    ok: true,
    message: `Found ${videos.length} Pexels video${videos.length === 1 ? "" : "s"} for "${query}".`,
    query,
    totalResults: parsed.total_results || videos.length,
    page: parsed.page || 1,
    perPage: parsed.per_page || videos.length,
    rateLimit: {
      limit: response.headers.get("x-ratelimit-limit") || "",
      remaining: response.headers.get("x-ratelimit-remaining") || "",
      reset: response.headers.get("x-ratelimit-reset") || ""
    },
    videos
  };
}

async function searchStockVisualVideos(payload = {}) {
  const provider = String(payload.provider || "all").toLowerCase();
  const searches = [];
  if (provider === "all" || provider === "pexels") searches.push(searchPexelsVideos(payload).catch((error) => ({ ok: false, provider: "Pexels", message: error.message })));
  if (provider === "all" || provider === "pixabay") searches.push(searchPixabayVideos(payload).catch((error) => ({ ok: false, provider: "Pixabay", message: error.message })));
  if (!searches.length) return { ok: false, message: "Choose Pexels, Pixabay, or All sources." };

  const results = await Promise.all(searches);
  const videos = results
    .flatMap((result) => Array.isArray(result.videos) ? result.videos : [])
    .sort((a, b) => stockVisualScore(b) - stockVisualScore(a));
  const providers = results.map((result) => ({
    provider: result.provider || "",
    ok: Boolean(result.ok),
    message: result.message || "",
    count: Array.isArray(result.videos) ? result.videos.length : 0,
    rateLimit: result.rateLimit || null
  }));
  return {
    ok: videos.length > 0,
    message: videos.length
      ? `Found ${videos.length} stock video option${videos.length === 1 ? "" : "s"} across ${providers.filter((item) => item.ok).length} source${providers.filter((item) => item.ok).length === 1 ? "" : "s"}.`
      : providers.map((item) => item.message).filter(Boolean).join(" ") || "No stock videos found.",
    query: payload.query || "",
    provider,
    providers,
    videos
  };
}

async function searchPixabayVideos(payload = {}) {
  if (!env.PIXABAY_API_KEY) {
    return { ok: false, provider: "Pixabay", message: "PIXABAY_API_KEY is missing from backend .env. Add it and restart the app." };
  }
  const query = stockSearchQuery(String(payload.query || "jazz cafe coffee shop").trim(), payload.breadth);
  if (!query) return { ok: false, provider: "Pixabay", message: "Enter a Pixabay search query first." };
  const orientationMap = {
    portrait: "vertical",
    landscape: "horizontal",
    square: "all"
  };
  const params = new URLSearchParams({
    key: env.PIXABAY_API_KEY,
    q: query,
    video_type: "film",
    orientation: orientationMap[payload.orientation] || "vertical",
    per_page: String(clamp(Number(payload.perPage) || 15, 3, 20)),
    page: String(stockSearchPage(payload)),
    safesearch: "true"
  });
  const endpoint = `https://pixabay.com/api/videos/?${params}`;
  const response = await fetch(endpoint, {
    headers: {
      "user-agent": "Maja Coffee Jazz Scheduler"
    }
  });
  const body = await response.text();
  let parsed = {};
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    parsed = {};
  }
  if (!response.ok) {
    return {
      ok: false,
      provider: "Pixabay",
      message: parsed.error || parsed.message || `Pixabay search failed with HTTP ${response.status}.`,
      status: response.status,
      body: body.slice(0, 500)
    };
  }
  const videos = (parsed.hits || []).map((video) => normalizePixabayVideo(video, query)).filter(Boolean);
  return {
    ok: true,
    provider: "Pixabay",
    message: `Found ${videos.length} Pixabay video${videos.length === 1 ? "" : "s"} for "${query}".`,
    query,
    totalResults: parsed.totalHits || videos.length,
    videos
  };
}

function stockSearchPage(payload = {}) {
  if (payload.page) return clamp(Number(payload.page) || 1, 1, 100);
  const breadth = String(payload.breadth || "balanced").toLowerCase();
  const maxPage = breadth === "wide" ? 8 : breadth === "focused" ? 2 : 5;
  return 1 + Math.floor(Math.random() * maxPage);
}

function stockSearchQuery(query = "", breadth = "balanced") {
  const clean = String(query || "").trim();
  if (!clean) return "";
  const mode = String(breadth || "balanced").toLowerCase();
  if (mode === "focused") return clean;
  const isNature = /bird|birds|nature|outdoor|mountain|mountains|peru|peruvian|machu|picchu|andes|andean|flute|panpipe|plantation|hillside|forest|valley/i.test(clean);
  const variants = isNature ? [
    clean,
    `cinematic nature ${clean}`,
    `${clean} landscape`,
    `outdoor ${clean}`,
    `peaceful mountain ${clean}`,
    "Andean mountain scenery",
    "outdoor birds flying mountains",
    "misty mountain valley",
    "Peru nature landscape"
  ] : [
    clean,
    `cinematic ${clean}`,
    `${clean} ambience`,
    `coffee shop ${clean}`,
    `lofi ${clean}`,
    `relaxing ${clean}`
  ];
  const pool = mode === "wide" ? variants : variants.slice(0, 4);
  return pool[Math.floor(Math.random() * pool.length)];
}

async function downloadPexelsVideo(payload = {}) {
  if (!env.PEXELS_API_KEY) {
    return { ok: false, message: "PEXELS_API_KEY is missing from backend .env. Add it and restart the app." };
  }
  const paths = profilePaths(requestProfileId(payload));
  const video = payload.video || {};
  const selectedFile = video.selectedFile || video.file || {};
  const link = String(selectedFile.link || payload.link || "").trim();
  if (!/^https:\/\//i.test(link)) {
    return { ok: false, message: "The selected Pexels video did not include a secure download link." };
  }

  await mkdir(paths.approvedVisualVideosDir, { recursive: true });
  await ensureApprovedVisualSourcesCsv(paths);
  const id = String(video.id || payload.id || Date.now()).replace(/[^0-9a-z_-]/gi, "");
  const querySlug = safeFileSlug(video.query || payload.query || "pexels-video");
  const outputPath = join(paths.approvedVisualVideosDir, `pexels-${id}-${querySlug}.mp4`);

  if (!existsSync(outputPath)) {
    const response = await fetch(link, {
      headers: {
        "user-agent": "Maja Coffee Jazz Scheduler"
      }
    });
    if (!response.ok) {
      return { ok: false, message: `Could not download Pexels MP4. HTTP ${response.status}.` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, buffer);
  }

  const record = {
    FilePath: outputPath,
    Title: video.title || `Pexels video ${id}`,
    Tags: [video.query, video.title, "pexels", "coffee jazz atmosphere", "approved video"].filter(Boolean).join(" "),
    SourceUrl: video.url || "",
    Creator: video.user?.name || video.userName || "",
    License: "Pexels License",
    CommercialUse: "yes",
    AttributionRequired: "recommended",
    Approved: "yes",
    Notes: `Downloaded via Pexels API on ${new Date().toISOString()}. Link back to Pexels and credit creator where possible. File ${selectedFile.width || ""}x${selectedFile.height || ""} ${selectedFile.quality || ""}.`
  };
  await appendApprovedVisualSourceRecord(record, paths);
  return {
    ok: true,
    message: `Downloaded approved Pexels video: ${basename(outputPath)}`,
    profileId: paths.id,
    filePath: outputPath,
    sourceManifestPath: paths.approvedVisualSourcesPath,
    record
  };
}

async function downloadStockVisualVideo(payload = {}) {
  const video = payload.video || {};
  const provider = String(video.provider || payload.provider || "").toLowerCase();
  if (provider === "pixabay") return downloadPixabayVideo(payload);
  return downloadPexelsVideo(payload);
}

async function downloadPixabayVideo(payload = {}) {
  if (!env.PIXABAY_API_KEY) {
    return { ok: false, message: "PIXABAY_API_KEY is missing from backend .env. Add it and restart the app." };
  }
  const paths = profilePaths(requestProfileId(payload));
  const video = payload.video || {};
  const selectedFile = video.selectedFile || video.file || {};
  const link = String(selectedFile.link || selectedFile.url || payload.link || "").trim();
  if (!/^https:\/\//i.test(link)) {
    return { ok: false, message: "The selected Pixabay video did not include a secure download link." };
  }

  await mkdir(paths.approvedVisualVideosDir, { recursive: true });
  await ensureApprovedVisualSourcesCsv(paths);
  const id = String(video.id || payload.id || Date.now()).replace(/[^0-9a-z_-]/gi, "");
  const querySlug = safeFileSlug(video.query || payload.query || "pixabay-video");
  const outputPath = join(paths.approvedVisualVideosDir, `pixabay-${id}-${querySlug}.mp4`);

  if (!existsSync(outputPath)) {
    const response = await fetch(link, {
      headers: {
        "user-agent": "Maja Coffee Jazz Scheduler"
      }
    });
    if (!response.ok) {
      return { ok: false, message: `Could not download Pixabay MP4. HTTP ${response.status}.` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outputPath, buffer);
  }

  const record = {
    FilePath: outputPath,
    Title: video.title || `Pixabay video ${id}`,
    Tags: [video.query, video.title, "pixabay", "coffee jazz atmosphere", "approved video"].filter(Boolean).join(" "),
    SourceUrl: video.url || "",
    Creator: video.userName || video.user?.name || "",
    License: "Pixabay Content License",
    CommercialUse: "yes",
    AttributionRequired: "not required",
    Approved: "yes",
    Notes: `Downloaded via Pixabay API on ${new Date().toISOString()}. Verify final use against Pixabay Content License. File ${selectedFile.width || ""}x${selectedFile.height || ""}.`
  };
  await appendApprovedVisualSourceRecord(record, paths);
  return {
    ok: true,
    message: `Downloaded approved Pixabay video: ${basename(outputPath)}`,
    profileId: paths.id,
    filePath: outputPath,
    sourceManifestPath: paths.approvedVisualSourcesPath,
    record
  };
}

async function clearApprovedPexelsSources(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  await mkdir(paths.approvedVisualVideosDir, { recursive: true });
  const root = resolve(paths.visualSourcesDir);
  const videoDir = resolve(paths.approvedVisualVideosDir);
  if (!videoDir.startsWith(root)) {
    return { ok: false, message: "Refused to clear visual sources because the folder path is outside the visual-sources directory." };
  }

  const entries = await readdir(paths.approvedVisualVideosDir, { withFileTypes: true }).catch(() => []);
  let removedFiles = 0;
  const allowed = new Set([".mp4", ".mov", ".m4v", ".webm"]);
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(paths.approvedVisualVideosDir, entry.name);
    if (!allowed.has(extname(entry.name).toLowerCase())) continue;
    await rm(path, { force: true }).catch(() => {});
    removedFiles += 1;
  }

  await ensureApprovedVisualSourcesCsv(paths);
  await writeCsvRecords(paths.approvedVisualSourcesPath, [
    "FilePath", "Title", "Tags", "SourceUrl", "Creator", "License", "CommercialUse", "AttributionRequired", "Approved", "Notes"
  ], []);

  return {
    ok: true,
    message: `Cleared ${removedFiles} approved stock video${removedFiles === 1 ? "" : "s"} and reset source records. Album theme CSV was kept.`,
    profileId: paths.id,
    removedFiles,
    approvedVideoDir: paths.approvedVisualVideosDir,
    sourceManifestPath: paths.approvedVisualSourcesPath
  };
}

function normalizePexelsVideo(video = {}, query = "") {
  const selectedFile = selectPexelsVideoFile(video.video_files || []);
  if (!selectedFile) return null;
  const preview = Array.isArray(video.video_pictures) && video.video_pictures[0]?.picture ? video.video_pictures[0].picture : "";
  return {
    provider: "pexels",
    providerLabel: "Pexels",
    id: video.id || "",
    title: video.alt || video.url || `Pexels video ${video.id || ""}`,
    query,
    width: video.width || 0,
    height: video.height || 0,
    duration: video.duration || 0,
    url: video.url || "",
    image: video.image || preview,
    preview,
    user: video.user || null,
    userName: video.user?.name || "",
    selectedFile,
    files: (video.video_files || []).map((file) => ({
      id: file.id || "",
      quality: file.quality || "",
      fileType: file.file_type || "",
      width: file.width || 0,
      height: file.height || 0,
      fps: file.fps || 0,
      link: file.link || ""
    }))
  };
}

function normalizePixabayVideo(video = {}, query = "") {
  const selectedFile = selectPixabayVideoFile(video.videos || {});
  if (!selectedFile) return null;
  const title = video.tags || `Pixabay video ${video.id || ""}`;
  const preview = video.picture_id ? `https://i.vimeocdn.com/video/${video.picture_id}_640x360.jpg` : "";
  return {
    provider: "pixabay",
    providerLabel: "Pixabay",
    id: video.id || "",
    title,
    query,
    width: selectedFile.width || 0,
    height: selectedFile.height || 0,
    duration: video.duration || 0,
    url: video.pageURL || "",
    image: preview,
    preview,
    user: { name: video.user || "" },
    userName: video.user || "",
    selectedFile,
    files: Object.entries(video.videos || {}).map(([quality, file]) => ({
      id: quality,
      quality,
      fileType: "video/mp4",
      width: file.width || 0,
      height: file.height || 0,
      fps: 0,
      link: file.url || ""
    }))
  };
}

function selectPixabayVideoFile(files = {}) {
  const candidates = Object.entries(files)
    .filter(([, file]) => /^https:\/\//i.test(file?.url || ""))
    .map(([quality, file]) => ({
      id: quality,
      quality,
      fileType: "video/mp4",
      width: file.width || 0,
      height: file.height || 0,
      fps: 0,
      link: file.url || "",
      score: (file.height >= file.width ? 50 : 0)
        + (file.height >= 1280 ? 30 : 0)
        + (file.width >= 720 ? 20 : 0)
        + (quality === "large" ? 15 : quality === "medium" ? 10 : 0)
        - Math.abs((file.height || 1920) - 1920) / 100
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

function stockVisualScore(video = {}) {
  const file = video.selectedFile || {};
  return (file.height >= file.width ? 50 : 0)
    + (file.height >= 1280 ? 30 : 0)
    + (file.width >= 720 ? 20 : 0)
    + (Number(video.duration || 0) >= 8 ? 8 : 0)
    + (video.provider === "pexels" ? 2 : 0);
}

function selectPexelsVideoFile(files = []) {
  const candidates = files
    .filter((file) => file.file_type === "video/mp4" && /^https:\/\//i.test(file.link || ""))
    .map((file) => ({
      id: file.id || "",
      quality: file.quality || "",
      fileType: file.file_type || "",
      width: file.width || 0,
      height: file.height || 0,
      fps: file.fps || 0,
      link: file.link || "",
      score: (file.height >= file.width ? 50 : 0)
        + (file.height >= 1280 ? 30 : 0)
        + (file.width >= 720 ? 20 : 0)
        + (file.quality === "hd" ? 10 : 0)
        - Math.abs((file.height || 1920) - 1920) / 100
    }))
    .sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

async function listLocalVisualVideos(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  if (!existsSync(paths.approvedVisualVideosDir)) return [];
  const files = await listMediaFiles(paths.approvedVisualVideosDir, new Set([".mp4", ".mov", ".m4v", ".webm"])).catch(() => []);
  return files;
}

async function ensureApprovedVisualSourcesCsv(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  await mkdir(paths.visualSourcesDir, { recursive: true });
  await mkdir(paths.approvedVisualVideosDir, { recursive: true });
  if (!existsSync(paths.approvedVisualSourcesPath)) {
    await writeCsvRecords(paths.approvedVisualSourcesPath, [
      "FilePath", "Title", "Tags", "SourceUrl", "Creator", "License", "CommercialUse", "AttributionRequired", "Approved", "Notes"
    ], []);
  }
}

async function ensureAlbumVisualThemesCsv(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  await mkdir(paths.visualSourcesDir, { recursive: true });
  if (existsSync(paths.albumVisualThemesPath)) return;
  await writeCsvRecords(paths.albumVisualThemesPath, [
    "Album", "Mood", "Theme", "Style", "Scene", "Instruments", "SearchTerms", "NegativeTerms", "Notes"
  ], []);
}

async function readApprovedVisualSourceRecords(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  if (!existsSync(paths.approvedVisualSourcesPath)) return [];
  const parsed = parseCsvRecords(await readFile(paths.approvedVisualSourcesPath, "utf8"));
  return parsed.rows;
}

async function readAlbumVisualThemeRows(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  if (!existsSync(paths.albumVisualThemesPath)) return [];
  const parsed = parseCsvRecords((await readFile(paths.albumVisualThemesPath, "utf8")).replace(/^\uFEFF/, ""));
  return parsed.rows;
}

async function appendApprovedVisualSourceRecord(record, paths = profilePaths(DEFAULT_PROFILE_ID)) {
  await ensureApprovedVisualSourcesCsv(paths);
  const headers = ["FilePath", "Title", "Tags", "SourceUrl", "Creator", "License", "CommercialUse", "AttributionRequired", "Approved", "Notes"];
  const line = headers.map((header) => csvEscape(record[header] || "")).join(",");
  await appendFile(paths.approvedVisualSourcesPath, `${line}\r\n`, "utf8");
}

function safeFileSlug(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "item";
}

function safeTrackFileBaseName(value, fallback = "Track") {
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, " - ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 180) || fallback;
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned) ? `${cleaned} Track` : cleaned;
}

async function renderBatch(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  await ensureApprovedVisualSourcesCsv(paths);
  await ensureAlbumVisualThemesCsv(paths);
  const count = clamp(Number(payload.count) || 10, 1, 50);
  const minSeconds = clamp(Number(payload.minSeconds) || 25, 5, 180);
  const maxSeconds = clamp(Number(payload.maxSeconds) || 45, minSeconds, 180);
  const fadeOutSeconds = clamp(Number(payload.fadeOutSeconds) || 4, 0, 20);
  const renderTimeoutSeconds = clamp(Number(payload.renderTimeoutSeconds) || 300, 30, 1800);
  const cooldownDays = clamp(Number(payload.cooldownDays) || 90, 0, 1000);
  const shortsPerTrack = clamp(Number(payload.shortsPerTrack || payload.shortsPerDay) || 1, 1, 3);
  const templateMode = payload.templateMode || "rotate";
  const renderPreset = payload.renderPreset || "balanced";
  const performancePreset = payload.usePerformancePreset
    ? await buildPerformanceGeneratePreset({ profileId: paths.id, count })
    : null;
  const performancePresetPath = performancePreset?.ok ? paths.performanceGeneratePresetPath : "";

  const args = [
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, "render-next-draft-reels.ps1"),
    "-Count", String(count),
    "-MinSeconds", String(minSeconds),
    "-MaxSeconds", String(maxSeconds),
    "-FadeOutSeconds", String(fadeOutSeconds),
    "-RenderTimeoutSeconds", String(renderTimeoutSeconds),
    "-CooldownDays", String(cooldownDays),
    "-ShortsPerTrack", String(shortsPerTrack),
    "-RenderPreset", renderPreset,
    "-TemplateMode", templateMode,
    "-CatalogPath", paths.catalogPath,
    "-LibraryConfigPath", paths.localLibraryPath,
    "-VisualAssetDir", paths.approvedVisualVideosDir,
    "-VisualSourceManifestPath", paths.approvedVisualSourcesPath,
    "-AlbumThemePath", paths.albumVisualThemesPath
  ];
  if (performancePresetPath) {
    args.push("-PerformancePresetPath", performancePresetPath);
  }
  if (env.PEXELS_API_KEY) {
    args.push("-AutoSourcePexels");
  }
  if (env.PIXABAY_API_KEY) {
    args.push("-AutoSourcePixabay");
  }

  const result = await runPowerShell(args);

  const manifest = matchLine(result.stdout, /^Review manifest:\s*(.+)$/m);
  const batchFolder = matchLine(result.stdout, /^Batch folder:\s*(.+)$/m);
  const items = await readReviewManifestItems(batchFolder);

  return {
    ok: true,
    profileId: paths.id,
    message: `Rendered ${count} review draft${count === 1 ? "" : "s"}.`,
    batchFolder,
    manifest,
    items,
    performancePreset,
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
  config.youtubeSetup = {
    ...(existing.youtubeSetup || {}),
    ...(sanitizeUserConfig(payload).youtubeSetup || {})
  };
  if (sanitizeUserConfig(payload).profiles) {
    config.profiles = sanitizeUserConfig(payload).profiles;
  }
  if (sanitizeUserConfig(payload).activeProfileId) {
    config.activeProfileId = sanitizeUserConfig(payload).activeProfileId;
  }
  if (sanitizeUserConfig(payload).profileConfigs) {
    config.profileConfigs = {
      ...(existing.profileConfigs || {}),
      ...sanitizeUserConfig(payload).profileConfigs
    };
  }

  await mkdir(dirname(userConfigPath), { recursive: true });
  await writeFile(userConfigPath, JSON.stringify(config, null, 2), "utf8");
  return {
    ok: true,
    message: "Saved local user setup config.",
    configPath: userConfigPath,
    config
  };
}

async function saveReviewFeedback(payload = {}) {
  const item = payload.item || payload.review || payload;
  const reason = String(payload.reason || item.rejectionReason || "").trim();
  if (!reason) {
    return { ok: false, message: "No rejection reason was provided." };
  }

  const feedbackPath = join(schedulerDir, "rejection-feedback.csv");
  await mkdir(dirname(feedbackPath), { recursive: true });

  const headers = [
    "RejectedAt", "Source", "Id", "Title", "Album", "ISRC", "Audio", "Artwork", "Video", "Reason"
  ];
  const row = {
    RejectedAt: item.rejectedAt || payload.rejectedAt || new Date().toISOString(),
    Source: payload.source || item.source || "reel",
    Id: item.id || item.ID || "",
    Title: item.title || item.Title || "",
    Album: item.album || item.Album || "",
    ISRC: item.isrc || item.ISRC || "",
    Audio: item.audio || item.Audio || "",
    Artwork: item.artwork || item.Artwork || "",
    Video: item.video || item.Video || "",
    Reason: reason
  };

  const needsHeader = !existsSync(feedbackPath);
  const csv = [
    ...(needsHeader ? [headers.map(csvEscape).join(",")] : []),
    headers.map((header) => csvEscape(row[header])).join(",")
  ].join("\r\n");
  await appendFile(feedbackPath, `${csv}\r\n`, "utf8");
  return {
    ok: true,
    message: "Saved rejection feedback.",
    path: feedbackPath
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
    },
    youtubeSetup: {
      ...defaults.youtubeSetup,
      ...(sanitizeUserConfig(parsed).youtubeSetup || {})
    }
  };
}

function defaultUserConfig() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: "",
    firstRunComplete: false,
    activeProfileId: "majas-coffee-jazz-zone",
    profiles: [
      {
        id: "majas-coffee-jazz-zone",
        name: "Maja's Coffee Jazz Zone",
        handle: "@majascoffeejazzzone",
        description: "Coffee jazz catalogue"
      },
      {
        id: "majawick-music",
        name: "Majawick Music",
        handle: "@majawickmusic",
        description: "Second artist profile"
      }
    ],
    profileConfigs: {},
    setupWizard: {
      artistName: "Maja's Coffee Jazz Zone",
      audioRoot: "",
      artworkRoot: "",
      lastScan: null
    },
    postingSettings: {},
    instagramSetup: {},
    youtubeSetup: {}
  };
}

function sanitizeUserConfig(value = {}) {
  const allowed = {};
  if (value.activeProfileId) allowed.activeProfileId = String(value.activeProfileId || "");
  if (Array.isArray(value.profiles)) {
    allowed.profiles = value.profiles.map((profile) => ({
      id: String(profile.id || ""),
      name: String(profile.name || ""),
      handle: String(profile.handle || ""),
      description: String(profile.description || "")
    })).filter((profile) => profile.id && profile.name);
  }
  if (value.profileConfigs && typeof value.profileConfigs === "object") {
    allowed.profileConfigs = {};
    for (const [profileId, profileConfig] of Object.entries(value.profileConfigs)) {
      if (!profileId || !profileConfig || typeof profileConfig !== "object") continue;
      allowed.profileConfigs[profileId] = sanitizeUserConfig(profileConfig);
    }
  }
  if (typeof value.firstRunComplete === "boolean") allowed.firstRunComplete = value.firstRunComplete;
  if (value.setupWizard && typeof value.setupWizard === "object") {
    allowed.setupWizard = {
      artistName: String(value.setupWizard.artistName || ""),
      audioRoot: normalizeLocalFolderInput(value.setupWizard.audioRoot || ""),
      artworkRoot: normalizeLocalFolderInput(value.setupWizard.artworkRoot || ""),
      lastScan: value.setupWizard.lastScan && typeof value.setupWizard.lastScan === "object" ? value.setupWizard.lastScan : null
    };
  }
  if (value.postingSettings && typeof value.postingSettings === "object") {
    allowed.postingSettings = { ...value.postingSettings };
  }
  if (value.instagramSetup && typeof value.instagramSetup === "object") {
    allowed.instagramSetup = { ...value.instagramSetup };
  }
  if (value.youtubeSetup && typeof value.youtubeSetup === "object") {
    allowed.youtubeSetup = {
      channelLabel: String(value.youtubeSetup.channelLabel || ""),
      channelId: String(value.youtubeSetup.channelId || ""),
      defaultPrivacy: String(value.youtubeSetup.defaultPrivacy || "private"),
      madeForKids: Boolean(value.youtubeSetup.madeForKids),
      uploadShorts: value.youtubeSetup.uploadShorts !== false,
      backendRequired: value.youtubeSetup.backendRequired !== false
    };
  }
  if (value.profileConnection && typeof value.profileConnection === "object") {
    allowed.profileConnection = {
      instagramUserId: String(value.profileConnection.instagramUserId || ""),
      facebookPageId: String(value.profileConnection.facebookPageId || ""),
      r2Bucket: String(value.profileConnection.r2Bucket || ""),
      r2PublicBaseUrl: String(value.profileConnection.r2PublicBaseUrl || ""),
      youtubeChannelId: String(value.profileConnection.youtubeChannelId || ""),
      youtubeOAuthLabel: String(value.profileConnection.youtubeOAuthLabel || "")
    };
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

  const paths = profilePaths(requestProfileId(payload));
  await ensureApprovedVisualSourcesCsv(paths);
  await ensureAlbumVisualThemesCsv(paths);
  await mkdir(paths.runDir, { recursive: true });
  const id = `render-${fileStamp()}`;
  const progressPath = join(paths.runDir, `${id}-progress.json`);
  const stdoutPath = join(paths.runDir, `${id}-stdout.txt`);
  const stderrPath = join(paths.runDir, `${id}-stderr.txt`);
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
  const shortsPerTrack = clamp(Number(payload.shortsPerTrack || payload.shortsPerDay) || 1, 1, 3);
  const templateMode = payload.templateMode || "rotate";
  const renderPreset = payload.renderPreset || "balanced";
  const performancePreset = payload.usePerformancePreset
    ? await buildPerformanceGeneratePreset({ profileId: paths.id, count })
    : null;
  const performancePresetPath = performancePreset?.ok ? paths.performanceGeneratePresetPath : "";

  const args = [
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, "render-next-draft-reels.ps1"),
    "-Count", String(count),
    "-MinSeconds", String(minSeconds),
    "-MaxSeconds", String(maxSeconds),
    "-FadeOutSeconds", String(fadeOutSeconds),
    "-RenderTimeoutSeconds", String(renderTimeoutSeconds),
    "-CooldownDays", String(cooldownDays),
    "-ShortsPerTrack", String(shortsPerTrack),
    "-RenderPreset", renderPreset,
    "-TemplateMode", templateMode,
    "-CatalogPath", paths.catalogPath,
    "-LibraryConfigPath", paths.localLibraryPath,
    "-ProgressPath", progressPath,
    "-VisualAssetDir", paths.approvedVisualVideosDir,
    "-VisualSourceManifestPath", paths.approvedVisualSourcesPath,
    "-AlbumThemePath", paths.albumVisualThemesPath
  ];
  if (performancePresetPath) {
    args.push("-PerformancePresetPath", performancePresetPath);
  }
  if (env.PEXELS_API_KEY) {
    args.push("-AutoSourcePexels");
  }
  if (env.PIXABAY_API_KEY) {
    args.push("-AutoSourcePixabay");
  }

  const child = spawn("powershell", args, {
    cwd: workspaceRoot,
    env: schedulerChildEnv(),
    windowsHide: true
  });

  currentRenderJob = {
    id,
    profileId: paths.id,
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
    const manifestRecords = await readReviewManifestRecords(batchFolder).catch(() => []);
    const items = filterPlayableReviewItems(manifestRecords);
    const failedCount = manifestRecords.length - items.length;
    currentRenderJob.result = {
      ok: true,
      message: `Rendered ${items.length} playable review draft${items.length === 1 ? "" : "s"}${failedCount ? ` and skipped ${failedCount} failed item${failedCount === 1 ? "" : "s"}.` : "."}`,
      batchFolder,
      manifest,
      items,
      failedCount,
      performancePreset: currentRenderJob.performancePreset || null,
      output: currentRenderJob.stdout.trim()
    };
    await saveReviewCache({
      profileId: paths.id,
      source: "render-complete",
      batchFolder,
      manifest,
      failedCount,
      items
    }).catch(() => {});
    await writeProgress(progressPath, {
      stage: "complete",
      current: items.length,
      total: count,
      percent: 100,
      message: failedCount
        ? `Render complete. Loaded ${items.length} playable draft${items.length === 1 ? "" : "s"} into Review. ${failedCount} failed item${failedCount === 1 ? "" : "s"} were hidden.`
        : "Render complete. Loaded into Review."
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

  const baseProgress = await readProgress(currentRenderJob.progressPath, "Rendering...");
  const progress = currentRenderJob.running
    ? await freshestRenderProgress(baseProgress, currentRenderJob.startedAt)
    : baseProgress;
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

async function latestReviewBatch(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const manifestPath = await latestReviewManifest();
  if (!manifestPath) {
    return { ok: false, message: "No rendered batch folders found." };
  }
  const batchFolder = dirname(manifestPath);

  const manifestRecords = await readReviewManifestRecords(batchFolder);
  const items = filterPlayableReviewItems(manifestRecords);
  const failedCount = manifestRecords.length - items.length;
  if (!items.length) {
    return {
      ok: false,
      message: failedCount
        ? `Latest batch has ${failedCount} failed item${failedCount === 1 ? "" : "s"} but no playable MP4s. Create a new batch or add matching approved visual sources.`
        : "Latest batch does not have a review manifest yet.",
      batchFolder,
      failedCount
    };
  }

  const result = {
    ok: true,
    message: `Loaded ${items.length} playable review item${items.length === 1 ? "" : "s"} from the latest batch${failedCount ? ` and hid ${failedCount} failed item${failedCount === 1 ? "" : "s"}.` : "."}`,
    batchFolder,
    manifest: manifestPath,
    items,
    failedCount
  };
  await saveReviewCache({
    profileId: paths.id,
    source: "latest-batch",
    batchFolder,
    manifest: manifestPath,
    failedCount,
    items
  }).catch(() => {});
  return result;
}

async function getReviewCache(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  if (!existsSync(paths.reviewCachePath)) {
    return {
      ok: true,
      profileId: paths.id,
      message: "No cached review drafts yet.",
      items: [],
      itemCount: 0,
      updatedAt: "",
      batchFolder: "",
      manifest: ""
    };
  }
  const parsed = JSON.parse((await readFile(paths.reviewCachePath, "utf8")).replace(/^\uFEFF/, ""));
  const items = filterPlayableReviewItems(Array.isArray(parsed.items) ? parsed.items : []);
  return {
    ok: true,
    profileId: paths.id,
    message: items.length
      ? `Loaded ${items.length} cached review draft${items.length === 1 ? "" : "s"}.`
      : "Review cache exists, but it has no playable drafts.",
    ...parsed,
    items,
    itemCount: items.length
  };
}

async function updateReviewCache(payload = {}) {
  return saveReviewCache({
    profileId: requestProfileId(payload),
    source: payload.source || "browser-review",
    batchFolder: payload.batchFolder || "",
    manifest: payload.manifest || "",
    failedCount: Number(payload.failedCount) || 0,
    items: Array.isArray(payload.items) ? payload.items : []
  });
}

async function saveReviewCache(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const items = filterPlayableReviewItems(Array.isArray(payload.items) ? payload.items : []);
  const cache = {
    ok: true,
    profileId: paths.id,
    source: payload.source || "review-cache",
    updatedAt: new Date().toISOString(),
    batchFolder: payload.batchFolder || "",
    manifest: payload.manifest || "",
    failedCount: Number(payload.failedCount) || 0,
    itemCount: items.length,
    items
  };
  await mkdir(dirname(paths.reviewCachePath), { recursive: true });
  await writeFile(paths.reviewCachePath, JSON.stringify(cache, null, 2), "utf8");
  return {
    ...cache,
    message: items.length
      ? `Cached ${items.length} review draft${items.length === 1 ? "" : "s"} for reload.`
      : "Review cache cleared."
  };
}

async function startYouTubeVideoRenderJob(payload = {}) {
  if (currentYouTubeVideoJob?.running) {
    return {
      ok: false,
      message: "A YouTube video batch is already rendering. Stop it before starting another.",
      job: await youtubeVideoRenderJobStatus()
    };
  }

  const paths = profilePaths(requestProfileId(payload));
  await mkdir(paths.runDir, { recursive: true });
  const sourceItems = Array.isArray(payload.items) ? payload.items : [];
  const count = clamp(Number(payload.count) || 3, 1, sourceItems.length ? 100 : 20);
  const fadeOutSeconds = clamp(Number(payload.fadeOutSeconds) || 8, 0, 30);
  const renderTimeoutSeconds = clamp(Number(payload.renderTimeoutSeconds) || 1800, 120, 7200);
  const cooldownDays = clamp(Number(payload.cooldownDays) || 120, 0, 1000);
  const renderPreset = payload.renderPreset || "balanced";
  const renderAlbumCompilation = Boolean(payload.renderAlbumCompilation);
  const testDurationSeconds = clamp(Number(payload.testDurationSeconds) || 0, 0, 180);
  const testRender = Boolean(payload.testRender);
  const id = `youtube-video-render-${fileStamp()}`;
  const progressPath = join(paths.runDir, `${id}-progress.json`);
  const stdoutPath = join(paths.runDir, `${id}-stdout.txt`);
  const stderrPath = join(paths.runDir, `${id}-stderr.txt`);
  const inputManifestPath = sourceItems.length ? join(paths.runDir, `${id}-approved-source.csv`) : "";
  if (sourceItems.length) {
    const resolvedItems = [];
    for (const item of sourceItems) {
      const source = await resolveProfileYouTubeSourceItem(item, paths);
      if (!source.ok) return source;
      resolvedItems.push(source.item);
    }
    await writeCsvRecords(inputManifestPath, ["Title", "Album", "ISRC", "Audio file or URL", "Artwork URL", "Caption", "Hashtags", "ScheduledFor"], resolvedItems.map((item) => ({
      Title: item.title || item.Title || "",
      Album: item.album || item.Album || "",
      ISRC: item.isrc || item.ISRC || "",
      "Audio file or URL": item.audio || item.Audio || "",
      "Artwork URL": item.artwork || item.Artwork || "",
      Caption: item.caption || item.Caption || "",
      Hashtags: item.hashtags || item.Hashtags || "",
      ScheduledFor: item.scheduledFor || item.ScheduledFor || ""
    })));
  }

  await writeProgress(progressPath, {
    stage: "starting",
    current: 0,
    total: renderAlbumCompilation && count >= 2 ? count + 1 : count,
    percent: 0,
    message: "Starting YouTube video render job..."
  });

  const child = spawn("powershell", [
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, "render-next-youtube-videos.ps1"),
    "-Count", String(count),
    "-FadeOutSeconds", String(fadeOutSeconds),
    "-RenderTimeoutSeconds", String(renderTimeoutSeconds),
    "-CooldownDays", String(cooldownDays),
    "-RenderPreset", renderPreset,
    "-CatalogPath", paths.catalogPath,
    "-LibraryConfigPath", paths.localLibraryPath,
    "-VisualAssetDir", paths.approvedVisualVideosDir,
    "-VisualSourceManifestPath", paths.approvedVisualSourcesPath,
    "-AlbumThemePath", paths.albumVisualThemesPath,
    "-UseAlbumAtmosphereVideo",
    ...(inputManifestPath ? ["-InputManifestPath", inputManifestPath] : []),
    ...(testDurationSeconds ? ["-TestDurationSeconds", String(testDurationSeconds)] : []),
    ...(testRender ? ["-TestRender"] : []),
    ...(renderAlbumCompilation ? ["-RenderAlbumCompilation"] : []),
    "-ProgressPath", progressPath
  ], {
    cwd: workspaceRoot,
    windowsHide: true
  });

  currentYouTubeVideoJob = {
    id,
    profileId: paths.id,
    running: true,
    startedAt: new Date().toISOString(),
    child,
    pid: child.pid,
    progressPath,
    stdoutPath,
    stderrPath,
    inputManifestPath,
    renderAlbumCompilation,
    testRender,
    stdout: "",
    stderr: "",
    result: null,
    error: null,
    cancelled: false
  };
  if (performancePreset?.ok) {
    currentRenderJob.performancePreset = performancePreset;
  }

  child.stdout.on("data", async (chunk) => {
    currentYouTubeVideoJob.stdout += chunk.toString();
    await writeFile(stdoutPath, currentYouTubeVideoJob.stdout, "utf8").catch(() => {});
  });

  child.stderr.on("data", async (chunk) => {
    currentYouTubeVideoJob.stderr += chunk.toString();
    await writeFile(stderrPath, currentYouTubeVideoJob.stderr, "utf8").catch(() => {});
  });

  child.on("close", async (code) => {
    if (!currentYouTubeVideoJob || currentYouTubeVideoJob.id !== id) return;
    currentYouTubeVideoJob.running = false;
    currentYouTubeVideoJob.finishedAt = new Date().toISOString();
    currentYouTubeVideoJob.exitCode = code;

    if (currentYouTubeVideoJob.cancelled) {
      currentYouTubeVideoJob.error = "YouTube video render stopped by user.";
      await writeProgress(progressPath, {
        stage: "cancelled",
        current: 0,
        total: count,
        percent: 0,
        message: "YouTube video render stopped."
      });
      return;
    }

    if (code !== 0) {
      currentYouTubeVideoJob.error = currentYouTubeVideoJob.stderr || `YouTube video render exited with code ${code}.`;
      await writeProgress(progressPath, {
        stage: "failed",
        current: 0,
        total: count,
        percent: 0,
        message: currentYouTubeVideoJob.error
      });
      return;
    }

    const manifest = matchLine(currentYouTubeVideoJob.stdout, /^Review manifest:\s*(.+)$/m);
    const batchFolder = matchLine(currentYouTubeVideoJob.stdout, /^Batch folder:\s*(.+)$/m);
    const manifestRecords = await readReviewManifestRecords(batchFolder).catch(() => []);
    const failedCount = manifestRecords.filter((item) => {
      const status = String(item.Status || item.status || "").toLowerCase();
      return ["render_failed", "failed", "error"].includes(status);
    }).length;
    const items = (await readReviewManifestItems(batchFolder).catch(() => [])).map((item) => ({
      ...item,
      profileSourceProfileId: paths.id,
      profileSourceLocked: true
    }));
    const playableCount = items.length;
    const noun = testRender ? "album-video test draft" : "YouTube video draft";
    const message = playableCount
      ? `Rendered ${playableCount} ${noun}${playableCount === 1 ? "" : "s"}${failedCount ? ` and skipped ${failedCount} failed item${failedCount === 1 ? "" : "s"}` : ""}.`
      : failedCount
      ? `Rendered 0 playable ${noun}${failedCount ? `; ${failedCount} item${failedCount === 1 ? "" : "s"} failed. Check the first failed row in the review manifest.` : "."}`
      : `Rendered 0 playable ${noun}s.`;
    currentYouTubeVideoJob.result = {
      ok: playableCount > 0,
      message,
      batchFolder,
      manifest,
      items,
      failedCount,
      output: currentYouTubeVideoJob.stdout.trim()
    };
    await writeProgress(progressPath, {
      stage: playableCount > 0 ? "complete" : "failed",
      current: playableCount,
      total: renderAlbumCompilation && count >= 2 ? count + 1 : count,
      percent: playableCount > 0 ? 100 : 0,
      message: playableCount > 0 ? "YouTube video render complete. Loaded into review." : message
    });
  });

  child.on("error", async (error) => {
    if (!currentYouTubeVideoJob || currentYouTubeVideoJob.id !== id) return;
    currentYouTubeVideoJob.running = false;
    currentYouTubeVideoJob.error = error.message;
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
    message: "YouTube video batch started.",
    id,
    status: await youtubeVideoRenderJobStatus()
  };
}

function stableId(value = "") {
  return createHash("sha1").update(String(value || "")).digest("hex").slice(0, 10);
}

function catalogRowToAlbumVideoItem(row = {}, index = 0) {
  const title = String(row.Title || row.title || `Track ${index + 1}`).trim();
  const album = String(row.Album || row.album || "Unknown album").trim();
  const isrc = String(row.ISRC || row.isrc || "").trim();
  const audio = String(row["Audio file or URL"] || row.Audio || row.audio || "").trim();
  const artwork = String(row["Artwork URL"] || row.Artwork || row.artwork || "").trim();
  return {
    id: `album-video::${stableId(`${album}|${title}|${isrc || audio || index}`)}`,
    status: "approved",
    title,
    album,
    isrc,
    audio,
    artwork,
    caption: "",
    hashtags: "#jazz #instrumentaljazz #backgroundmusic #coffeemusic",
    template: "youtube-full-track",
    destinations: {
      instagram: false,
      facebook: false,
      youtubeShorts: false,
      youtubeVideo: true
    }
  };
}

function trackTitleMatchesAudioFile(title = "", audioPath = "") {
  const titleKey = normalizeKey(title || "");
  const audioKey = normalizeKey(basename(String(audioPath || ""), extname(String(audioPath || "")))
    .replace(/^\d+\s+/, "")
    .replace(/^\d+\s*[-_.]\s*/, ""));
  if (!titleKey || !audioKey) return false;
  return titleKey === audioKey || audioKey.includes(titleKey) || titleKey.includes(audioKey);
}

async function findAlbumSourceFolder(album = "", paths = profilePaths(DEFAULT_PROFILE_ID), libraryConfig = {}) {
  const audioRoot = normalizeLocalFolderInput(libraryConfig.audioRoot || "") || "";
  const artworkRoot = normalizeLocalFolderInput(libraryConfig.artworkRoot || "") || audioRoot;
  if (!audioRoot || !existsSync(audioRoot)) return null;
  const topFolders = await scanTopAlbumFolders(audioRoot, artworkRoot).catch(() => []);
  const aliasMap = knownAlbumFolderAliases();
  const albumKey = compactKey(album);
  return topFolders.find((folder) => compactKey(aliasMap.get(folder.name) || folder.name) === albumKey) || null;
}

async function findTopAudioFolderForPath(audioPath = "", paths = profilePaths(DEFAULT_PROFILE_ID), libraryConfig = {}) {
  const audioRoot = normalizeLocalFolderInput(libraryConfig.audioRoot || "") || "";
  const resolvedAudio = resolveSafe(audioPath);
  if (!audioRoot || !resolvedAudio || !existsSync(audioRoot)) return null;
  const entries = await readdir(audioRoot, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = join(audioRoot, entry.name);
    if (isInsidePath(folderPath, resolvedAudio)) return { name: entry.name, path: folderPath };
  }
  return null;
}

async function validateAlbumVideoSourceRows(album = "", items = [], paths = profilePaths(DEFAULT_PROFILE_ID), libraryConfig = {}) {
  const albumFolder = await findAlbumSourceFolder(album, paths, libraryConfig);
  const issues = [];
  for (const item of items) {
    const audio = resolveSafe(item.audio || item.Audio || "");
    const artwork = resolveSafe(item.artwork || item.Artwork || "");
    const title = item.title || item.Title || "Untitled";
    if (isHardBannedSourceItem(item)) {
      issues.push(`${title}: track is hard-banned because the source audio is damaged or incorrect`);
      continue;
    }
    if (!profileMediaFileAllowed(audio, paths, libraryConfig, AUDIO_EXTENSIONS)) {
      issues.push(`${title}: audio is missing or outside this profile's library`);
      continue;
    }
    if (albumFolder && !isInsidePath(albumFolder.path, audio)) {
      issues.push(`${title}: audio points to ${basename(dirname(audio))}, not the album folder ${albumFolder.name}`);
      continue;
    }
    if (!albumFolder) {
      const sourceFolder = await findTopAudioFolderForPath(audio, paths, libraryConfig);
      if (sourceFolder && compactKey(sourceFolder.name) !== compactKey(album)) {
        issues.push(`${title}: audio points to another album folder (${sourceFolder.name})`);
        continue;
      }
    }
    if (!albumFolder && !trackTitleMatchesAudioFile(title, audio)) {
      issues.push(`${title}: audio file is "${basename(audio)}", which does not match the track title`);
      continue;
    }
    if (artwork && !/^https?:\/\//i.test(artwork) && profileMediaFileAllowed(artwork, paths, libraryConfig, IMAGE_EXTENSIONS) && albumFolder && !isInsidePath(albumFolder.path, artwork)) {
      issues.push(`${title}: artwork points outside the album folder ${albumFolder.name}`);
    }
  }

  return {
    ok: issues.length === 0,
    albumFolder: albumFolder?.path || "",
    issues
  };
}

async function listAlbumVideoAlbums(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const rows = await loadProfileCatalogRows(paths);
  const libraryConfig = await loadProfileLibraryConfig(paths);
  const ledger = await loadPublishLedger();
  const byAlbum = new Map();
  const titleToAlbum = new Map();
  const isrcToAlbum = new Map();

  for (const [index, row] of rows.entries()) {
    const item = catalogRowToAlbumVideoItem(row, index);
    const key = item.album || "Unknown album";
    const entry = byAlbum.get(key) || {
      album: key,
      trackCount: 0,
      localAudioCount: 0,
      localArtworkCount: 0,
      tracks: []
    };
    entry.trackCount += 1;
    const hasLocalAudio = profileMediaFileAllowed(item.audio, paths, libraryConfig, AUDIO_EXTENSIONS);
    if (hasLocalAudio) entry.localAudioCount += 1;
    const localArtwork = profileMediaFileAllowed(item.artwork, paths, libraryConfig, IMAGE_EXTENSIONS)
      ? item.artwork
      : await findLocalArtworkNearAudio(item.audio, paths, libraryConfig);
    if (localArtwork) entry.localArtworkCount += 1;
    if (localArtwork) item.artwork = localArtwork;
    entry.tracks.push(item);
    byAlbum.set(key, entry);
    if (item.title) titleToAlbum.set(normalizeKey(item.title), key);
    if (item.isrc) isrcToAlbum.set(normalizeKey(item.isrc), key);
  }

  const albums = [...byAlbum.values()].sort((a, b) => a.album.localeCompare(b.album));
  const albumPublished = new Map(albums.map((album) => [album.album, {
    youtubeVideoPublishedCount: 0,
    youtubeVideoPublishedLatestAt: "",
    youtubeVideoPublishedUrls: [],
    fullAlbumPublished: false
  }]));

  for (const entry of Object.values(ledger.items || {})) {
    if (String(entry.platform || "") !== "youtube-video") continue;
    const entryProfile = entry.profileId ? normalizeProfileId(entry.profileId) : paths.id;
    if (entryProfile !== paths.id) continue;

    const entryAlbumKey = normalizeKey(entry.album || "");
    let albumName = albums.find((album) => normalizeKey(album.album) === entryAlbumKey)?.album || "";
    if (!albumName && entry.isrc) albumName = isrcToAlbum.get(normalizeKey(entry.isrc)) || "";
    if (!albumName && entry.title) albumName = titleToAlbum.get(normalizeKey(entry.title)) || "";
    if (!albumName && entry.title) {
      const entryTitle = normalizeKey(entry.title);
      albumName = albums.find((album) => entryTitle.includes(normalizeKey(`${album.album} full album`)))?.album || "";
    }
    if (!albumName) continue;

    const current = albumPublished.get(albumName) || {
      youtubeVideoPublishedCount: 0,
      youtubeVideoPublishedLatestAt: "",
      youtubeVideoPublishedUrls: [],
      fullAlbumPublished: false
    };
    current.youtubeVideoPublishedCount += 1;
    current.youtubeVideoPublishedLatestAt = latestIso(current.youtubeVideoPublishedLatestAt, entry.publishedAt || "");
    if (entry.youtubeUrl && current.youtubeVideoPublishedUrls.length < 5) current.youtubeVideoPublishedUrls.push(entry.youtubeUrl);
    const template = normalizeKey(entry.template || "");
    const title = normalizeKey(entry.title || "");
    if (template === "youtube-full-album" || title.includes(normalizeKey(`${albumName} full album`))) {
      current.fullAlbumPublished = true;
    }
    albumPublished.set(albumName, current);
  }

  albums.forEach((album) => Object.assign(album, albumPublished.get(album.album) || {}));
  return {
    ok: true,
    profileId: paths.id,
    message: `Loaded ${albums.length} album${albums.length === 1 ? "" : "s"} from the active catalogue.`,
    albums
  };
}

async function startAlbumVideoRenderJob(payload = {}) {
  const album = String(payload.album || "").trim();
  if (!album) {
    return { ok: false, message: "Choose an album before rendering full-length videos." };
  }

  const paths = profilePaths(requestProfileId(payload));
  const rows = await loadProfileCatalogRows(paths);
  const albumRows = rows.filter((row) => String(row.Album || row.album || "").trim().toLowerCase() === album.toLowerCase());
  if (!albumRows.length) {
    return { ok: false, message: `No catalogue tracks found for ${album}. Run Setup > Scan library first.` };
  }

  const libraryConfig = await loadProfileLibraryConfig(paths);
  const items = albumRows
    .map(catalogRowToAlbumVideoItem)
    .filter((item) => profileMediaFileAllowed(item.audio, paths, libraryConfig, AUDIO_EXTENSIONS));

  if (!items.length) {
    return { ok: false, message: `No local audio files were found for ${album}.` };
  }

  const sourceCheck = await validateAlbumVideoSourceRows(album, items, paths, libraryConfig);
  if (!sourceCheck.ok) {
    return {
      ok: false,
      message: `Blocked album render for ${album}: the catalogue audio/artwork mapping looks wrong. Fix these rows in Setup > Scan library before rendering. First issues: ${sourceCheck.issues.slice(0, 5).join(" | ")}${sourceCheck.issues.length > 5 ? ` | and ${sourceCheck.issues.length - 5} more` : ""}`,
      issues: sourceCheck.issues,
      albumFolder: sourceCheck.albumFolder
    };
  }

  return startYouTubeVideoRenderJob({
    ...payload,
    profileId: paths.id,
    count: items.length,
    cooldownDays: 0,
    renderPreset: payload.renderPreset || "balanced",
    renderTimeoutSeconds: payload.renderTimeoutSeconds || 1800,
    fadeOutSeconds: payload.fadeOutSeconds || 8,
    renderAlbumCompilation: true,
    items
  });
}

async function startAlbumVideoTestRenderJob(payload = {}) {
  const album = String(payload.album || "").trim();
  if (!album) {
    return { ok: false, message: "Choose an album before creating a test video." };
  }

  const paths = profilePaths(requestProfileId(payload));
  const rows = await loadProfileCatalogRows(paths);
  const albumRows = rows.filter((row) => String(row.Album || row.album || "").trim().toLowerCase() === album.toLowerCase());
  if (!albumRows.length) {
    return { ok: false, message: `No catalogue tracks found for ${album}. Run Setup > Scan library first.` };
  }

  const libraryConfig = await loadProfileLibraryConfig(paths);
  const candidateItems = albumRows
    .map(catalogRowToAlbumVideoItem)
    .filter((item) => profileMediaFileAllowed(item.audio, paths, libraryConfig, AUDIO_EXTENSIONS));

  if (!candidateItems.length) {
    return { ok: false, message: `No local audio files were found for ${album}.` };
  }

  let selectedItem = null;
  const skippedIssues = [];
  for (const item of candidateItems) {
    const sourceCheck = await validateAlbumVideoSourceRows(album, [item], paths, libraryConfig);
    if (sourceCheck.ok && !isHardBannedSourceItem(item)) {
      selectedItem = item;
      break;
    }
    skippedIssues.push(...(sourceCheck.issues || []));
  }

  if (!selectedItem) {
    return {
      ok: false,
      message: `Could not create a test video for ${album}: every candidate track failed source checks. First issues: ${skippedIssues.slice(0, 5).join(" | ")}`,
      issues: skippedIssues
    };
  }

  return startYouTubeVideoRenderJob({
    ...payload,
    profileId: paths.id,
    count: 1,
    cooldownDays: 0,
    renderPreset: payload.renderPreset || "fast",
    renderTimeoutSeconds: payload.renderTimeoutSeconds || 600,
    fadeOutSeconds: payload.fadeOutSeconds || 4,
    testDurationSeconds: payload.testDurationSeconds || 30,
    testRender: true,
    renderAlbumCompilation: false,
    items: [selectedItem]
  });
}

async function uploadAlbumVideoItems(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const items = Array.isArray(payload.items)
    ? payload.items.map((item) => ({
        ...item,
        status: String(item.status || "").toLowerCase() === "posted" ? "posted" : "approved",
        destinations: {
          instagram: false,
          facebook: false,
          youtubeShorts: false,
          youtubeVideo: true
        },
        profileSourceProfileId: item.profileSourceProfileId || paths.id,
        profileSourceLocked: item.profileSourceLocked !== false
      }))
    : [];

  const uploadable = items.filter((item) => {
    const status = String(item.status || "").toLowerCase();
    const isTest = item.testRender === true || String(item.TestRender || item.testRender || "").toLowerCase() === "true" || status === "test";
    if (isTest) return false;
    return status !== "rejected" && status !== "posted";
  });

  if (!uploadable.length) {
    return { ok: false, message: "No approved album videos are ready to upload.", items };
  }

  const result = await publishDueYouTubeVideos(uploadable, {
    profileId: paths.id,
    privacy: payload.privacy || "public",
    resend: Boolean(payload.resend),
    ignoreDailyLimit: true
  });
  const merged = mergeUpdatedItems(items, result.items || []);
  return {
    ...result,
    profileId: paths.id,
    message: `Album video upload finished. Manual album uploads are not limited by the daily scheduler cap. ${result.message}`,
    items: merged
  };
}

function albumVideoRenderDir(paths = profilePaths(DEFAULT_PROFILE_ID)) {
  return join(paths.root, "rendered-youtube-videos");
}

function ffmpegConcatPath(value = "") {
  return String(value || "").replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function formatChapterTime(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function albumCompilationCaption(album = "Full Album", segments = []) {
  let offset = 0;
  const chapters = segments.map((segment) => {
    const line = `${formatChapterTime(offset)} ${segment.title || segment.Title || "Untitled track"}`;
    offset += Math.max(1, Math.floor(Number(segment.durationSeconds || segment.DurationSeconds || 0)));
    return line;
  });
  const description = [
    `${album} as one continuous full-album video from Maja's Coffee Jazz Zone.`,
    "A complete instrumental jazz listen for coffee shop ambience, focused work, reading, study, dinner service, and late-night background music.",
    chapters.length ? `Chapters:\n${chapters.join("\n")}` : "",
    "#coffeejazz #instrumentaljazz #fullalbum #relaxingjazz #backgroundmusic"
  ].filter(Boolean).join("\n\n");
  return appendYouTubeProfileLinks(description);
}

async function writeAlbumVideoManifest(batchDir, items = []) {
  const headers = [
    "Status", "Title", "Album", "ISRC", "Video", "Preview", "Audio", "Artwork", "Template", "ScheduledFor",
    "RenderPreset", "DurationSeconds", "FadeOutSeconds", "Caption", "Hashtags", "Error"
  ];
  await writeFile(join(batchDir, "review-manifest.json"), `${JSON.stringify(items, null, 2)}\n`, "utf8");
  await writeCsvRecords(join(batchDir, "review-manifest.csv"), headers, items.map((item) => ({
    Status: item.Status || item.status || "",
    Title: item.Title || item.title || "",
    Album: item.Album || item.album || "",
    ISRC: item.ISRC || item.isrc || "",
    Video: item.Video || item.video || "",
    Preview: item.Preview || item.preview || "",
    Audio: item.Audio || item.audio || "",
    Artwork: item.Artwork || item.artwork || "",
    Template: item.Template || item.template || "",
    ScheduledFor: item.ScheduledFor || item.scheduledFor || "",
    RenderPreset: item.RenderPreset || item.renderPreset || "",
    DurationSeconds: item.DurationSeconds || item.durationSeconds || "",
    FadeOutSeconds: item.FadeOutSeconds || item.fadeOutSeconds || "",
    Caption: item.Caption || item.caption || "",
    Hashtags: item.Hashtags || item.hashtags || "",
    Error: item.Error || item.error || ""
  })));
}

async function compileAlbumVideoItems(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const rawItems = Array.isArray(payload.items) && payload.items.length === 1 && Array.isArray(payload.items[0]?.value)
    ? payload.items[0].value
    : Array.isArray(payload.items)
    ? payload.items
    : Array.isArray(payload.items?.value)
      ? payload.items.value
      : [];
  const segments = rawItems
    .filter((item) => String(item.template || item.Template || "").toLowerCase() === "youtube-full-track")
    .filter((item) => !["rejected", "render_failed", "failed", "error"].includes(String(item.status || item.Status || "").toLowerCase()))
    .map((item) => ({ ...item, video: String(item.video || item.Video || "").trim() }))
    .filter((item) => item.video && /\.mp4$/i.test(item.video) && existsSync(resolve(item.video)))
    .sort((a, b) => {
      const left = Number(a.trackNumber || a.TrackNumber || a.track || a.Track || 0);
      const right = Number(b.trackNumber || b.TrackNumber || b.track || b.Track || 0);
      return (left || 9999) - (right || 9999);
    });

  if (segments.length < 2) {
    return {
      ok: false,
      message: "Need at least two rendered full-track videos in the Album Videos review list before creating a full album video.",
      items: rawItems
    };
  }

  const album = String(payload.album || segments[0].album || segments[0].Album || "Full Album").trim();
  const albumSegments = segments.filter((item) => String(item.album || item.Album || "").trim().toLowerCase() === album.toLowerCase());
  const selectedSegments = albumSegments.length >= 2 ? albumSegments : segments;
  const firstDir = dirname(resolve(selectedSegments[0].video));
  const renderedDir = albumVideoRenderDir(paths);
  const batchDir = isInsidePath(renderedDir, firstDir) ? firstDir : join(renderedDir, `batch-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`);
  await mkdir(batchDir, { recursive: true });

  const slug = safeFileSlug(`${album} full album`);
  const videoPath = join(batchDir, `00-${slug}-youtube-album.mp4`);
  const previewPath = join(batchDir, `00-${slug}-youtube-album-preview.jpg`);
  const concatPath = join(batchDir, `00-${slug}-concat.txt`);
  const concatText = selectedSegments.map((item) => `file '${ffmpegConcatPath(resolve(item.video))}'`).join("\n");
  await writeFile(concatPath, `${concatText}\n`, "utf8");

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0",
      "-i", concatPath,
      "-c", "copy",
      videoPath
    ], { timeout: 2 * 60 * 60 * 1000, maxBuffer: 1024 * 1024 * 8 });
  } catch (error) {
    await rm(videoPath, { force: true }).catch(() => {});
    return {
      ok: false,
      message: `Could not create the full album video: ${error.stderr || error.message || "ffmpeg concat failed"}`,
      items: rawItems
    };
  }

  if (!existsSync(videoPath) || (await stat(videoPath)).size <= 0) {
    return { ok: false, message: "Could not create the full album video: output MP4 was missing or empty.", items: rawItems };
  }

  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", videoPath,
    "-ss", "00:00:05",
    "-frames:v", "1",
    "-update", "1",
    previewPath
  ], { timeout: 60000, maxBuffer: 1024 * 1024 }).catch(() => {});

  const durationSeconds = selectedSegments.reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item.durationSeconds || item.DurationSeconds || 0))), 0);
  const compilation = {
    id: `album-video::${stableId(`${paths.id}|${album}|full-album|${videoPath}`)}`,
    status: "draft",
    title: `${album} - Full Album`,
    album,
    isrc: "",
    video: resolve(videoPath),
    preview: existsSync(previewPath) ? resolve(previewPath) : "",
    audio: "",
    artwork: selectedSegments[0].artwork || selectedSegments[0].Artwork || "",
    template: "youtube-full-album",
    scheduledFor: "",
    renderPreset: "compiled",
    durationSeconds,
    fadeOutSeconds: 0,
    caption: albumCompilationCaption(album, selectedSegments),
    hashtags: "#jazz #fullalbum #instrumentaljazz #backgroundmusic #coffeemusic",
    error: "",
    destinations: {
      instagram: false,
      facebook: false,
      youtubeShorts: false,
      youtubeVideo: true
    },
    profileSourceProfileId: paths.id,
    profileSourceLocked: true
  };

  const items = [
    ...rawItems.filter((item) => {
      const sameTemplate = String(item.template || item.Template || "").toLowerCase() === "youtube-full-album";
      const sameAlbum = String(item.album || item.Album || "").trim().toLowerCase() === album.toLowerCase();
      return !(sameTemplate && sameAlbum);
    }),
    compilation
  ];
  await writeAlbumVideoManifest(batchDir, items);

  return {
    ok: true,
    profileId: paths.id,
    message: `Created one full album video for ${album}. Approve it, then click Upload approved videos.`,
    item: compilation,
    items
  };
}

function collectItemMediaPaths(items = []) {
  const values = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    [
      item.video,
      item.Video,
      item.preview,
      item.Preview
    ].filter(Boolean).forEach((value) => {
      const resolved = resolveSafe(value);
      if (resolved && existsSync(resolved)) values.add(resolved);
    });
  }
  return [...values];
}

function hasProtectedPathInside(candidatePath = "", protectedPaths = []) {
  return protectedPaths.some((protectedPath) => (
    protectedPath
    && existsSync(protectedPath)
    && (resolve(candidatePath) === resolve(protectedPath) || isInsidePath(candidatePath, protectedPath))
  ));
}

async function cleanupPartialAlbumVideoRenders(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  if (currentYouTubeVideoJob?.running && currentYouTubeVideoJob.profileId === paths.id) {
    return {
      ok: false,
      message: "An album/full-video render is still running. Stop it or wait for it to finish before cleaning partial renders."
    };
  }

  const apply = Boolean(payload.apply);
  const renderedDir = albumVideoRenderDir(paths);
  const protectedPaths = collectItemMediaPaths(payload.items);
  if (!existsSync(renderedDir)) {
    return {
      ok: true,
      applied: apply,
      message: "No album-video render folder exists yet.",
      totalCandidates: 0,
      totalBytes: 0,
      deletedCount: 0,
      deletedBytes: 0,
      items: []
    };
  }

  const entries = await readdir(renderedDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("batch-")) continue;
    const batchPath = join(renderedDir, entry.name);
    const info = await stat(batchPath).catch(() => null);
    if (!info) continue;
    const tooFresh = Date.now() - info.mtimeMs < 5 * 60 * 1000;
    const protectedByVisibleReview = hasProtectedPathInside(batchPath, protectedPaths);
    if (tooFresh || protectedByVisibleReview) continue;

    const manifestPath = join(batchPath, "review-manifest.json");
    const hasManifest = existsSync(manifestPath);
    const records = hasManifest ? await readReviewManifestRecords(batchPath).catch(() => []) : [];
    const playable = filterPlayableReviewItems(records);
    const failedAlbumCompilation = records.some((record) => (
      String(record.Template || record.template || "").toLowerCase() === "youtube-full-album"
      && ["render_failed", "failed", "error"].includes(String(record.Status || record.status || "").toLowerCase())
    ));
    const failedOnly = records.length > 0 && playable.length === 0;
    const incomplete = !hasManifest || failedOnly || failedAlbumCompilation;
    if (!incomplete) continue;

    const reason = !hasManifest
      ? "No completed review manifest"
      : failedAlbumCompilation
        ? "Full album compilation failed"
        : "No playable videos in manifest";
    const bytes = await pathSize(batchPath);
    const item = {
      name: entry.name,
      path: batchPath,
      relativePath: relative(paths.root, batchPath),
      modifiedAt: info.mtime.toISOString(),
      bytes,
      reason,
      deleted: false
    };
    if (apply && isInsidePath(renderedDir, batchPath)) {
      await rm(batchPath, { recursive: true, force: true });
      item.deleted = true;
    }
    candidates.push(item);
  }

  const deleted = candidates.filter((item) => item.deleted);
  const totalBytes = candidates.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  const deletedBytes = deleted.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  return {
    ok: true,
    profileId: paths.id,
    applied: apply,
    message: apply
      ? `Cleaned ${deleted.length} incomplete album render batch${deleted.length === 1 ? "" : "es"} and freed ${formatBytes(deletedBytes)}.`
      : `${candidates.length} incomplete album render batch${candidates.length === 1 ? "" : "es"} can be cleaned, about ${formatBytes(totalBytes)}.`,
    totalCandidates: candidates.length,
    totalBytes,
    deletedCount: deleted.length,
    deletedBytes,
    items: candidates
  };
}

async function youtubeVideoRenderJobStatus() {
  if (!currentYouTubeVideoJob) {
    return {
      ok: true,
      running: false,
      progress: {
        stage: "idle",
        current: 0,
        total: 0,
        percent: 0,
        message: "No YouTube video render job is running."
      }
    };
  }

  const progress = await readProgress(currentYouTubeVideoJob.progressPath, "Rendering YouTube videos...");
  return {
    ok: true,
    id: currentYouTubeVideoJob.id,
    running: currentYouTubeVideoJob.running,
    startedAt: currentYouTubeVideoJob.startedAt,
    finishedAt: currentYouTubeVideoJob.finishedAt || "",
    cancelled: Boolean(currentYouTubeVideoJob.cancelled),
    error: currentYouTubeVideoJob.error || "",
    result: currentYouTubeVideoJob.result,
    progress
  };
}

async function cancelYouTubeVideoRenderJob() {
  if (!currentYouTubeVideoJob?.running) {
    return { ok: true, message: "No YouTube video render job is running.", status: await youtubeVideoRenderJobStatus() };
  }

  currentYouTubeVideoJob.cancelled = true;
  const pid = currentYouTubeVideoJob.pid;
  if (pid) {
    await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]).catch(() => {
      currentYouTubeVideoJob.child.kill("SIGTERM");
    });
  } else {
    currentYouTubeVideoJob.child.kill("SIGTERM");
  }

  await writeProgress(currentYouTubeVideoJob.progressPath, {
    stage: "cancelled",
    current: 0,
    total: 0,
    percent: 0,
    message: "Stopping YouTube video render job..."
  });

  return { ok: true, message: "Stopping YouTube video render job.", status: await youtubeVideoRenderJobStatus() };
}

async function latestYouTubeVideoBatch() {
  const manifests = await reviewManifestsIn(join(schedulerDir, "rendered-youtube-videos"));
  if (!manifests.length) {
    return { ok: false, message: "No YouTube video batch folders found." };
  }

  for (const manifestPath of manifests) {
    const batchFolder = dirname(manifestPath);
    const items = filterSuppressedPublishingItems(await readReviewManifestItems(batchFolder));
    if (!items.length) continue;

    return {
      ok: true,
      message: `Loaded ${items.length} YouTube video item${items.length === 1 ? "" : "s"} from the latest usable batch.`,
      batchFolder,
      manifest: manifestPath,
      items
    };
  }

  return { ok: false, message: "Latest YouTube video batches only contain suppressed or unavailable items." };
}

async function pickFolder(payload = {}) {
  const title = String(payload.title || "Select folder").replace(/'/g, "''");
  const initialPath = normalizeLocalFolderInput(payload.initialPath || payload.path || "");
  const initialDirectory = initialPath && existsSync(initialPath)
    ? initialPath.replace(/'/g, "''")
    : "";
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.StartPosition = 'CenterScreen'
$owner.Size = New-Object System.Drawing.Size(1, 1)
$owner.ShowInTaskbar = $false
$owner.TopMost = $true
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '${title}'
$dialog.CheckFileExists = $false
$dialog.CheckPathExists = $true
$dialog.ValidateNames = $false
$dialog.FileName = 'Select this folder'
$dialog.Filter = 'Folders|*.folder'
$dialog.RestoreDirectory = $true
${initialDirectory ? `$dialog.InitialDirectory = '${initialDirectory}'` : ""}
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    $selected = Split-Path -Parent $dialog.FileName
    if ($selected) { Write-Output $selected }
  }
} finally {
  $owner.Close()
  $owner.Dispose()
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
  const paths = profilePaths(requestProfileId(payload));
  const rawAudioRoot = String(payload.audioRoot || "").trim();
  const rawArtworkRoot = String(payload.artworkRoot || "").trim();
  if (isRemoteFolderUrl(rawAudioRoot) || isRemoteFolderUrl(rawArtworkRoot)) {
    return { ok: false, message: "Online folder URLs cannot be scanned directly yet. Paste a local Windows folder path or a file:/// folder link." };
  }
  const audioRoot = normalizeLocalFolderInput(rawAudioRoot);
  const artworkRoot = normalizeLocalFolderInput(rawArtworkRoot);
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
    catalogPath = paths.catalogPath;
    await mkdir(dirname(catalogPath), { recursive: true });
    await writeCatalogCsv(catalogPath, items);
    await mkdir(dirname(paths.localLibraryPath), { recursive: true });
    await writeFile(paths.localLibraryPath, JSON.stringify({
      savedAt: new Date().toISOString(),
      profileId: paths.id,
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
    profileId: paths.id,
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

async function mergeFolderAlbumsIntoCatalog(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const userConfig = await loadUserConfig();
  const setupWizard = userConfig.profileConfigs?.[paths.id]?.setupWizard || userConfig.setupWizard || {};
  const rawAudioRoot = String(payload.audioRoot || setupWizard.audioRoot || "").trim();
  const rawArtworkRoot = String(payload.artworkRoot || setupWizard.artworkRoot || "").trim();
  if (isRemoteFolderUrl(rawAudioRoot) || isRemoteFolderUrl(rawArtworkRoot)) {
    return { ok: false, message: "Online folder URLs cannot be merged directly yet. Paste a local Windows folder path or a file:/// folder link." };
  }
  const audioRoot = normalizeLocalFolderInput(rawAudioRoot)
    || (existsSync(DEFAULT_AUDIO_ROOT) ? DEFAULT_AUDIO_ROOT : "");
  const artworkRoot = normalizeLocalFolderInput(rawArtworkRoot);
  const artistName = String(payload.artistName || setupWizard.artistName || "Maja's Coffee Jazz Zone").trim() || "Maja's Coffee Jazz Zone";
  const catalogPath = paths.catalogPath;

  if (!audioRoot || !existsSync(audioRoot)) {
    return { ok: false, message: "Choose a valid audio folder before merging folder albums." };
  }
  if (!existsSync(catalogPath)) {
    return { ok: false, message: "Renderer catalogue was not found. Run Setup scan first.", catalogPath };
  }

  const originalText = (await readFile(catalogPath, "utf8")).replace(/^\uFEFF/, "");
  const parsed = parseCsvRecords(originalText);
  if (!parsed.headers.length) {
    return { ok: false, message: "Catalogue could not be read." };
  }

  const rows = parsed.rows;
  const headers = ensureCatalogHeaders(parsed.headers);
  const topFolders = await scanTopAlbumFolders(audioRoot, artworkRoot);
  const existingAlbums = [...new Set(rows.map((row) => row.Album).filter(Boolean))];
  const aliasMap = knownAlbumFolderAliases();
  const matchedFolders = new Map();
  const matchedAlbums = new Set();

  for (const folder of topFolders) {
    const mapped = aliasMap.get(folder.name) || findMatchingCatalogAlbum(folder.name, existingAlbums);
    if (mapped) {
      matchedFolders.set(folder.name, mapped);
      matchedAlbums.add(mapped);
    }
  }

  const existingAudio = new Set(rows.map((row) => resolveSafe(row["Audio file or URL"])).filter(Boolean));
  const existingIsrc = new Set(rows.map((row) => String(row.ISRC || "").trim()).filter(Boolean));
  const addedRows = [];
  const skippedFolders = [];

  for (const folder of topFolders) {
    if (matchedFolders.has(folder.name)) continue;
    if (!folder.audioFiles.length) {
      skippedFolders.push({ album: folder.name, reason: "No audio files found." });
      continue;
    }

    const artwork = folder.artworkFiles[0] || "";
    const sortedAudio = [...folder.audioFiles].sort((a, b) => a.localeCompare(b));
    sortedAudio.forEach((audioPath, index) => {
      const resolvedAudio = resolveSafe(audioPath);
      if (existingAudio.has(resolvedAudio)) return;
      const syntheticIsrc = `LOCAL-${normalizeKey(folder.name).replace(/\s+/g, "-")}-${String(index + 1).padStart(2, "0")}`.toUpperCase();
      const isrc = existingIsrc.has(syntheticIsrc) ? "" : syntheticIsrc;
      existingAudio.add(resolvedAudio);
      if (isrc) existingIsrc.add(isrc);
      addedRows.push({
        Title: cleanTitle(basename(audioPath, extname(audioPath))).replace(/^\d+\s+/, ""),
        Artist: artistName,
        Album: folder.name,
        "Artwork URL": artwork,
        "Audio file or URL": audioPath,
        "Store URL": "",
        Mood: "",
        BPM: "",
        ISRC: isrc,
        UPC: "",
        "Release Date": "",
        Year: "",
        Label: "",
        "Track Number": String(index + 1),
        "Spotify Artist URL": "",
        "SoundCloud URL": "",
        "Audio Match Score": "1",
        "Audio Match Method": "folder-catalog-merge"
      });
    });
  }

  if (!addedRows.length) {
    return {
      ok: true,
      profileId: paths.id,
      message: "No missing folder albums needed adding. Catalogue already covers the scanned album folders.",
      catalogPath,
      audioRoot,
      scannedFolderCount: topFolders.length,
      existingAlbumCount: existingAlbums.length,
      addedAlbumCount: 0,
      addedTrackCount: 0,
      addedAlbums: [],
      matchedFolders: [...matchedFolders.entries()].map(([folder, album]) => ({ folder, album })),
      skippedFolders
    };
  }

  const stamp = fileStamp();
  const backupPath = join(dirname(catalogPath), `catalog-with-files.backup-${stamp}.csv`);
  await mkdir(dirname(backupPath), { recursive: true });
  await writeFile(backupPath, originalText, "utf8");

  const mergedRows = [...rows, ...addedRows];
  await writeCsvRecords(catalogPath, headers, mergedRows);

  const addedAlbums = summarizeAddedAlbums(addedRows);
  const report = {
    mergedAt: new Date().toISOString(),
    catalogPath,
    backupPath,
    audioRoot,
    artworkRoot,
    scannedFolderCount: topFolders.length,
    previousAlbumCount: existingAlbums.length,
    newAlbumCount: new Set(mergedRows.map((row) => row.Album).filter(Boolean)).size,
    addedAlbumCount: addedAlbums.length,
    addedTrackCount: addedRows.length,
    addedAlbums,
    matchedFolders: [...matchedFolders.entries()].map(([folder, album]) => ({ folder, album })),
    skippedFolders
  };
  const reportPath = join(paths.runDir, `catalog-folder-merge-${stamp}.json`);
  await mkdir(paths.runDir, { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  return {
    ok: true,
    profileId: paths.id,
    message: `Added ${addedRows.length} track${addedRows.length === 1 ? "" : "s"} from ${addedAlbums.length} missing album folder${addedAlbums.length === 1 ? "" : "s"}.`,
    ...report,
    reportPath
  };
}

function songFactoryTextTokens(...values) {
  const stop = new Set(["album", "track", "music", "jazz", "coffee", "instrumental", "prompt", "style", "mood", "scene", "target", "length", "clean", "warm"]);
  const output = [];
  const seen = new Set();
  values.join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 3 && !stop.has(token))
    .forEach((token) => {
      if (seen.has(token)) return;
      seen.add(token);
      output.push(token);
    });
  return output.slice(0, 18);
}

function songFactoryThemeRecord(plan = {}) {
  const settings = plan.settings || {};
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  const moods = [...new Set([
    settings.mood,
    ...tracks.map((track) => track.mood)
  ].filter(Boolean).flatMap((value) => String(value).split(/\s*,\s*/)).map((value) => value.trim()).filter(Boolean))].slice(0, 8);
  const scenes = [...new Set(tracks.map((track) => track.scene).filter(Boolean))].slice(0, 5);
  const style = settings.style || tracks.find((track) => track.style)?.style || "Instrumental jazz";
  const instruments = settings.instruments || tracks.find((track) => track.instruments)?.instruments || "";
  const searchTerms = [
    ...scenes,
    ...songFactoryTextTokens(settings.albumTitle, settings.brief, settings.mood, style, instruments, plan.albumPrompt)
  ].slice(0, 12);
  return {
    Album: settings.albumTitle || "Untitled album",
    Mood: moods.join(", ") || settings.mood || "",
    Theme: settings.brief ? firstCaptionLine(settings.brief).slice(0, 180) : `${style} album generated in Song Factory`,
    Style: style,
    Scene: scenes[0] || settings.mood || "",
    Instruments: instruments,
    SearchTerms: searchTerms.join(" | "),
    NegativeTerms: "text, logo, watermark, people close-up, low quality, blurry",
    Notes: `Generated from Song Factory on ${new Date().toISOString()}.`
  };
}

function decodeArtworkUpload(upload = {}, fallbackName = "cover") {
  const dataUrl = String(upload.dataUrl || upload.data || "").trim();
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mime = match ? match[1] : String(upload.mimeType || "");
  const base64 = match ? match[2] : dataUrl;
  const extension = mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : ".jpg";
  return {
    buffer: Buffer.from(base64, "base64"),
    filename: `${safeFileSlug(upload.name || fallbackName)}${extension}`,
    extension
  };
}

async function convertSongFactoryArtworkToJpeg({ albumDir, albumTitle, upload, sourcePath }) {
  const source = normalizeLocalFolderInput(sourcePath || "");
  const outputPath = join(albumDir, `${safeTrackFileBaseName(albumTitle, "Cover")}.jpg`);
  const tempInputPath = upload?.buffer?.length
    ? join(albumDir, `.song-factory-artwork-source-${Date.now()}-${Math.random().toString(16).slice(2)}${upload.extension || ".img"}`)
    : "";
  const inputPath = tempInputPath || source;
  const tempOutputPath = join(albumDir, `.song-factory-cover-${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`);
  if (tempInputPath) {
    await writeFile(tempInputPath, upload.buffer);
  }
  if (!inputPath || !existsSync(inputPath)) {
    await rm(tempInputPath, { force: true }).catch(() => {});
    return "";
  }

  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", inputPath,
      "-vf", "scale=3000:3000:force_original_aspect_ratio=increase,crop=3000:3000,setsar=1,format=yuvj420p",
      "-frames:v", "1",
      "-q:v", "2",
      tempOutputPath
    ], { windowsHide: true, maxBuffer: 1024 * 1024 * 4 });
    await rm(outputPath, { force: true }).catch(() => {});
    await rename(tempOutputPath, outputPath);
    return outputPath;
  } catch (error) {
    await rm(tempOutputPath, { force: true }).catch(() => {});
    const detail = String(error?.stderr || error?.message || error || "ffmpeg artwork conversion failed").trim();
    throw new Error(`Could not convert artwork to 3000x3000 JPEG: ${detail.slice(0, 600)}`);
  } finally {
    await rm(tempInputPath, { force: true }).catch(() => {});
  }
}

async function convertSongFactoryArtworkUtility(payload = {}) {
  const outputFolder = normalizeLocalFolderInput(payload.outputFolder || payload.folder || payload.outputDir || "");
  const albumTitle = String(payload.albumTitle || payload.title || "Converted Artwork").trim() || "Converted Artwork";
  const artworkUpload = decodeArtworkUpload(payload.artworkUpload || payload.upload || {}, `${safeFileSlug(albumTitle)}-artwork`);
  const sourcePath = normalizeLocalFolderInput(payload.sourcePath || payload.artworkPath || "");

  if (!outputFolder) {
    return { ok: false, message: "Choose an output folder for the converted artwork first." };
  }
  await mkdir(outputFolder, { recursive: true });
  if (!artworkUpload && (!sourcePath || !existsSync(sourcePath))) {
    return { ok: false, message: "Choose an artwork image to convert first." };
  }

  const artworkPath = await convertSongFactoryArtworkToJpeg({
    albumDir: outputFolder,
    albumTitle,
    upload: artworkUpload,
    sourcePath
  });

  return {
    ok: Boolean(artworkPath),
    message: artworkPath
      ? `Converted artwork to 3000x3000 JPG: ${artworkPath}`
      : "Artwork conversion did not create a file.",
    artworkPath,
    outputFolder,
    format: "JPEG 3000x3000"
  };
}

async function saveSongFactoryCompletedAlbum(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const plan = payload.plan || {};
  const settings = plan.settings || {};
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  const albumTitle = String(settings.albumTitle || payload.albumTitle || "").trim();
  if (!albumTitle || !tracks.length) {
    return { ok: false, message: "Generate a Song Factory plan with an album title and tracks before saving it as a completed album." };
  }

  const artist = String(settings.artist || payload.artist || "Maja's Coffee Jazz Zone").trim() || "Maja's Coffee Jazz Zone";
  const albumSlug = safeFileSlug(albumTitle);
  const generatedRoot = join(paths.root, "generated-albums");
  const albumDir = join(generatedRoot, albumSlug);
  const audioDir = join(albumDir, "audio");
  await mkdir(audioDir, { recursive: true });

  let artworkPath = "";
  const artworkUpload = decodeArtworkUpload(payload.artworkUpload, `${albumSlug}-cover`);
  if (artworkUpload?.buffer?.length) {
    artworkPath = await convertSongFactoryArtworkToJpeg({ albumDir, albumTitle, upload: artworkUpload });
  } else if (payload.artworkPath) {
    artworkPath = await convertSongFactoryArtworkToJpeg({ albumDir, albumTitle, sourcePath: payload.artworkPath });
  }

  await writeFile(join(albumDir, "song-factory-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  await writeFile(join(albumDir, "tracklist.txt"), `${tracks.map((track) => track.title).filter(Boolean).join("\r\n")}\r\n`, "utf8");
  await writeFile(join(albumDir, "prompts.txt"), `${String(payload.promptsText || "").trim()}\r\n`, "utf8");

  await mkdir(dirname(paths.catalogPath), { recursive: true });
  const parsed = existsSync(paths.catalogPath)
    ? parseCsvRecords((await readFile(paths.catalogPath, "utf8")).replace(/^\uFEFF/, ""))
    : { headers: [], rows: [] };
  const headers = ensureCatalogHeaders(parsed.headers);
  const rows = parsed.rows.filter((row) => normalizeKey(row.Album) !== normalizeKey(albumTitle));
  const newRows = tracks.map((track, index) => {
    const trackTitle = String(track.title || `Track ${index + 1}`).trim();
    const expectedAudioPath = join(audioDir, `${safeTrackFileBaseName(trackTitle, `Track ${index + 1}`)}.mp3`);
    return {
      Title: trackTitle,
      Artist: artist,
      Album: albumTitle,
      "Artwork URL": artworkPath,
      "Audio file or URL": expectedAudioPath,
      "Store URL": "",
      Mood: String(track.mood || settings.mood || "").trim(),
      BPM: "",
      ISRC: "",
      UPC: "",
      "Release Date": "",
      Year: "",
      Label: "Song Factory",
      "Track Number": String(track.number || index + 1),
      "Spotify Artist URL": "",
      "SoundCloud URL": "",
      "Audio Match Score": "",
      "Audio Match Method": "song-factory-planned",
      Style: String(track.style || settings.style || "").trim(),
      Instruments: String(track.instruments || settings.instruments || "").trim(),
      Scene: String(track.scene || "").trim(),
      Energy: String(track.energy || settings.energy || "").trim(),
      "Length Target": String(track.length || settings.length || "").trim(),
      "Album Prompt": String(plan.albumPrompt || "").trim(),
      "Track Prompt": String(track.trackPrompt || "").trim(),
      "Suno Prompt": String(track.sunoPrompt || "").trim(),
      "Negative Prompt": String(track.negativePrompt || "").trim(),
      Hashtags: String(track.hashtags || "").trim()
    };
  });
  await writeCsvRecords(paths.catalogPath, headers, [...rows, ...newRows]);

  await ensureAlbumVisualThemesCsv(paths);
  const themeParsed = existsSync(paths.albumVisualThemesPath)
    ? parseCsvRecords((await readFile(paths.albumVisualThemesPath, "utf8")).replace(/^\uFEFF/, ""))
    : { headers: ["Album", "Mood", "Theme", "Style", "Scene", "Instruments", "SearchTerms", "NegativeTerms", "Notes"], rows: [] };
  const themeHeaders = ["Album", "Mood", "Theme", "Style", "Scene", "Instruments", "SearchTerms", "NegativeTerms", "Notes"];
  const themeRows = themeParsed.rows.filter((row) => normalizeKey(row.Album) !== normalizeKey(albumTitle));
  const themeRecord = songFactoryThemeRecord(plan);
  await writeCsvRecords(paths.albumVisualThemesPath, themeHeaders, [...themeRows, themeRecord]);

  return {
    ok: true,
    message: `Saved ${albumTitle} into catalogue and visual themes. Artwork is saved as 3000x3000 JPEG. Drop final MP3s into the audio folder using the expected filenames.`,
    albumTitle,
    albumDir,
    audioDir,
    artworkPath,
    artworkFormat: artworkPath ? "JPEG 3000x3000" : "",
    catalogPath: paths.catalogPath,
    albumThemePath: paths.albumVisualThemesPath,
    trackCount: newRows.length,
    expectedAudioFiles: newRows.map((row) => ({ title: row.Title, path: row["Audio file or URL"] }))
  };
}

async function renameSongFactoryAudioFiles(payload = {}) {
  const plan = payload.plan || {};
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  const sourceFolder = normalizeLocalFolderInput(payload.folder || payload.audioFolder || payload.audioDir || "");
  if (!tracks.length) {
    return { ok: false, message: "Generate or recall a Song Factory plan before renaming MP3 files." };
  }
  if (!sourceFolder || !existsSync(sourceFolder)) {
    return { ok: false, message: "Choose the folder containing the downloaded MP3 files first." };
  }

  const entries = await readdir(sourceFolder, { withFileTypes: true });
  const audioFiles = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!AUDIO_EXTENSIONS.has(extension)) continue;
    const path = join(sourceFolder, entry.name);
    const info = await stat(path);
    audioFiles.push({ path, name: entry.name, extension, mtimeMs: info.mtimeMs, birthtimeMs: info.birthtimeMs || info.ctimeMs || info.mtimeMs });
  }
  audioFiles.sort((a, b) => (a.birthtimeMs - b.birthtimeMs) || (a.mtimeMs - b.mtimeMs) || a.name.localeCompare(b.name));
  if (!audioFiles.length) {
    return { ok: false, message: "No audio files were found in that folder." };
  }

  const count = Math.min(audioFiles.length, tracks.length);
  const operations = [];
  for (let index = 0; index < count; index += 1) {
    const file = audioFiles[index];
    const title = String(tracks[index].title || `Track ${index + 1}`).trim();
    const targetName = `${safeTrackFileBaseName(title, `Track ${index + 1}`)}${file.extension || ".mp3"}`;
    const targetPath = join(sourceFolder, targetName);
    operations.push({ from: file.path, to: targetPath, title, skipped: file.path === targetPath });
  }

  const conflicts = operations.filter((op) => !op.skipped && existsSync(op.to) && !operations.some((other) => other.from === op.to));
  if (conflicts.length) {
    return {
      ok: false,
      message: `Cannot rename because ${conflicts.length} target filename already exists. Move or rename those files first.`,
      conflicts
    };
  }

  const tempOperations = [];
  try {
    for (const op of operations.filter((item) => !item.skipped)) {
      const tempPath = join(sourceFolder, `.song-factory-rename-${Date.now()}-${Math.random().toString(16).slice(2)}${extname(op.from)}`);
      await rename(op.from, tempPath);
      tempOperations.push({ ...op, tempPath });
    }
    for (const op of tempOperations) {
      await rename(op.tempPath, op.to);
    }
  } catch (error) {
    for (const op of tempOperations) {
      if (existsSync(op.tempPath) && !existsSync(op.from)) {
        await rename(op.tempPath, op.from).catch(() => {});
      }
    }
    return {
      ok: false,
      message: isLockedFileError(error)
        ? lockedFileMessage("rename")
        : `Could not rename audio files: ${String(error?.message || error || "Unknown rename error")}`,
      code: error?.code || "",
      lockedFile: isLockedFileError(error)
    };
  }

  return {
    ok: true,
    message: `Renamed ${tempOperations.length} audio file${tempOperations.length === 1 ? "" : "s"} from the Song Factory tracklist.`,
    folder: sourceFolder,
    renamed: tempOperations.map((op) => ({ title: op.title, from: op.from, to: op.to })),
    skippedAlreadyNamed: operations.filter((op) => op.skipped).length,
    extraAudioFiles: Math.max(0, audioFiles.length - tracks.length),
    missingAudioFiles: Math.max(0, tracks.length - audioFiles.length)
  };
}

async function listSongFactoryAudioFiles(sourceFolder, extensions = SONG_FACTORY_CONVERT_EXTENSIONS) {
  const entries = await readdir(sourceFolder, { withFileTypes: true });
  const audioFiles = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".song-factory-")) continue;
    const extension = extname(entry.name).toLowerCase();
    if (!extensions.has(extension)) continue;
    const filePath = join(sourceFolder, entry.name);
    const info = await stat(filePath);
    audioFiles.push({
      path: filePath,
      name: entry.name,
      extension,
      mtimeMs: info.mtimeMs,
      birthtimeMs: info.birthtimeMs || info.ctimeMs || info.mtimeMs
    });
  }
  audioFiles.sort((a, b) => (a.birthtimeMs - b.birthtimeMs) || (a.mtimeMs - b.mtimeMs) || a.name.localeCompare(b.name));
  return audioFiles;
}

function isLockedFileError(error) {
  return ["EBUSY", "EPERM", "EACCES"].includes(String(error?.code || "").toUpperCase())
    || /resource busy|being used by another process|access is denied|permission denied/i.test(String(error?.message || error || ""));
}

function lockedFileMessage(action = "change") {
  return `A downloaded MP3 is still locked by another app, so ReleasePilot could not ${action} it. Close Suno Music Downloader, any media player, and any Explorer preview of that folder, wait a few seconds, then try again.`;
}

function updateSongFactoryAudioProgress(job, progress = {}) {
  if (!job) return;
  job.progress = {
    ...(job.progress || {}),
    ...progress,
    updatedAt: new Date().toISOString()
  };
}

async function clearMirrorArtworkFiles(mirrorFolder = "") {
  if (!mirrorFolder || !existsSync(mirrorFolder)) return [];
  const removed = [];
  const entries = await readdir(mirrorFolder, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const imagePath = join(mirrorFolder, entry.name);
    await rm(imagePath, { force: true });
    removed.push(imagePath);
  }
  return removed;
}

async function copyCurrentArtworkToMirror({ mirrorFolder = "", artworkPath = "", albumTitle = "" } = {}) {
  if (!mirrorFolder || !artworkPath || !existsSync(artworkPath)) return "";
  const extension = extname(artworkPath).toLowerCase() || ".jpg";
  const targetName = `${safeTrackFileBaseName(albumTitle, "Album Artwork")} Artwork${extension}`;
  const mirroredArtworkPath = join(mirrorFolder, targetName);
  await copyFile(artworkPath, mirroredArtworkPath);
  return mirroredArtworkPath;
}

async function findSongFactoryAlbumArtworkFromCatalog({ paths = profilePaths(DEFAULT_PROFILE_ID), albumTitle = "" } = {}) {
  if (!albumTitle || !existsSync(paths.catalogPath)) return "";
  const parsed = parseCsvRecords((await readFile(paths.catalogPath, "utf8")).replace(/^\uFEFF/, ""));
  for (const row of parsed.rows) {
    if (normalizeKey(row.Album) !== normalizeKey(albumTitle)) continue;
    const artwork = normalizeLocalFolderInput(row["Artwork URL"] || row.Artwork || "");
    if (!artwork || /^https?:\/\//i.test(artwork)) continue;
    const resolved = resolveSafe(artwork);
    if (resolved && existsSync(resolved)) return resolved;
  }
  return "";
}

async function startSongFactoryAudioJob(payload = {}) {
  if (currentSongFactoryAudioJob?.running) {
    return {
      ok: false,
      message: "Audio conversion is already running.",
      status: await songFactoryAudioJobStatus()
    };
  }

  const tracks = Array.isArray(payload.plan?.tracks) ? payload.plan.tracks : [];
  const id = `song-audio-${Date.now()}-${randomBytes(3).toString("hex")}`;
  const job = {
    id,
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    error: "",
    result: null,
    progress: {
      stage: "starting",
      current: 0,
      total: tracks.length,
      percent: 0,
      message: "Preparing audio conversion..."
    }
  };
  currentSongFactoryAudioJob = job;

  setImmediate(async () => {
    try {
      job.result = await prepareSongFactoryAudio(payload, (progress) => updateSongFactoryAudioProgress(job, progress));
      updateSongFactoryAudioProgress(job, {
        stage: job.result?.ok === false ? "failed" : "complete",
        current: Number(job.progress?.total) || tracks.length,
        percent: job.result?.ok === false ? Number(job.progress?.percent) || 0 : 100,
        message: job.result?.message || "Audio conversion finished."
      });
    } catch (error) {
      job.error = String(error?.message || error || "Audio conversion failed.");
      updateSongFactoryAudioProgress(job, {
        stage: "failed",
        message: job.error,
        percent: Number(job.progress?.percent) || 0
      });
    } finally {
      job.running = false;
      job.finishedAt = new Date().toISOString();
    }
  });

  return { ok: true, message: "Audio conversion started.", id, status: await songFactoryAudioJobStatus() };
}

async function songFactoryAudioJobStatus() {
  if (!currentSongFactoryAudioJob) {
    return {
      ok: true,
      running: false,
      progress: {
        stage: "idle",
        current: 0,
        total: 0,
        percent: 0,
        message: "No audio conversion is running."
      }
    };
  }

  return {
    ok: true,
    id: currentSongFactoryAudioJob.id,
    running: currentSongFactoryAudioJob.running,
    startedAt: currentSongFactoryAudioJob.startedAt,
    finishedAt: currentSongFactoryAudioJob.finishedAt || "",
    error: currentSongFactoryAudioJob.error || "",
    result: currentSongFactoryAudioJob.result,
    progress: currentSongFactoryAudioJob.progress || {}
  };
}

async function prepareSongFactoryAudio(payload = {}, onProgress = null) {
  const paths = profilePaths(requestProfileId(payload));
  const plan = payload.plan || {};
  const settings = plan.settings || {};
  const tracks = Array.isArray(plan.tracks) ? plan.tracks : [];
  const albumTitle = String(settings.albumTitle || payload.albumTitle || "").trim();
  const artistName = String(settings.artistName || settings.artist || payload.artistName || DEFAULT_SETUP.pageName || "Maja's Coffee Jazz Zone").trim();
  const sourceFolder = normalizeLocalFolderInput(payload.sourceFolder || payload.folder || payload.audioFolder || "");
  const outputFolder = normalizeLocalFolderInput(payload.outputFolder || payload.audioDir || sourceFolder || "");
  const mirrorFolder = payload.mirrorToSourceFolder === false
    ? ""
    : normalizeLocalFolderInput(payload.mirrorFolder || join(sourceFolder || outputFolder || "", "Ditto Ready"));
  const payloadArtworkPath = normalizeLocalFolderInput(payload.artworkPath || "");
  const catalogArtworkPath = await findSongFactoryAlbumArtworkFromCatalog({ paths, albumTitle });
  const artworkPath = catalogArtworkPath || (payloadArtworkPath && existsSync(payloadArtworkPath) ? payloadArtworkPath : "");
  const hasArtwork = Boolean(artworkPath && existsSync(artworkPath));
  if (!albumTitle || !tracks.length) {
    return { ok: false, message: "Generate or recall a Song Factory album plan before converting audio." };
  }
  if (!sourceFolder || !existsSync(sourceFolder)) {
    return { ok: false, message: "Choose the folder containing the downloaded Suno audio first." };
  }
  if (!outputFolder) {
    return { ok: false, message: "Choose where the converted MP3 files should be saved." };
  }

  onProgress?.({
    stage: "scanning",
    current: 0,
    total: tracks.length,
    percent: 2,
    message: "Scanning downloaded audio files..."
  });

  await mkdir(outputFolder, { recursive: true });
  if (mirrorFolder) await mkdir(mirrorFolder, { recursive: true });
  const audioFiles = await listSongFactoryAudioFiles(sourceFolder);
  if (!audioFiles.length) {
    return { ok: false, message: "No Suno audio/video downloads were found in that folder." };
  }

  const count = Math.min(audioFiles.length, tracks.length);
  const converted = [];
  const failures = [];
  for (let index = 0; index < count; index += 1) {
    const file = audioFiles[index];
    const title = String(tracks[index].title || `Track ${index + 1}`).trim();
    const targetPath = join(outputFolder, `${safeTrackFileBaseName(title, `Track ${index + 1}`)}.mp3`);
    const tempPath = join(outputFolder, `.song-factory-convert-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}.mp3`);
    onProgress?.({
      stage: "converting",
      current: index + 1,
      total: count,
      percent: Math.max(5, Math.round((index / Math.max(1, count)) * 90)),
      message: `Converting ${title} (${index + 1}/${count})`
    });
    try {
      const ffmpegArgs = [
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-i", file.path,
        ...(hasArtwork ? ["-i", artworkPath] : []),
        "-map", "0:a:0",
        ...(hasArtwork ? ["-map", "1:v:0"] : ["-vn"]),
        "-ar", "44100",
        "-ac", "2",
        "-codec:a", "libmp3lame",
        "-b:a", "320k",
        ...(hasArtwork ? [
          "-codec:v", "mjpeg",
          "-disposition:v", "attached_pic",
          "-id3v2_version", "3",
          "-metadata:s:v", "title=Album cover",
          "-metadata:s:v", "comment=Cover (front)"
        ] : []),
        "-metadata", `title=${title}`,
        "-metadata", `album=${albumTitle}`,
        "-metadata", `artist=${artistName}`,
        tempPath
      ];
      await execFileAsync("ffmpeg", ffmpegArgs, { windowsHide: true, maxBuffer: 1024 * 1024 * 4 });
      await rm(targetPath, { force: true }).catch(() => {});
      await rename(tempPath, targetPath);
      let mirrorPath = "";
      if (mirrorFolder) {
        mirrorPath = join(mirrorFolder, basename(targetPath));
        await copyFile(targetPath, mirrorPath);
      }
      converted.push({ title, from: file.path, to: targetPath, mirrorPath });
      onProgress?.({
        stage: "converting",
        current: index + 1,
        total: count,
        percent: Math.min(95, Math.round(((index + 1) / Math.max(1, count)) * 90)),
        message: `Converted ${title} (${index + 1}/${count})`
      });
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      const message = String(error?.stderr || error?.message || error || "ffmpeg conversion failed").trim();
      failures.push({ title, from: file.path, error: message.slice(0, 600) });
    }
  }

  if (converted.length && existsSync(paths.catalogPath)) {
    onProgress?.({
      stage: "saving",
      current: count,
      total: count,
      percent: 96,
      message: "Updating catalogue metadata..."
    });
    const parsed = parseCsvRecords((await readFile(paths.catalogPath, "utf8")).replace(/^\uFEFF/, ""));
    const headers = ensureCatalogHeaders(parsed.headers);
    const byTitle = new Map(converted.map((item) => [normalizeKey(item.title), item.to]));
    const rows = parsed.rows.map((row) => {
      if (normalizeKey(row.Album) !== normalizeKey(albumTitle)) return row;
      const convertedPath = byTitle.get(normalizeKey(row.Title));
      if (!convertedPath) return row;
      return {
        ...row,
        "Audio file or URL": convertedPath,
        "Audio Match Method": "song-factory-converted-44100-320k"
      };
    });
    await writeCsvRecords(paths.catalogPath, headers, rows);
  }

  let mirroredArtworkPath = "";
  let removedMirrorArtwork = [];
  if (mirrorFolder) {
    onProgress?.({
      stage: "saving",
      current: count,
      total: count,
      percent: 98,
      message: "Replacing Ditto Ready artwork..."
    });
    removedMirrorArtwork = await clearMirrorArtworkFiles(mirrorFolder);
    mirroredArtworkPath = await copyCurrentArtworkToMirror({ mirrorFolder, artworkPath, albumTitle });
  }

  return {
    ok: failures.length === 0,
    message: `Converted ${converted.length} file${converted.length === 1 ? "" : "s"} to Ditto-ready MP3${hasArtwork ? " with the selected album artwork embedded" : ""}${mirrorFolder ? " and saved a second copy in the picked folder" : ""}${failures.length ? `; ${failures.length} failed` : ""}.`,
    sourceFolder,
    outputFolder,
    mirrorFolder,
    mirroredArtworkPath,
    removedMirrorArtwork,
    converted,
    failures,
    extraAudioFiles: Math.max(0, audioFiles.length - tracks.length),
    missingAudioFiles: Math.max(0, tracks.length - audioFiles.length),
    format: "MP3, 44.1 kHz, stereo, 320 kbps"
  };
}

function splitCommandArgs(template = "", replacements = {}) {
  return String(template || "")
    .match(/"[^"]*"|'[^']*'|[^\s]+/g)
    ?.map((part) => part.replace(/^["']|["']$/g, "").replace(/\{([a-z0-9_]+)\}/gi, (_, key) => replacements[key] || ""))
    .filter((part) => part !== "") || [];
}

async function openSongFactoryDownloader(payload = {}) {
  const playlistUrl = String(payload.url || payload.playlistUrl || "").trim();
  const downloaderPath = normalizeLocalFolderInput(env.SUNO_DOWNLOADER_PATH || env.SONG_FACTORY_DOWNLOADER_PATH || "");
  const downloaderArgs = String(env.SUNO_DOWNLOADER_ARGS || env.SONG_FACTORY_DOWNLOADER_ARGS || "{url}").trim();
  if (!playlistUrl) {
    return { ok: false, message: "Paste the Suno playlist URL first." };
  }
  if (!downloaderPath) {
    return {
      ok: false,
      message: "No Suno downloader app is configured. Add SUNO_DOWNLOADER_PATH to backend/.env, then restart the app."
    };
  }
  if (!existsSync(downloaderPath)) {
    return { ok: false, message: `Configured Suno downloader was not found: ${downloaderPath}` };
  }
  const args = splitCommandArgs(downloaderArgs, { url: playlistUrl });
  const child = spawn(downloaderPath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  return {
    ok: true,
    message: `Opened Suno downloader with playlist URL. If your downloader does not auto-start, paste the copied URL manually.`,
    downloaderPath,
    args
  };
}

async function uploadPackageToR2(payload = {}) {
  const items = filterSuppressedPublishingItems(payload.items);
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

  const items = filterSuppressedPublishingItems(payload.items);
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

async function getPostingPlan(payload = {}) {
  const profileId = requestProfileId(payload);
  const plan = await loadPostingPlan(profileId);
  return {
    ok: true,
    profileId,
    message: `Loaded ${plan.items.length} planned Reel${plan.items.length === 1 ? "" : "s"}.`,
    ...plan
  };
}

async function getYouTubeVideoPlan(payload = {}) {
  const profileId = requestProfileId(payload);
  const plan = await loadYouTubeVideoPlan(profileId);
  return {
    ok: true,
    profileId,
    message: `Loaded ${plan.items.length} planned YouTube video${plan.items.length === 1 ? "" : "s"}.`,
    ...plan
  };
}

async function savePostingPlan(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const items = filterSuppressedPublishingItems(payload.items);
  const allowEmpty = payload.allowEmpty === true || payload.reason === "clear" || payload.reason === "reset";
  if (!items.length && !allowEmpty && existsSync(paths.postingPlanPath)) {
    const existing = await loadPostingPlan(paths.id).catch(() => ({ items: [] }));
    if (Array.isArray(existing.items) && existing.items.length) {
      return {
        ok: true,
        guarded: true,
        profileId: paths.id,
        message: `Skipped empty schedule save to protect ${existing.items.length} existing planned Reel${existing.items.length === 1 ? "" : "s"}. Use the reset/clear action to empty it intentionally.`,
        ...existing
      };
    }
  }
  await mkdir(dirname(paths.postingPlanPath), { recursive: true });
  const plan = {
    updatedAt: new Date().toISOString(),
    profileId: paths.id,
    items
  };
  await writeFile(paths.postingPlanPath, JSON.stringify(plan, null, 2), "utf8");
  return {
    ok: true,
    profileId: paths.id,
    message: `Saved ${items.length} planned Reel${items.length === 1 ? "" : "s"} for automatic publishing.`,
    ...plan
  };
}

async function saveYouTubeVideoPlan(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const rawItems = filterSuppressedPublishingItems(payload.items);
  const items = rawItems.filter(isYouTubeFullTrackPlanItem);
  const allowEmpty = payload.allowEmpty === true || payload.reason === "clear" || payload.reason === "reset";
  if (!items.length && !allowEmpty && existsSync(paths.youtubeVideoPlanPath)) {
    const existing = await loadYouTubeVideoPlan(paths.id).catch(() => ({ items: [] }));
    if (Array.isArray(existing.items) && existing.items.length) {
      return {
        ok: true,
        guarded: true,
        profileId: paths.id,
        message: `Skipped empty YouTube video plan save to protect ${existing.items.length} existing planned video${existing.items.length === 1 ? "" : "s"}. Use the reset/clear action to empty it intentionally.`,
        ...existing
      };
    }
  }
  await mkdir(dirname(paths.youtubeVideoPlanPath), { recursive: true });
  const plan = {
    updatedAt: new Date().toISOString(),
    profileId: paths.id,
    items
  };
  await writeFile(paths.youtubeVideoPlanPath, JSON.stringify(plan, null, 2), "utf8");
  return {
    ok: true,
    profileId: paths.id,
    message: `Saved ${items.length} YouTube video${items.length === 1 ? "" : "s"} for automatic publishing.`,
    ...plan
  };
}

function isYouTubeFullTrackPlanItem(item = {}) {
  const video = resolve(String(item.video || item.Video || ""));
  const relativeVideo = relative(schedulerDir, video).replace(/\\/g, "/").toLowerCase();
  const template = String(item.template || item.Template || "").toLowerCase();
  return relativeVideo.startsWith("rendered-youtube-videos/")
    && (!template || ["youtube-full-track", "youtube-full-album"].includes(template));
}

async function clearSchedulePipeline() {
  const removed = [];
  let cancelledUpload = false;

  if (currentUploadJob?.running) {
    await cancelUploadJob();
    cancelledUpload = true;
  }

  await savePostingPlan({ items: [], allowEmpty: true, reason: "reset" });
  await saveYouTubeVideoPlan({ items: [], allowEmpty: true, reason: "reset" });

  if (existsSync(runDir)) {
    const files = await readdir(runDir).catch(() => []);
    const disposablePatterns = [
      /^posting-package-/i,
      /^posting-package-uploaded-/i,
      /^instagram-uploaded-/i,
      /^instagram-containers-/i,
      /^upload-\d{8}/i,
      /^upload-.*-(progress|stdout|stderr)\.(json|txt)$/i
    ];

    for (const file of files) {
      if (!disposablePatterns.some((pattern) => pattern.test(file))) continue;
      const path = join(runDir, file);
      await rm(path, { force: true }).then(() => removed.push(file)).catch(() => {});
    }
  }

  currentUploadJob = null;

  return {
    ok: true,
    message: `Cleared schedule pipeline. Removed ${removed.length} temporary upload/container file${removed.length === 1 ? "" : "s"}.`,
    cancelledUpload,
    removedCount: removed.length,
    removed
  };
}

async function localStorageCleanupPlan({ apply = false } = {}) {
  const protectedPaths = await collectProtectedContentPaths();
  const targets = [
    {
      id: "rendered-reels",
      label: "Old rendered Reel batches",
      dir: join(schedulerDir, "rendered-reels"),
      mode: "directories",
      keepLatest: 3,
      minAgeDays: 7
    },
    {
      id: "rendered-youtube-videos",
      label: "Old YouTube full-video batches",
      dir: join(schedulerDir, "rendered-youtube-videos"),
      mode: "directories",
      keepLatest: 3,
      minAgeDays: 7
    },
    {
      id: "api-runs",
      label: "Old publish/render logs",
      dir: runDir,
      mode: "files",
      keepLatest: 80,
      minAgeDays: 14,
      patterns: [/\.json$/i, /\.log$/i, /\.txt$/i]
    },
    {
      id: "manual-posting-packages",
      label: "Legacy manual posting packages",
      dir: join(schedulerDir, "manual-posting-packages"),
      mode: "files",
      keepLatest: 4,
      minAgeDays: 14,
      patterns: [/\.json$/i, /\.csv$/i, /\.txt$/i]
    },
    {
      id: "queue-runs",
      label: "Legacy draft queue runs",
      dir: join(schedulerDir, "queue-runs"),
      mode: "files",
      keepLatest: 2,
      minAgeDays: 14,
      patterns: [/\.json$/i, /\.csv$/i, /\.txt$/i]
    }
  ];

  const groups = [];
  for (const target of targets) {
    groups.push(await buildCleanupGroup(target, protectedPaths, apply));
  }

  const candidates = groups.flatMap((group) => group.items);
  const deleted = candidates.filter((item) => item.deleted).length;
  const bytes = candidates.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
  const deletedBytes = candidates.filter((item) => item.deleted).reduce((sum, item) => sum + Number(item.bytes || 0), 0);

  return {
    ok: true,
    applied: apply,
    message: apply
      ? `Cleaned ${deleted} old local item${deleted === 1 ? "" : "s"} and freed ${formatBytes(deletedBytes)}.`
      : `${candidates.length} old local item${candidates.length === 1 ? "" : "s"} can be cleaned, about ${formatBytes(bytes)}.`,
    totalCandidates: candidates.length,
    totalBytes: bytes,
    deletedCount: deleted,
    deletedBytes,
    groups
  };
}

async function buildCleanupGroup(target, protectedPaths, apply) {
  if (!existsSync(target.dir)) {
    return { id: target.id, label: target.label, dir: target.dir, items: [], skipped: ["Folder does not exist."] };
  }

  const entries = await readdir(target.dir, { withFileTypes: true }).catch(() => []);
  const cutoff = Date.now() - Number(target.minAgeDays || 0) * 86400000;
  const records = [];

  for (const entry of entries) {
    if (target.mode === "directories" && !entry.isDirectory()) continue;
    if (target.mode === "files" && !entry.isFile()) continue;
    if (target.patterns && !target.patterns.some((pattern) => pattern.test(entry.name))) continue;
    const path = join(target.dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info) continue;
    records.push({
      name: entry.name,
      path,
      mtimeMs: info.mtimeMs,
      modifiedAt: info.mtime.toISOString(),
      bytes: await pathSize(path)
    });
  }

  records.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const items = [];
  for (const [index, record] of records.entries()) {
    const tooRecent = record.mtimeMs > cutoff;
    const keptByCount = index < Number(target.keepLatest || 0);
    const protectedByPlan = await pathContainsProtectedContent(record.path, protectedPaths);
    if (tooRecent || keptByCount || protectedByPlan) continue;
    const item = {
      name: record.name,
      path: record.path,
      relativePath: relative(schedulerDir, record.path),
      modifiedAt: record.modifiedAt,
      bytes: record.bytes,
      deleted: false
    };
    if (apply && isInsidePath(schedulerDir, record.path)) {
      await rm(record.path, { recursive: true, force: true });
      item.deleted = true;
    }
    items.push(item);
  }

  return {
    id: target.id,
    label: target.label,
    dir: target.dir,
    keepLatest: target.keepLatest,
    minAgeDays: target.minAgeDays,
    items
  };
}

async function collectProtectedContentPaths() {
  const values = new Set();
  const planPaths = [
    postingPlanPath,
    youtubeVideoPlanPath,
    ...await profilePlanPaths()
  ];

  for (const planPath of planPaths) {
    if (!existsSync(planPath)) continue;
    try {
      const parsed = JSON.parse((await readFile(planPath, "utf8")).replace(/^\uFEFF/, ""));
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      for (const item of items) {
        [item.video, item.Video, item.preview, item.Preview, item.artwork, item.Artwork].filter(Boolean).forEach((value) => {
          const text = String(value);
          const localPath = /^file:\/\//i.test(text) ? fileURLToPath(text) : text;
          const resolved = resolve(localPath);
          if (isInsidePath(schedulerDir, resolved)) values.add(resolved);
        });
      }
    } catch {}
  }

  return values;
}

async function profilePlanPaths() {
  const profilesDir = join(schedulerDir, "profiles");
  if (!existsSync(profilesDir)) return [];
  const entries = await readdir(profilesDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => [
      join(profilesDir, entry.name, "config", "posting-plan.json"),
      join(profilesDir, entry.name, "config", "youtube-video-plan.json")
    ]);
}

async function pathContainsProtectedContent(candidate, protectedPaths) {
  for (const protectedPath of protectedPaths) {
    if (isInsidePath(candidate, protectedPath) || resolve(candidate) === resolve(protectedPath)) return true;
  }
  return false;
}

async function pathSize(path) {
  const info = await stat(path).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  if (!info.isDirectory()) return 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    total += await pathSize(join(path, entry.name));
  }
  return total;
}

function isInsidePath(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || Boolean(rel && !rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel));
}

function formatBytes(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

async function loadPostingPlan(profileId = DEFAULT_PROFILE_ID) {
  const paths = profilePaths(profileId);
  if (!existsSync(paths.postingPlanPath)) {
    return {
      updatedAt: "",
      profileId: paths.id,
      items: []
    };
  }

  const parsed = JSON.parse((await readFile(paths.postingPlanPath, "utf8")).replace(/^\uFEFF/, ""));
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = filterSuppressedPublishingItems(rawItems);
  if (items.length !== rawItems.length) {
    await writeFile(paths.postingPlanPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      profileId: parsed.profileId || paths.id,
      items
    }, null, 2), "utf8");
  }
  return {
    updatedAt: parsed.updatedAt || "",
    profileId: parsed.profileId || paths.id,
    items
  };
}

async function loadYouTubeVideoPlan(profileId = DEFAULT_PROFILE_ID) {
  const paths = profilePaths(profileId);
  if (!existsSync(paths.youtubeVideoPlanPath)) {
    return {
      updatedAt: "",
      profileId: paths.id,
      items: []
    };
  }

  const parsed = JSON.parse((await readFile(paths.youtubeVideoPlanPath, "utf8")).replace(/^\uFEFF/, ""));
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = filterSuppressedPublishingItems(rawItems);
  if (items.length !== rawItems.length) {
    await writeFile(paths.youtubeVideoPlanPath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      profileId: parsed.profileId || paths.id,
      items
    }, null, 2), "utf8");
  }
  return {
    updatedAt: parsed.updatedAt || "",
    profileId: parsed.profileId || paths.id,
    items
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

async function publishAllDueFromSavedPlans() {
  const reelPlan = await loadPostingPlan();
  const youtubePlan = await loadYouTubeVideoPlan();
  const result = await publishAllDue({
    items: reelPlan.items,
    youtubeVideoItems: youtubePlan.items,
    postingSettings: {},
    source: "startup"
  });

  if (Array.isArray(result.items)) {
    await savePostingPlan({ items: result.items });
  }
  if (Array.isArray(result.youtubeVideoItems)) {
    await saveYouTubeVideoPlan({ items: result.youtubeVideoItems });
  }

  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, `startup-publish-${fileStamp()}.json`), JSON.stringify(result, null, 2), "utf8");
  return result;
}

async function acquirePublishLock(source = "publish") {
  if (currentPublishJob) {
    return {
      ok: false,
      running: true,
      message: "A publish cycle is already running. Wait for it to finish before starting another.",
      startedAt: currentPublishJob.startedAt
    };
  }

  await mkdir(runDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const lockPayload = {
    source,
    pid: process.pid,
    startedAt
  };

  async function createLock() {
    const handle = await open(publishLockPath, "wx");
    await handle.writeFile(JSON.stringify(lockPayload, null, 2), "utf8");
    await handle.close();
  }

  try {
    await createLock();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readPublishLock();
    const started = existing?.startedAt ? new Date(existing.startedAt).getTime() : 0;
    const pidIsGone = existing?.pid && !isProcessRunning(existing.pid);
    const stale = !started || pidIsGone || Date.now() - started > 2 * 60 * 60 * 1000;
    if (stale) {
      await rm(publishLockPath, { force: true }).catch(() => {});
      await createLock();
    } else {
      return {
        ok: false,
        running: true,
        message: `A publish cycle is already running${existing?.source ? ` (${existing.source})` : ""}. Wait for it to finish before starting another.`,
        startedAt: existing?.startedAt || ""
      };
    }
  }

  currentPublishJob = {
    startedAt,
    source,
    lockPath: publishLockPath
  };

  return {
    ok: true,
    startedAt,
    release: async () => {
      currentPublishJob = null;
      await rm(publishLockPath, { force: true }).catch(() => {});
    }
  };
}

function isProcessRunning(pid) {
  const numericPid = Number(pid);
  if (!numericPid || numericPid === process.pid) return true;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readPublishLock() {
  try {
    return JSON.parse((await readFile(publishLockPath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

async function publishAllDue(payload = {}) {
  const lock = await acquirePublishLock(payload.source || "publish-all-due");
  if (!lock.ok) return lock;
  try {
    return await publishAllDueUnlocked(payload);
  } finally {
    await lock.release();
  }
}

function metaCandidateBlockReason(item = {}, ledger = { items: {} }, now = new Date(), duplicateCooldownDays = 90) {
  const wantInstagram = destinationEnabled(item, "instagram");
  const wantFacebook = destinationEnabled(item, "facebook");
  if (!wantInstagram && !wantFacebook) return "Instagram and Facebook are unticked for this item";

  const ledgerKey = publishLedgerKey(item);
  const facebookLedgerKey = `${ledgerKey}|facebook-page`;
  const ledgerHit = ledger.items?.[ledgerKey];
  const facebookLedgerHit = ledger.items?.[facebookLedgerKey];
  if (ledgerHit && (!wantFacebook || facebookLedgerHit)) return "already published to selected Meta destinations";

  const duplicate = findRecentPublishedDuplicate(ledger, item, duplicateCooldownDays, now);
  if (duplicate) return duplicate.reason;

  if (!/^https:\/\//i.test(String(item.publicVideoUrl || "").trim())) return "missing public video URL";
  if (!compactCaption(item.caption, item.hashtags)) return "missing caption";
  return "";
}

function selectMetaReelsForDailyPublish(reels = [], ledger = { items: {} }, now = new Date(), options = {}) {
  const duplicateCooldownDays = Number.isFinite(Number(options.duplicateCooldownDays))
    ? Number(options.duplicateCooldownDays)
    : 90;
  const metaCandidates = reels.filter((item) => destinationEnabled(item, "instagram") || destinationEnabled(item, "facebook"));
  const alreadyPublishedToday = countLedgerMetaReelsOnDate(ledger, now);
  if (alreadyPublishedToday > 0) {
    return {
      items: [],
      heldCount: metaCandidates.length,
      message: `Meta/Instagram daily lock is already used for ${localDateKey(now)}. It resets at local midnight; due variants will continue to YouTube Shorts only.`
    };
  }

  const eligibleMetaCandidates = metaCandidates.filter((item) => !metaCandidateBlockReason(item, ledger, now, duplicateCooldownDays));

  if (!eligibleMetaCandidates.length) {
    const promotable = reels
      .map((item) => ({
        ...item,
        destinations: {
          ...readDestinations(item),
          instagram: true,
          facebook: true
        }
      }))
      .find((item) => destinationEnabled(item, "youtubeShorts") && !metaCandidateBlockReason(item, ledger, now, duplicateCooldownDays));
    if (!promotable) {
      const blockedReason = metaCandidates.length
        ? metaCandidateBlockReason(metaCandidates[0], ledger, now, duplicateCooldownDays)
        : "";
      return {
        items: [],
        heldCount: metaCandidates.length,
        message: blockedReason ? `No eligible Meta/Instagram Reel found. First blocked item: ${metaCandidates[0]?.title || "Untitled"} - ${blockedReason}.` : ""
      };
    }
    return {
      items: [{
        ...promotable,
        scheduleNote: `${promotable.scheduleNote || ""} Promoted to today's first Meta/Instagram slot because no Reel has posted since local midnight.`.trim()
      }],
      heldCount: Math.max(0, metaCandidates.length - 1),
      message: metaCandidates.length
        ? "Skipped blocked Meta candidates and promoted the next eligible Short to Instagram/Facebook."
        : "Promoted the next due Short to Instagram/Facebook because today's first Meta/Instagram slot was empty."
    };
  }

  return {
    items: [eligibleMetaCandidates[0]],
    heldCount: Math.max(0, metaCandidates.length - 1),
    message: ""
  };
}

async function publishAllDueUnlocked(payload = {}) {
  const now = new Date();
  const reelItems = filterSuppressedPublishingItems(payload.items);
  const youtubeVideoItems = Array.isArray(payload.youtubeVideoItems)
    ? filterSuppressedPublishingItems(payload.youtubeVideoItems).filter(isYouTubeFullTrackPlanItem)
    : [];
  const activeReelItems = reelItems.filter(isActivePublishingPlanItem);
  const activeYoutubeVideoItems = youtubeVideoItems.filter(isActivePublishingPlanItem);
  const todayReels = activeReelItems.filter((item) => isDueNow(item, now)).sort(sortBySchedule);
  const publishLedger = await loadPublishLedger();
  const requestedDailyShortLimit = Math.min(
    DAILY_PLATFORM_LIMITS.youtubeShorts,
    clamp(Number(payload.postingSettings?.shortsPerDay) || Number(payload.postingSettings?.maxPostsPerDay) || DAILY_PLATFORM_LIMITS.youtubeShorts, 1, 10)
  );
  const alreadyYoutubeShortsToday = countLedgerPlatformPublishesOnDate(publishLedger, "youtube-shorts", now);
  const remainingYoutubeShortSlots = Math.max(0, requestedDailyShortLimit - alreadyYoutubeShortsToday);
  const dueUnpublishedShortReels = todayReels
    .filter((item) => destinationEnabled(item, "youtubeShorts"))
    .filter((item) => !youtubeShortAlreadyPublished(item, publishLedger));
  const dailyFillPolicy = getDailyShortFillPolicy({
    now,
    alreadyPublishedToday: alreadyYoutubeShortsToday,
    dailyLimit: requestedDailyShortLimit,
    postingSettings: payload.postingSettings || {}
  });
  const dailyFillReel = remainingYoutubeShortSlots > 0 && !dueUnpublishedShortReels.length && dailyFillPolicy.shouldFill
    ? nextAvailableUnpublishedShort(activeReelItems, publishLedger, now)
    : null;
  const shortReelsForCatchUp = dailyFillReel ? [dailyFillReel] : dueUnpublishedShortReels;
  const metaReelsForSelection = dailyFillReel ? [...todayReels, dailyFillReel].sort(sortBySchedule) : todayReels;
  const catchUpSpacingHours = clamp(Number(payload.postingSettings?.catchUpSpacingHours) || DEFAULT_CATCH_UP_SPACING_HOURS, 1, 12);
  const catchUpPlan = planCatchUpReels(shortReelsForCatchUp, {
    now,
    dailyLimit: requestedDailyShortLimit,
    spacingHours: catchUpSpacingHours,
    force: payload.force,
    scheduleItems: activeReelItems,
    postingSettings: payload.postingSettings || {}
  });
  const selectedReels = catchUpPlan.selected;
  const heldTodayReels = catchUpPlan.held;
  const futureOrOtherReels = reelItems.filter((item) => (
    !isActivePublishingPlanItem(item)
    || !isDueNow(item, now)
  ) && (!dailyFillReel || publishMergeKey(item) !== publishMergeKey(dailyFillReel)));
  const selectedReelsForPublishing = selectedReels.slice(0, remainingYoutubeShortSlots);
  const heldDailyCapReels = selectedReels.slice(remainingYoutubeShortSlots).map((item) => ({
    ...item,
    publishStatus: "daily-youtube-cap-held",
    publishError: `Daily YouTube Shorts cap reached for ${localDateKey(now)} (${alreadyYoutubeShortsToday}/${requestedDailyShortLimit}).`
  }));
  const metaPostingSettings = {
    ...(payload.postingSettings || {}),
    maxPostsPerDay: 1
  };
  const metaDuplicateCooldownDays = payload.force
    ? 0
    : clamp(Number(metaPostingSettings.postingCooldown) || 90, 0, 1000);
  const metaSelection = selectMetaReelsForDailyPublish(metaReelsForSelection, publishLedger, now, {
    duplicateCooldownDays: metaDuplicateCooldownDays
  });
  const selectedYoutubeCampaignReels = uniqueCampaignItems(selectedReelsForPublishing.filter((item) => destinationEnabled(item, "youtubeVideo")));
  const matchedYoutubeVideos = activeYoutubeVideoItems
    .filter((item) => isDueNow(item, now))
    .filter((item) => destinationEnabled(item, "youtubeVideo"))
    .filter((item) => selectedYoutubeCampaignReels.some((reel) => sameCampaignItem(reel, item)))
    .sort(sortBySchedule);
  const uniqueMatchedYoutubeVideos = uniqueCampaignItems(matchedYoutubeVideos);
  const fallbackYoutubeVideos = selectedYoutubeCampaignReels
    .filter((reel) => !matchedYoutubeVideos.some((video) => sameCampaignItem(reel, video)))
    .map((reel) => prepareReelAsYouTubeVideo(reel));
  const selectedYoutubeVideos = [...uniqueMatchedYoutubeVideos, ...fallbackYoutubeVideos].sort(sortBySchedule);
  const heldYoutubeVideos = activeYoutubeVideoItems
    .filter((item) => (
      isDueNow(item, now) && !uniqueMatchedYoutubeVideos.some((selected) => sameCampaignItem(selected, item))
    ))
    .map((item) => {
      const rescheduledReel = catchUpPlan.rescheduled.find((reel) => sameCampaignItem(reel, item));
      return rescheduledReel ? { ...item, scheduledFor: rescheduledReel.scheduledFor || item.scheduledFor || "" } : item;
    });
  const futureOrOtherYoutubeVideos = youtubeVideoItems.filter((item) => !isActivePublishingPlanItem(item) || !isDueNow(item, now));
  const postingSettings = metaPostingSettings;

  let metaResult = {
    ok: true,
    message: metaSelection.message || (selectedReelsForPublishing.length
      ? "Meta/Instagram daily lock left this Short for YouTube only."
      : "No Meta/Instagram Reels are scheduled for the next daily slot."
    ),
    publishedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    items: []
  };

  if (metaSelection.items.length) {
    metaResult = await publishDueContainersUnlocked({
      ...payload,
      items: metaSelection.items,
      postingSettings,
      force: false
    });
    if (metaSelection.heldCount) {
      metaResult.message = `${metaResult.message || ""} Meta/Instagram daily lock kept ${metaSelection.heldCount} extra due variant${metaSelection.heldCount === 1 ? "" : "s"} for YouTube Shorts only.`.trim();
      metaResult.skippedCount = Number(metaResult.skippedCount || 0) + metaSelection.heldCount;
    }
  }

  const updatedTodayReels = mergeUpdatedItems(selectedReelsForPublishing, Array.isArray(metaResult.items) ? metaResult.items : []);
  const sameTrackSpacingHours = clamp(Number(payload.postingSettings?.sameTrackSpacingHours) || YOUTUBE_SAME_TRACK_SPACING_HOURS, 1, 168);
  const youtubeSpacingOptions = { privacy: "public", now, sameTrackSpacingHours };
  const shortsResult = await publishDueYouTubeShorts(updatedTodayReels, youtubeSpacingOptions);
  const youtubeVideoResult = await publishDueYouTubeVideos(selectedYoutubeVideos, { ...youtubeSpacingOptions, profileId: requestProfileId(payload) });
  const updatedPublishedReels = mergeUpdatedItems(shortsResult.items, youtubeVideoResult.items);
  const updatedReels = mergeUpdatedItems(
    [...futureOrOtherReels, ...heldTodayReels, ...heldDailyCapReels],
    updatedPublishedReels
  );
  const updatedYoutubeVideos = mergeUpdatedItems(
    [...futureOrOtherYoutubeVideos, ...heldYoutubeVideos],
    youtubeVideoResult.items
  );
  const publishedCount = Number(metaResult.publishedCount || 0) + shortsResult.publishedCount + youtubeVideoResult.publishedCount;
  const errorCount = Number(metaResult.errorCount || 0) + shortsResult.errorCount + youtubeVideoResult.errorCount;
  const skippedCount = Number(metaResult.skippedCount || 0) + shortsResult.skippedCount + youtubeVideoResult.skippedCount + heldTodayReels.length + heldDailyCapReels.length + heldYoutubeVideos.length + futureOrOtherReels.length + futureOrOtherYoutubeVideos.length;
  const parts = [
    metaResult.message || "",
    shortsResult.message,
    youtubeVideoResult.message,
    catchUpPlan.rescheduled.length
      ? `Catch-up moved ${catchUpPlan.rescheduled.length} extra due item${catchUpPlan.rescheduled.length === 1 ? "" : "s"} to the end of the schedule: ${catchUpPlan.rescheduled.map((item) => `${item.title || item.id || "Untitled"} -> ${formatLocalSchedule(item.scheduledFor)}`).join(" | ")}.`
      : "",
    dailyFillReel
      ? `Daily Shorts fill moved ${dailyFillReel.title || dailyFillReel.id || "one Short"} forward to post now because ${dailyFillPolicy.reason}`
      : "",
    heldDailyCapReels.length
      ? `Daily YouTube Shorts cap already reached for ${localDateKey(now)} (${alreadyYoutubeShortsToday}/${requestedDailyShortLimit}); held ${heldDailyCapReels.length} due item${heldDailyCapReels.length === 1 ? "" : "s"}.`
      : "",
    heldTodayReels.length || heldYoutubeVideos.length
      ? `Held ${heldTodayReels.length + heldYoutubeVideos.length} extra due item${heldTodayReels.length + heldYoutubeVideos.length === 1 ? "" : "s"} to avoid dumping multiple uploads.`
      : ""
  ].filter(Boolean);

  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, `published-all-due-${fileStamp()}.json`), JSON.stringify({
    checkedAt: new Date().toISOString(),
    mode: "today-only",
    metaResult,
    shortsResult,
    youtubeVideoResult,
    catchUpPlan: {
      spacingHours: catchUpSpacingHours,
      selectedCount: selectedReels.length,
      selectedForPublishingCount: selectedReelsForPublishing.length,
      alreadyYoutubeShortsToday,
      requestedDailyShortLimit,
      heldDailyCapCount: heldDailyCapReels.length,
      dailyFillPolicy,
      dailyFill: dailyFillReel ? {
        id: dailyFillReel.id || "",
        title: dailyFillReel.title || dailyFillReel.Title || "",
        scheduledFor: dailyFillReel.scheduledFor || ""
      } : null,
      rescheduledCount: catchUpPlan.rescheduled.length,
      rescheduled: catchUpPlan.rescheduled.map((item) => ({
        id: item.id || "",
        title: item.title || item.Title || "",
        scheduledFor: item.scheduledFor || ""
      }))
    },
    items: updatedReels,
    youtubeVideoItems: updatedYoutubeVideos
  }, null, 2), "utf8");

  return {
    ok: errorCount === 0,
    message: `Daily public publish finished. ${parts.join(" ")}`.trim(),
    publishedCount,
    skippedCount,
    errorCount,
    metaResult,
    shortsResult,
    youtubeVideoResult,
    catchUpPlan: {
      spacingHours: catchUpSpacingHours,
      selectedCount: selectedReels.length,
      dailyFillPolicy,
      dailyFill: dailyFillReel ? {
        id: dailyFillReel.id || "",
        title: dailyFillReel.title || dailyFillReel.Title || "",
        scheduledFor: dailyFillReel.scheduledFor || ""
      } : null,
      rescheduledCount: catchUpPlan.rescheduled.length,
      rescheduled: catchUpPlan.rescheduled.map((item) => ({
        id: item.id || "",
        title: item.title || item.Title || "",
        scheduledFor: item.scheduledFor || ""
      }))
    },
    items: updatedReels,
    youtubeVideoItems: updatedYoutubeVideos
  };
}

async function resendDueToDestination(payload = {}) {
  const destination = String(payload.destination || "").trim();
  const now = new Date();
  const reelItems = filterSuppressedPublishingItems(payload.items);
  const youtubeVideoItems = Array.isArray(payload.youtubeVideoItems)
    ? filterSuppressedPublishingItems(payload.youtubeVideoItems).filter(isYouTubeFullTrackPlanItem)
    : [];
  const todayReels = reelItems.filter((item) => isDueNow(item, now)).sort(sortBySchedule);
  const requestedItemId = String(payload.itemId || "").trim();
  const retryLimit = clamp(Number(payload.limit) || 1, 1, 10);
  const selectedReels = requestedItemId
    ? todayReels.filter((item) => itemMatchesRequestedId(item, requestedItemId))
    : selectReelsForResend(todayReels, destination, retryLimit);

  if (requestedItemId && !selectedReels.length) {
    return {
      ok: false,
      message: `Could not find the selected scheduled item (${requestedItemId}) to re-send. Refresh Schedule and try the button on that item again.`,
      publishedCount: 0,
      skippedCount: 0,
      errorCount: 1,
      items: reelItems,
      youtubeVideoItems
    };
  }

  if (!selectedReels.length) {
    return {
      ok: true,
      message: "No due scheduled Reel was found to re-send.",
      publishedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      items: reelItems,
      youtubeVideoItems
    };
  }

  if (destination === "meta") {
    const prepared = selectedReels.map((item) => ({
      ...item,
      status: "approved",
      publishStatus: "",
      publishError: "",
      containerId: "",
      containerStatus: "",
      instagramMediaId: "",
      facebookMediaId: "",
      facebookPublishStatus: "",
      facebookPublishError: ""
    }));
    const result = await publishDueContainersUnlocked({
      ...payload,
      items: prepared,
      force: true,
      resend: true,
      postingSettings: {
        ...(payload.postingSettings || {}),
        maxPostsPerDay: prepared.length || 1,
        postingCooldown: 0
      }
    });
    return {
      ...result,
      message: `Re-send to Instagram/Facebook finished. ${result.message || ""}`.trim(),
      items: mergeUpdatedItems(reelItems, result.items || prepared),
      youtubeVideoItems
    };
  }

  if (destination === "youtubeShorts") {
    const result = await publishDueYouTubeShorts(selectedReels.map((item) => ({
      ...item,
      youtubeShortVideoId: "",
      youtubeShortUrl: "",
      youtubeShortUploadedAt: "",
      youtubeShortPublishedAt: "",
      youtubeShortPublishStatus: "",
      youtubeShortPublishError: ""
    })), { privacy: "public", resend: true });
    return {
      ...result,
      message: `Re-send to YouTube Shorts finished. ${result.message || ""}`.trim(),
      items: mergeUpdatedItems(reelItems, result.items || selectedReels),
      youtubeVideoItems
    };
  }

  if (destination === "youtubeVideo") {
    const sourceVideos = youtubeVideoItems.map((item) => applyMatchingReelSchedule(item, reelItems));
    const selectedFullVideos = sourceVideos
      .filter((item) => selectedReels.some((reel) => sameCampaignItem(reel, item)));
    const failedVideos = selectedFullVideos.filter(isFailedYouTubeFullTrackItem);
    const dueVideos = selectedFullVideos.filter((item) => isDueNow(item, now));
    const resendableVideos = selectedFullVideos.filter(isResendableYouTubeFullTrackItem);
    const fallbackVideos = selectedReels
      .filter((reel) => !selectedFullVideos.some((video) => sameCampaignItem(reel, video)))
      .map((reel) => prepareReelAsYouTubeVideo(reel));
    const retryVideos = (failedVideos.length ? failedVideos : (dueVideos.length ? dueVideos : (resendableVideos.length ? resendableVideos : fallbackVideos)))
      .slice(0, clamp(Number(payload.limit) || 1, 1, 10));
    if (!retryVideos.length) {
      return {
        ok: true,
        message: "No YouTube video was found to re-send for the selected scheduled item.",
        publishedCount: 0,
        skippedCount: 0,
        errorCount: 0,
        items: reelItems,
        youtubeVideoItems
      };
    }
    const result = await publishDueYouTubeVideos(retryVideos.map((item) => ({
      ...item,
      status: "approved",
      youtubeVideoId: "",
      youtubeUrl: "",
      youtubePublishedAt: "",
      youtubePublishStatus: "",
      youtubePublishError: ""
    })), { privacy: "public", resend: true, profileId: requestProfileId(payload) });
    return {
      ...result,
      message: `Re-send to YouTube full video finished for ${retryVideos.map((item) => item.title || item.id || "selected item").join(", ")}. ${result.message || ""}`.trim(),
      items: mergeUpdatedItems(reelItems, result.items || retryVideos),
      youtubeVideoItems: mergeUpdatedItems(youtubeVideoItems, result.items || retryVideos)
    };
  }

  return {
    ok: false,
    message: "Choose what to re-send: Meta, YouTube Shorts, or YouTube full video.",
    items: reelItems,
    youtubeVideoItems
  };
}

function mergeUpdatedItems(existing = [], updates = []) {
  const byKey = new Map(existing.map((item) => [publishMergeKey(item), item]));
  updates.forEach((item) => {
    byKey.set(publishMergeKey(item), { ...(byKey.get(publishMergeKey(item)) || {}), ...item });
  });
  return [...byKey.values()].sort(sortBySchedule);
}

function publishMergeKey(item = {}) {
  return normalizeKey(item.id || item.isrc || item.ISRC || `${item.title || item.Title || ""}|${item.album || item.Album || ""}`);
}

function campaignIdentityKey(item = {}) {
  return normalizeKey(
    item.isrc || item.ISRC ||
    item.audio || item.Audio ||
    `${item.title || item.Title || ""}|${item.album || item.Album || ""}` ||
    item.id || item.ID || ""
  );
}

function uniqueCampaignItems(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const key = campaignIdentityKey(item) || publishMergeKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyMatchingReelSchedule(item = {}, reels = []) {
  if (item.scheduledFor) return item;
  const match = reels.find((reel) => sameCampaignItem(reel, item));
  return match ? { ...item, scheduledFor: match.scheduledFor || "" } : item;
}

function prepareReelAsYouTubeVideo(reel = {}) {
  return {
    ...reel,
    status: "approved",
    youtubeVideoId: "",
    youtubeUrl: "",
    youtubePublishedAt: "",
    youtubePublishStatus: "",
    youtubePublishError: ""
  };
}

async function getPublishingHistory() {
  if (!existsSync(runDir)) {
    return { ok: true, message: "No publishing history found yet.", items: [] };
  }

  const byKey = new Map();
  const ledger = await loadPublishLedger();
  for (const entry of Object.values(ledger.items || {})) {
    addHistoryPlatform(byKey, entry, "published-ledger.json");
  }

  const files = (await readdir(runDir))
    .filter((file) => (file.startsWith("published-due-") || file.startsWith("published-all-due-") || file.startsWith("startup-publish-")) && file.endsWith(".json"))
    .sort();

  for (const file of files) {
    const path = join(runDir, file);
    const parsed = JSON.parse((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
    const checkedAt = parsed.checkedAt || "";
    const reelItems = Array.isArray(parsed.items) ? parsed.items : [];
    const youtubeVideoItems = Array.isArray(parsed.youtubeVideoItems) ? parsed.youtubeVideoItems : [];
    for (const item of reelItems) addHistoryFromPlanItem(byKey, item, file, checkedAt);
    for (const item of youtubeVideoItems) addHistoryFromPlanItem(byKey, item, file, checkedAt);
  }

  const items = [...byKey.values()].sort((a, b) => {
    const first = new Date(b.lastPublishedAt || b.lastSeenAt || 0).getTime();
    const second = new Date(a.lastPublishedAt || a.lastSeenAt || 0).getTime();
    return first - second;
  });

  return {
    ok: true,
    message: `Loaded ${items.length} published item${items.length === 1 ? "" : "s"} from local history.`,
    items
  };
}

async function getYouTubePerformance(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  if (!existsSync(paths.youtubePerformancePath)) {
    return {
      ok: true,
      profileId: paths.id,
      message: "No YouTube performance snapshot yet. Run Sync YouTube stats first.",
      syncedAt: "",
      items: [],
      insights: youtubePerformanceInsights([])
    };
  }
  const parsed = JSON.parse((await readFile(paths.youtubePerformancePath, "utf8")).replace(/^\uFEFF/, ""));
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return {
    ok: true,
    profileId: paths.id,
    message: `Loaded ${items.length} YouTube performance item${items.length === 1 ? "" : "s"}.`,
    ...parsed,
    insights: youtubePerformanceInsights(items)
  };
}

async function syncYouTubePerformance(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const missing = ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"].filter((key) => !env[key]);
  if (missing.length) {
    return {
      ok: false,
      profileId: paths.id,
      message: `Missing YouTube credential${missing.length === 1 ? "" : "s"} in .env: ${missing.join(", ")}`
    };
  }

  let accessToken = "";
  try {
    accessToken = await youtubeAccessToken();
  } catch (error) {
    return {
      ok: false,
      profileId: paths.id,
      message: `YouTube token could not be refreshed. Reconnect Google OAuth in Setup > YouTube. ${error.message || ""}`.trim()
    };
  }

  const sourceItems = await collectPublishedYouTubeItems(paths.id);
  const ids = uniqueTextValues(sourceItems.map((item) => item.youtubeVideoId)).filter(Boolean);
  if (!ids.length) {
    return {
      ok: true,
      profileId: paths.id,
      message: "No uploaded YouTube video IDs found in local history yet.",
      syncedAt: new Date().toISOString(),
      items: [],
      insights: youtubePerformanceInsights([])
    };
  }

  const statsById = new Map();
  for (let index = 0; index < ids.length; index += 50) {
    const batch = ids.slice(index, index + 50);
    const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(batch.join(","))}`;
    const response = await fetch(apiUrl, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.error) {
      const reason = body.error?.message || body.error?.errors?.[0]?.reason || `YouTube stats request failed (${response.status}).`;
      const needsReadonly = /permission|insufficient|forbidden|scope|access/i.test(reason);
      return {
        ok: false,
        profileId: paths.id,
        message: needsReadonly
          ? `${reason} Reconnect Google OAuth in Setup > YouTube so the app can request YouTube read-only stats access.`
          : reason
      };
    }
    (body.items || []).forEach((item) => statsById.set(item.id, item));
  }

  const items = sourceItems
    .filter((item) => statsById.has(item.youtubeVideoId))
    .map((item) => youtubePerformanceItem(item, statsById.get(item.youtubeVideoId)))
    .sort((a, b) => b.views - a.views);
  const snapshot = {
    ok: true,
    profileId: paths.id,
    syncedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
    insights: youtubePerformanceInsights(items)
  };
  await mkdir(dirname(paths.youtubePerformancePath), { recursive: true });
  await writeFile(paths.youtubePerformancePath, JSON.stringify(snapshot, null, 2), "utf8");
  return {
    ...snapshot,
    message: `Synced YouTube stats for ${items.length} upload${items.length === 1 ? "" : "s"}.`
  };
}

async function buildPerformanceGeneratePreset(payload = {}) {
  const paths = profilePaths(requestProfileId(payload));
  const snapshot = await getYouTubePerformance({ profileId: paths.id });
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  if (!items.length) {
    return {
      ok: false,
      profileId: paths.id,
      message: "No YouTube performance stats found yet. Open Performance and sync YouTube stats first."
    };
  }

  const bestPerformingMode = String(payload.mode || "").toLowerCase() === "best-performing";
  const focusList = [
    "bossa / Brazilian cafe",
    "lo-fi room / study setup",
    "zen / meditative visuals",
    "piano / live instrumentation visuals"
  ];
  const shortItems = items.filter((item) => {
    const platform = String(item.platform || "").toLowerCase();
    const contentFormat = String(item.contentFormat || "").toLowerCase();
    const creativeSource = String(item.creativeSource || "").toLowerCase();
    const isShort = platform === "youtube-shorts" || contentFormat.includes("short");
    const isFullTrack = platform === "youtube-video" || contentFormat.includes("full") || creativeSource.includes("full track");
    return isShort && !isFullTrack;
  });
  const rankingSource = bestPerformingMode && shortItems.length ? shortItems : items;
  const ranked = [...rankingSource]
    .filter((item) => Number(item.views || 0) > 0)
    .sort((a, b) => youtubePerformancePresetScore(b) - youtubePerformancePresetScore(a));
  const basis = ranked.slice(0, 3);
  const topPool = ranked.slice(0, Math.max(12, Math.ceil(ranked.length * 0.25)));
  const preset = {
    ok: true,
    profileId: paths.id,
    presetName: bestPerformingMode ? `Best Performing ${localDateKey(new Date())}` : `Performance Led ${localDateKey(new Date())}`,
    presetDate: localDateKey(new Date()),
    createdAt: new Date().toISOString(),
    mode: bestPerformingMode ? "best-performing" : "performance-led",
    metricsBasis: bestPerformingMode
      ? "Daily best-performing preset. Uses the strongest recent YouTube Shorts signals and ignores full-track uploads for generation decisions while full videos are paused."
      : "Uses retention if a future YouTube Analytics sync provides it; currently uses views, views per day, likes, and comments from YouTube Data API stats.",
    focusList,
    basisVideos: basis.map(performancePresetBasisVideo),
    preferredAlbums: uniqueTextValues([
      ...basis.map((item) => item.album),
      ...aggregatePerformance(topPool, "album").slice(0, 6).map((item) => item.label)
    ]).slice(0, 8),
    preferredStyles: aggregatePerformance(topPool, "albumThemeStyle").filter((item) => item.label !== "Unknown").slice(0, 6),
    preferredInstruments: aggregateTermsPerformance(topPool, "albumThemeInstruments").filter((item) => item.label !== "Unknown").slice(0, 8),
    preferredSearchTerms: aggregateTermsPerformance(topPool, "pexelsSearchTerms").filter((item) => item.label !== "Unknown").slice(0, 12),
    preferredCreativeSources: aggregatePerformance(topPool, "creativeSource").filter((item) => item.label !== "Unknown").slice(0, 5),
    preferredVisualTypes: aggregatePerformance(topPool, "variantLabel").filter((item) => item.label !== "Unknown").slice(0, 6),
    preferredShortTypes: aggregatePerformance(topPool, "shortTypeLabel").filter((item) => item.label !== "Unknown").slice(0, 5),
    recommendedSettings: {
      renderPreset: "optimized",
      templateMode: "performance",
      shortsPerTrack: 3,
      renderBatchSize: Math.max(9, Math.min(18, Number(payload.count) || 12)),
      pexelsMajority: true,
      artworkVisualiserLimitPerTrack: 1,
      youtubeFullVideosEnabled: false
    }
  };
  preset.summary = performanceGeneratePresetSummary(preset);
  await mkdir(dirname(paths.performanceGeneratePresetPath), { recursive: true });
  await writeFile(paths.performanceGeneratePresetPath, JSON.stringify(preset, null, 2), "utf8");
  return {
    ...preset,
    presetPath: paths.performanceGeneratePresetPath,
    message: `Performance preset ready from ${basis.length} top upload${basis.length === 1 ? "" : "s"}: ${preset.summary}`
  };
}

function youtubePerformancePresetScore(item = {}) {
  const retention = Number(item.averageViewPercentage || item.retentionPercent || item.retainedViewers || 0);
  const views = Number(item.views || 0);
  const viewsPerDay = Number(item.viewsPerDay || 0);
  const likes = Number(item.likes || 0);
  const comments = Number(item.comments || 0);
  return (retention ? retention * 40 : 0) + views + viewsPerDay * 2 + likes * 8 + comments * 12;
}

function performancePresetBasisVideo(item = {}) {
  return {
    title: item.title || "",
    album: item.album || "",
    youtubeUrl: item.youtubeUrl || "",
    views: Number(item.views || 0),
    viewsPerDay: Number(item.viewsPerDay || 0),
    likes: Number(item.likes || 0),
    contentFormat: item.contentFormat || item.platform || "",
    creativeSource: item.creativeSource || "",
    visualType: item.variantLabel || item.variantRole || "",
    style: item.albumThemeStyle || "",
    instruments: item.albumThemeInstruments || "",
    searchTerms: item.pexelsSearchTerms || item.visualSearchTerms || item.albumThemeSearchTerms || "",
    sourceUrl: item.pexelsSourceUrl || item.visualSourceUrl || item.visualSourceName || ""
  };
}

function performanceGeneratePresetSummary(preset = {}) {
  const albums = (preset.preferredAlbums || []).slice(0, 3).join(", ");
  const sources = (preset.preferredCreativeSources || []).slice(0, 2).map((item) => item.label).join(", ");
  const terms = (preset.preferredSearchTerms || []).slice(0, 3).map((item) => item.label).join(", ");
  const focus = (preset.focusList || []).slice(0, 2).join(", ");
  return [
    preset.presetName || "",
    albums ? `albums: ${albums}` : "",
    sources ? `creative: ${sources}` : "",
    terms ? `search: ${terms}` : "",
    focus ? `focus: ${focus}` : ""
  ].filter(Boolean).join(" | ");
}

async function collectPublishedYouTubeItems(profileId = DEFAULT_PROFILE_ID) {
  const byVideoId = new Map();
  const metadataItems = await performanceMetadataItems(profileId);
  const add = (item = {}, platform = "", source = "") => {
    const youtubeVideoId = extractYouTubeVideoId(
      platform === "youtube-shorts"
        ? item.youtubeShortVideoId || item.youtubeVideoId || item.youtubeShortUrl || item.youtubeUrl
        : item.youtubeVideoId || item.youtubeUrl
    );
    if (!youtubeVideoId) return;
    const existing = byVideoId.get(youtubeVideoId) || {};
    const metadata = findPerformanceMetadata(metadataItems, item, youtubeVideoId);
    const merged = {
      ...compactPerformanceRecord(existing),
      ...compactPerformanceRecord(metadata),
      ...compactPerformanceRecord(item)
    };
    byVideoId.set(youtubeVideoId, {
      ...merged,
      profileId,
      source,
      platform,
      youtubeVideoId,
      youtubeUrl: merged.youtubeUrl || merged.youtubeShortUrl || `https://www.youtube.com/watch?v=${youtubeVideoId}`,
      title: merged.title || merged.Title || "Untitled",
      album: merged.album || merged.Album || "",
      isrc: merged.isrc || merged.ISRC || "",
      publishedAt: merged.youtubeShortPublishedAt || merged.youtubePublishedAt || merged.publishedAt || "",
      scheduledFor: merged.scheduledFor || "",
      template: merged.template || "",
      variantRole: merged.variantRole || "",
      variantLabel: merged.variantLabel || "",
      visualSourceStatus: merged.visualSourceStatus || "",
      visualSourceName: merged.visualSourceName || "",
      visualSourceUrl: merged.visualSourceUrl || "",
      visualSourceCreator: merged.visualSourceCreator || "",
      visualSourceLicense: merged.visualSourceLicense || "",
      visualSearchTerms: merged.visualSearchTerms || "",
      visualThemeBasis: merged.visualThemeBasis || "",
      albumTheme: merged.albumTheme || "",
      albumThemeMood: merged.albumThemeMood || "",
      albumThemeStyle: merged.albumThemeStyle || "",
      albumThemeScene: merged.albumThemeScene || "",
      albumThemeInstruments: merged.albumThemeInstruments || "",
      albumThemeSearchTerms: merged.albumThemeSearchTerms || "",
      descriptionMode: merged.descriptionMode || "",
      descriptionModeLabel: merged.descriptionModeLabel || "",
      shortType: merged.shortType || "",
      shortTypeLabel: merged.shortTypeLabel || ""
    });
  };

  const ledger = await loadPublishLedger();
  for (const entry of Object.values(ledger.items || {})) {
    const platform = String(entry.platform || "");
    const entryProfile = entry.profileId ? normalizeProfileId(entry.profileId) : DEFAULT_PROFILE_ID;
    if (entryProfile !== profileId) continue;
    if (platform === "youtube-shorts" || platform === "youtube-video") add(entry, platform, "published-ledger.json");
  }

  if (!existsSync(runDir)) return [...byVideoId.values()];
  const files = (await readdir(runDir).catch(() => []))
    .filter((file) => (file.startsWith("published-due-") || file.startsWith("published-all-due-") || file.startsWith("startup-publish-")) && file.endsWith(".json"))
    .sort();
  for (const file of files) {
    const parsed = JSON.parse((await readFile(join(runDir, file), "utf8")).replace(/^\uFEFF/, ""));
    const runProfile = parsed.profileId ? normalizeProfileId(parsed.profileId) : DEFAULT_PROFILE_ID;
    if (runProfile !== profileId) continue;
    for (const item of Array.isArray(parsed.items) ? parsed.items : []) {
      if (item.youtubeShortVideoId || item.youtubeShortUrl || item.youtubeShortPublishStatus === "published") add(item, "youtube-shorts", file);
      if (item.youtubeVideoId || item.youtubeUrl || item.youtubePublishStatus === "published") add(item, "youtube-video", file);
    }
    for (const item of Array.isArray(parsed.youtubeVideoItems) ? parsed.youtubeVideoItems : []) {
      if (item.youtubeVideoId || item.youtubeUrl || item.youtubePublishStatus === "published") add(item, "youtube-video", file);
    }
  }
  return [...byVideoId.values()];
}

async function performanceMetadataItems(profileId = DEFAULT_PROFILE_ID) {
  const [reelPlan, youtubePlan] = await Promise.all([
    loadPostingPlan(profileId).catch(() => ({ items: [] })),
    loadYouTubeVideoPlan(profileId).catch(() => ({ items: [] }))
  ]);
  return [...(reelPlan.items || []), ...(youtubePlan.items || [])].map(compactPerformanceRecord);
}

function compactPerformanceRecord(record = {}) {
  const output = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (value === "" || value == null) continue;
    if (Array.isArray(value) && !value.length) continue;
    if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) continue;
    output[key] = value;
  }
  return output;
}

function findPerformanceMetadata(items = [], item = {}, youtubeVideoId = "") {
  const itemId = normalizeKey(item.id || item.ID || "");
  const itemIsrc = normalizeKey(item.isrc || item.ISRC || "");
  const itemTitleAlbum = normalizeKey(`${item.title || item.Title || ""}|${item.album || item.Album || ""}`);
  const itemVideo = normalizeKey(item.video || item.Video || "");
  const videoId = normalizeKey(youtubeVideoId || item.youtubeVideoId || item.youtubeShortVideoId || item.youtubeUrl || item.youtubeShortUrl || "");
  return items.find((candidate) => {
    const candidateId = normalizeKey(candidate.id || candidate.ID || "");
    const candidateIsrc = normalizeKey(candidate.isrc || candidate.ISRC || "");
    const candidateTitleAlbum = normalizeKey(`${candidate.title || candidate.Title || ""}|${candidate.album || candidate.Album || ""}`);
    const candidateVideo = normalizeKey(candidate.video || candidate.Video || "");
    const candidateVideoId = normalizeKey(candidate.youtubeVideoId || candidate.youtubeShortVideoId || candidate.youtubeUrl || candidate.youtubeShortUrl || "");
    return Boolean(
      (videoId && candidateVideoId && videoId === candidateVideoId)
      || (itemId && candidateId && itemId === candidateId)
      || (itemIsrc && candidateIsrc && itemIsrc === candidateIsrc)
      || (itemVideo && candidateVideo && itemVideo === candidateVideo)
      || (itemTitleAlbum && candidateTitleAlbum && itemTitleAlbum === candidateTitleAlbum)
    );
  }) || {};
}

function extractYouTubeVideoId(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[a-zA-Z0-9_-]{6,}$/.test(text) && !/^https?:/i.test(text)) return text;
  try {
    const url = new URL(text);
    if (url.hostname.includes("youtu.be")) return url.pathname.replace(/^\//, "");
    if (url.searchParams.get("v")) return url.searchParams.get("v") || "";
    const match = url.pathname.match(/\/(?:shorts|embed|live)\/([^/?#]+)/i);
    return match?.[1] || "";
  } catch {
    return "";
  }
}

function youtubePerformanceItem(item = {}, apiItem = {}) {
  const stats = apiItem.statistics || {};
  const snippet = apiItem.snippet || {};
  const publishedAt = item.publishedAt || snippet.publishedAt || "";
  const ageDays = publishedAt ? Math.max(1 / 24, (Date.now() - new Date(publishedAt).getTime()) / 86400000) : 1;
  const views = Number(stats.viewCount || 0);
  const contentFormat = youtubePerformanceContentFormat(item);
  const creativeSource = youtubePerformanceCreativeSource(item);
  return {
    youtubeVideoId: item.youtubeVideoId,
    youtubeUrl: item.youtubeUrl || `https://www.youtube.com/watch?v=${item.youtubeVideoId}`,
    platform: item.platform || "",
    contentFormat,
    creativeSource,
    title: item.title || snippet.title || "Untitled",
    album: item.album || "",
    isrc: item.isrc || "",
    publishedAt,
    scheduledFor: item.scheduledFor || "",
    views,
    likes: Number(stats.likeCount || 0),
    comments: Number(stats.commentCount || 0),
    viewsPerDay: Math.round((views / ageDays) * 10) / 10,
    likeRate: views ? Math.round((Number(stats.likeCount || 0) / views) * 1000) / 10 : 0,
    template: item.template || "",
    variantRole: item.variantRole || "",
    variantLabel: item.variantLabel || "",
    visualSourceStatus: item.visualSourceStatus || "",
    visualSourceName: item.visualSourceName || "",
    visualSourceUrl: item.visualSourceUrl || "",
    visualSourceCreator: item.visualSourceCreator || "",
    visualSourceLicense: item.visualSourceLicense || "",
    visualSearchTerms: item.visualSearchTerms || "",
    visualThemeBasis: item.visualThemeBasis || "",
    pexelsSearchTerms: item.albumThemeSearchTerms || item.visualSearchTerms || "",
    pexelsSourceUrl: item.visualSourceUrl || item.visualSourceName || "",
    albumTheme: item.albumTheme || "",
    albumThemeMood: item.albumThemeMood || "",
    albumThemeStyle: item.albumThemeStyle || "",
    albumThemeScene: item.albumThemeScene || "",
    albumThemeInstruments: item.albumThemeInstruments || "",
    albumThemeSearchTerms: item.albumThemeSearchTerms || "",
    descriptionMode: item.descriptionMode || "",
    descriptionModeLabel: item.descriptionModeLabel || "",
    shortType: item.shortType || "",
    shortTypeLabel: item.shortTypeLabel || ""
  };
}

function youtubePerformanceContentFormat(item = {}) {
  const platform = String(item.platform || "").toLowerCase();
  const template = String(item.template || item.Template || "").toLowerCase();
  if (template.includes("youtube-full-album")) return "YouTube full album";
  if (template.includes("youtube-full-track")) return "YouTube full track";
  if (platform === "youtube-shorts") return "YouTube Short";
  if (platform === "youtube-video") return "YouTube full video";
  return "YouTube upload";
}

function youtubePerformanceCreativeSource(item = {}) {
  const template = String(item.template || item.Template || "").toLowerCase();
  const visualStatus = String(item.visualSourceStatus || "").toLowerCase();
  const variant = String(item.variantRole || item.variantLabel || "").toLowerCase();
  if (template.includes("youtube-full-album")) return "Full album render";
  if (template.includes("youtube-full-track")) return "Full track render";
  if (visualStatus.includes("pexels") || visualStatus.includes("saved-approved-source") || item.visualSourceUrl || item.visualAssetPath) return "Pexels/stock atmosphere";
  if (variant.includes("artwork") || visualStatus.includes("artwork") || template.includes("spectrum") || template.includes("visualiser")) return "Artwork visualiser";
  if (variant.includes("atmosphere")) return "Atmosphere video";
  return "Unlabelled creative";
}

function youtubePerformanceInsights(items = []) {
  const sorted = [...items].sort((a, b) => b.views - a.views);
  const totalViews = items.reduce((sum, item) => sum + Number(item.views || 0), 0);
  const avgViews = items.length ? Math.round(totalViews / items.length) : 0;
  const latestUploadWarning = youtubeLatestUploadWarning(items, avgViews);
  return {
    totalVideos: items.length,
    totalViews,
    averageViews: avgViews,
    topVideos: sorted.slice(0, 8),
    byPlatform: aggregatePerformance(items, "platform"),
    byContentFormat: aggregatePerformance(items, "contentFormat"),
    byCreativeSource: aggregatePerformance(items, "creativeSource"),
    byAlbum: aggregatePerformance(items, "album").slice(0, 10),
    byVisual: aggregatePerformance(items, "variantRole").slice(0, 10),
    byShortType: aggregatePerformance(items, "shortTypeLabel").slice(0, 10),
    byDescriptionMode: aggregatePerformance(items, "descriptionModeLabel").slice(0, 10),
    byPexelsTerm: aggregateTermsPerformance(items, "pexelsSearchTerms").slice(0, 12),
    byPexelsSource: aggregatePerformance(items, "pexelsSourceUrl").slice(0, 10),
    byStyle: aggregatePerformance(items, "albumThemeStyle").slice(0, 10),
    byInstrument: aggregatePerformance(items, "albumThemeInstruments").slice(0, 10),
    latestUploadWarning,
    recommendations: youtubePerformanceRecommendations(items, avgViews, latestUploadWarning)
  };
}

function aggregatePerformance(items = [], key = "") {
  const groups = new Map();
  items.forEach((item) => {
    const label = String(item[key] || "Unknown").trim() || "Unknown";
    const group = groups.get(label) || { label, count: 0, views: 0, likes: 0, comments: 0, averageViews: 0 };
    group.count += 1;
    group.views += Number(item.views || 0);
    group.likes += Number(item.likes || 0);
    group.comments += Number(item.comments || 0);
    group.averageViews = Math.round(group.views / group.count);
    groups.set(label, group);
  });
  return [...groups.values()].sort((a, b) => b.averageViews - a.averageViews);
}

function aggregateTermsPerformance(items = [], key = "") {
  const exploded = [];
  for (const item of items) {
    const terms = uniqueTextValues(String(item[key] || "").split(/\||,|;/)).slice(0, 8);
    for (const term of terms) {
      exploded.push({ ...item, [key]: term });
    }
  }
  return aggregatePerformance(exploded, key);
}

function youtubeLatestUploadWarning(items = [], averageViews = 0) {
  const now = Date.now();
  const latest = items
    .filter((item) => item.publishedAt)
    .sort((a, b) => new Date(b.publishedAt || 0).getTime() - new Date(a.publishedAt || 0).getTime())
    .slice(0, 6);
  if (!latest.length) return null;

  const oldEnough = latest.filter((item) => now - new Date(item.publishedAt || 0).getTime() >= 3 * 60 * 60 * 1000);
  const weakThreshold = Math.max(5, Math.round(Number(averageViews || 0) * 0.08));
  const weak = oldEnough.filter((item) => Number(item.views || 0) <= weakThreshold);
  const clusters = new Map();
  latest.forEach((item) => {
    const publishedAt = new Date(item.publishedAt || 0);
    if (Number.isNaN(publishedAt.getTime())) return;
    const bucket = Math.floor(publishedAt.getTime() / (20 * 60 * 1000));
    const key = `${normalizeKey(item.title || "")}|${bucket}`;
    const row = clusters.get(key) || { title: item.title || "Untitled", count: 0 };
    row.count += 1;
    clusters.set(key, row);
  });
  const clustered = [...clusters.values()].find((row) => row.count >= 2);

  if (weak.length >= 3) {
    return {
      level: "warning",
      message: `${weak.length} of the latest ${latest.length} YouTube uploads are still at ${weakThreshold} views or fewer after 3+ hours. Pause broad posting, check title/visual match, and favour the best-performing live/stock visual style before the next batch.`
    };
  }
  if (clustered) {
    return {
      level: "warning",
      message: `${clustered.count} recent YouTube uploads for "${clustered.title}" landed close together. Space same-track Shorts and full videos out so one weak cluster does not eat the day's attention.`
    };
  }
  return null;
}

function youtubePerformanceRecommendations(items = [], averageViews = 0, latestUploadWarning = null) {
  if (!items.length) return ["Sync YouTube stats after your next few uploads to start building recommendations."];
  const visual = aggregatePerformance(items, "variantRole").find((item) => item.label !== "Unknown");
  const creativeSource = aggregatePerformance(items, "creativeSource").find((item) => item.label !== "Unknown");
  const style = aggregatePerformance(items, "albumThemeStyle").find((item) => item.label !== "Unknown");
  const term = aggregateTermsPerformance(items, "pexelsSearchTerms").find((item) => item.label !== "Unknown");
  const album = aggregatePerformance(items, "album").find((item) => item.label !== "Unknown");
  const notes = [];
  if (latestUploadWarning?.message) notes.push(latestUploadWarning.message);
  if (creativeSource) notes.push(`${creativeSource.label} is your strongest creative source so far, averaging ${creativeSource.averageViews} views.`);
  if (visual) notes.push(`Lean into ${visual.label}: it is averaging ${visual.averageViews} views across ${visual.count} upload${visual.count === 1 ? "" : "s"}.`);
  if (style) notes.push(`Test more ${style.label} packaging: it is currently the strongest style group in the local data.`);
  if (term) notes.push(`The strongest visual search cue is "${term.label}", averaging ${term.averageViews} views.`);
  if (album) notes.push(`${album.label} is your strongest album cluster so far with ${album.averageViews} average views.`);
  const low = items.filter((item) => item.views < Math.max(50, averageViews * 0.6)).length;
  if (low) notes.push(`${low} upload${low === 1 ? "" : "s"} are below the local average; use them to identify weak visuals/titles rather than simply posting more.`);
  return notes.slice(0, 5);
}

function uniqueTextValues(...values) {
  const seen = new Set();
  const output = [];
  values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .flatMap((value) => String(value || "").split(/[,;|]/))
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => {
      const key = normalizeKey(value);
      if (!seen.has(key)) {
        seen.add(key);
        output.push(value);
      }
    });
  return output;
}

async function cleanupUnusedR2Uploads(payload = {}) {
  const missing = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_PUBLIC_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((key) => !env[key]);
  if (missing.length) {
    return { ok: false, message: `Missing R2 setting${missing.length === 1 ? "" : "s"} in .env: ${missing.join(", ")}` };
  }

  const dryRun = payload.dryRun !== false;
  const knownItems = [
    ...(Array.isArray(payload.items) ? payload.items : []),
    ...(Array.isArray(payload.youtubeVideoItems) ? payload.youtubeVideoItems : []),
    ...(await loadPostingPlan()).items,
    ...(await loadYouTubeVideoPlan()).items
  ];
  const ledger = await loadPublishLedger();
  const usedKeys = new Set();
  for (const item of knownItems) {
    for (const key of r2KeysFromItem(item)) usedKeys.add(key);
  }
  for (const entry of Object.values(ledger.items || {})) {
    for (const key of r2KeysFromItem(entry)) usedKeys.add(key);
  }

  const objects = await listR2Objects("reels/");
  const candidates = objects
    .filter((item) => item.key.startsWith("reels/") && item.key.toLowerCase().endsWith(".mp4"))
    .filter((item) => !usedKeys.has(item.key));

  const deleted = [];
  if (!dryRun && candidates.length) {
    for (let index = 0; index < candidates.length; index += 1000) {
      const batch = candidates.slice(index, index + 1000);
      const result = await deleteR2Objects(batch.map((item) => item.key));
      deleted.push(...result.deleted);
    }
  }

  return {
    ok: true,
    dryRun,
    message: dryRun
      ? `Found ${candidates.length} unused R2 upload${candidates.length === 1 ? "" : "s"} that can be deleted.`
      : `Deleted ${deleted.length} unused R2 upload${deleted.length === 1 ? "" : "s"}.`,
    totalObjects: objects.length,
    usedCount: usedKeys.size,
    unusedCount: candidates.length,
    deletedCount: deleted.length,
    unused: candidates.slice(0, 200),
    deleted: deleted.slice(0, 200)
  };
}

async function clearPublishingHistory() {
  if (!existsSync(runDir)) {
    return { ok: true, message: "No local publishing history found to clear.", removedCount: 0 };
  }

  const files = await readdir(runDir).catch(() => []);
  const historyPatterns = [
    /^published-ledger\.json$/i,
    /^published-due-.*\.json$/i,
    /^published-all-due-.*\.json$/i,
    /^startup-publish-.*\.json$/i
  ];
  const removed = [];
  for (const file of files) {
    if (!historyPatterns.some((pattern) => pattern.test(file))) continue;
    await rm(join(runDir, file), { force: true }).then(() => removed.push(file)).catch(() => {});
  }

  return {
    ok: true,
    message: `Cleared ${removed.length} local publishing history file${removed.length === 1 ? "" : "s"}. Live posts were not deleted.`,
    removedCount: removed.length,
    removed
  };
}

function addHistoryFromPlanItem(byKey, item = {}, sourceRun = "", checkedAt = "") {
  if (item.status === "posted" || item.publishStatus === "published" || item.instagramMediaId) {
    const publishedAt = item.instagramPublishedAt || item.publishedAt || "";
    addHistoryPlatform(byKey, {
      ...item,
      platform: "instagram-reel",
      publishedAt,
      instagramMediaId: item.instagramMediaId || ""
    }, sourceRun);
  }
  if (item.facebookPublishStatus === "published" || item.facebookMediaId) {
    const publishedAt = item.facebookPublishedAt || "";
    addHistoryPlatform(byKey, {
      ...item,
      platform: "facebook-page",
      publishedAt,
      facebookMediaId: item.facebookMediaId || ""
    }, sourceRun);
  }
  if (item.youtubeShortVideoId || item.youtubeShortUrl || item.youtubeShortPublishStatus === "published") {
    const publishedAt = item.youtubeShortPublishedAt || item.youtubeShortUploadedAt || "";
    addHistoryPlatform(byKey, {
      ...item,
      platform: "youtube-shorts",
      publishedAt,
      youtubeVideoId: item.youtubeShortVideoId || "",
      youtubeUrl: item.youtubeShortUrl || ""
    }, sourceRun);
  }
  if (item.youtubeVideoId || item.youtubeUrl || item.youtubePublishStatus === "published") {
    const publishedAt = item.youtubePublishedAt || "";
    addHistoryPlatform(byKey, {
      ...item,
      platform: "youtube-video",
      publishedAt,
      youtubeVideoId: item.youtubeVideoId || "",
      youtubeUrl: item.youtubeUrl || ""
    }, sourceRun);
  }
}

function addHistoryPlatform(byKey, entry = {}, sourceRun = "") {
  const platform = entry.platform || "instagram-reel";
  const key = historyCampaignKey(entry);
  const existing = byKey.get(key) || {
    id: entry.id || "",
    title: entry.title || "Untitled",
    album: entry.album || "Unknown album",
    isrc: entry.isrc || entry.ISRC || "",
    scheduledFor: entry.scheduledFor || "",
    video: entry.video || "",
    publicVideoUrl: entry.publicVideoUrl || "",
    preview: entry.preview || "",
    artwork: entry.artwork || "",
    audio: entry.audio || "",
    caption: entry.caption || "",
    hashtags: entry.hashtags || "",
    template: entry.template || "",
    variantRole: entry.variantRole || "",
    variantLabel: entry.variantLabel || "",
    visualSourceStatus: entry.visualSourceStatus || "",
    visualSourceName: entry.visualSourceName || "",
    visualSourceUrl: entry.visualSourceUrl || "",
    visualSourceLicense: entry.visualSourceLicense || "",
    visualSearchTerms: entry.visualSearchTerms || "",
    albumTheme: entry.albumTheme || "",
    albumThemeMood: entry.albumThemeMood || "",
    albumThemeStyle: entry.albumThemeStyle || "",
    albumThemeScene: entry.albumThemeScene || "",
    albumThemeInstruments: entry.albumThemeInstruments || "",
    platforms: [],
    platformLabels: [],
    sourceRuns: [],
    lastSeenAt: "",
    lastPublishedAt: ""
  };

  const publishedAt = entry.publishedAt || "";
  if (!existing.platforms.includes(platform)) existing.platforms.push(platform);
  if (sourceRun && !existing.sourceRuns.includes(sourceRun)) existing.sourceRuns.push(sourceRun);
  existing.platformLabels = existing.platforms.map(platformLabel);
  existing.lastSeenAt = publishedAt || existing.lastSeenAt;
  existing.lastPublishedAt = latestIso(existing.lastPublishedAt, publishedAt);
  existing.instagramDone = existing.platforms.includes("instagram-reel");
  existing.facebookDone = existing.platforms.includes("facebook-page");
  existing.youtubeShortsDone = existing.platforms.includes("youtube-shorts");
  existing.youtubeVideoDone = existing.platforms.includes("youtube-video");
  existing.instagramMediaId = entry.instagramMediaId || existing.instagramMediaId || "";
  existing.facebookMediaId = entry.facebookMediaId || existing.facebookMediaId || "";
  existing.youtubeVideoId = entry.youtubeVideoId || existing.youtubeVideoId || "";
  existing.youtubeUrl = entry.youtubeUrl || existing.youtubeUrl || "";
  existing.preview = entry.preview || existing.preview || "";
  existing.artwork = entry.artwork || existing.artwork || "";
  existing.audio = entry.audio || existing.audio || "";
  existing.caption = entry.caption || existing.caption || "";
  existing.hashtags = entry.hashtags || existing.hashtags || "";
  existing.template = entry.template || existing.template || "";
  existing.variantRole = entry.variantRole || existing.variantRole || "";
  existing.variantLabel = entry.variantLabel || existing.variantLabel || "";
  existing.visualSourceStatus = entry.visualSourceStatus || existing.visualSourceStatus || "";
  existing.visualSourceName = entry.visualSourceName || existing.visualSourceName || "";
  existing.visualSourceUrl = entry.visualSourceUrl || existing.visualSourceUrl || "";
  existing.visualSourceLicense = entry.visualSourceLicense || existing.visualSourceLicense || "";
  existing.visualSearchTerms = entry.visualSearchTerms || existing.visualSearchTerms || "";
  existing.albumTheme = entry.albumTheme || existing.albumTheme || "";
  existing.albumThemeMood = entry.albumThemeMood || existing.albumThemeMood || "";
  existing.albumThemeStyle = entry.albumThemeStyle || existing.albumThemeStyle || "";
  existing.albumThemeScene = entry.albumThemeScene || existing.albumThemeScene || "";
  existing.albumThemeInstruments = entry.albumThemeInstruments || existing.albumThemeInstruments || "";
  byKey.set(key, existing);
}

function historyCampaignKey(item = {}) {
  const identity = item.id || item.isrc || item.ISRC || item.title || "unknown";
  const date = String(item.scheduledFor || item.publishedAt || "").slice(0, 10) || "unscheduled";
  return `${identity}|${date}`.toLowerCase();
}

function platformLabel(platform = "") {
  if (platform === "instagram-reel") return "Instagram";
  if (platform === "facebook-page") return "Facebook";
  if (platform === "youtube-shorts") return "YouTube Shorts";
  if (platform === "youtube-video") return "YouTube";
  return platform || "Unknown";
}

function latestIso(first = "", second = "") {
  if (!first) return second || "";
  if (!second) return first || "";
  return new Date(second).getTime() > new Date(first).getTime() ? second : first;
}

function r2KeysFromItem(item = {}) {
  const keys = [];
  for (const value of [item.publicVideoUrl, item.PublicVideoUrl, item.videoUrl, item.VideoUrl]) {
    const key = r2KeyFromPublicUrl(value);
    if (key) keys.push(key);
  }
  return keys;
}

function r2KeyFromPublicUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  const publicBase = String(env.R2_PUBLIC_URL || "").replace(/\/$/, "");
  try {
    if (publicBase && text.startsWith(`${publicBase}/`)) {
      return decodeURIComponent(text.slice(publicBase.length + 1));
    }
    const parsed = new URL(text);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    return "";
  }
}

async function listR2Objects(prefix = "reels/") {
  const objects = [];
  let continuationToken = "";
  do {
    const query = {
      "list-type": "2",
      prefix,
      ...(continuationToken ? { "continuation-token": continuationToken } : {})
    };
    const response = await r2SignedRequest({ method: "GET", query });
    const body = await response.text();
    if (!response.ok) throw new Error(`R2 list failed ${response.status}: ${body.slice(0, 500)}`);
    objects.push(...parseR2ListObjects(body));
    continuationToken = xmlText(body, "NextContinuationToken");
  } while (continuationToken);
  return objects;
}

async function deleteR2Objects(keys = []) {
  if (!keys.length) return { deleted: [] };
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Delete>",
    ...keys.map((key) => `<Object><Key>${xmlEscape(key)}</Key></Object>`),
    "<Quiet>true</Quiet>",
    "</Delete>"
  ].join("");
  const response = await r2SignedRequest({
    method: "POST",
    query: { delete: "" },
    body,
    contentType: "application/xml"
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`R2 delete failed ${response.status}: ${text.slice(0, 500)}`);
  return { deleted: keys };
}

async function r2SignedRequest({ method = "GET", query = {}, body = "", contentType = "" } = {}) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/${env.R2_BUCKET}`;
  const now = new Date();
  const amzDate = isoAmz(now);
  const dateStamp = amzDate.slice(0, 8);
  const payload = body || "";
  const payloadHash = hashHex(payload);
  const queryString = canonicalQuery(query);
  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(contentType ? { "content-type": contentType } : {})
  };
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name]}\n`).join("");
  const canonicalRequest = [
    method,
    encodeR2Path(path),
    queryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    hashHex(canonicalRequest)
  ].join("\n");
  const signingKey = getR2SigningKey(env.R2_SECRET_ACCESS_KEY, dateStamp, "auto", "s3");
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ");
  return fetch(`https://${host}${path}${queryString ? `?${queryString}` : ""}`, {
    method,
    headers: { ...headers, authorization },
    ...(method === "GET" ? {} : { body: payload })
  });
}

function parseR2ListObjects(xml = "") {
  const objects = [];
  const matches = xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
  for (const match of matches) {
    objects.push({
      key: xmlUnescape(xmlText(match[1], "Key")),
      size: Number(xmlText(match[1], "Size")) || 0,
      lastModified: xmlText(match[1], "LastModified")
    });
  }
  return objects;
}

function xmlText(xml = "", tag = "") {
  const match = String(xml).match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? xmlUnescape(match[1]) : "";
}

function xmlEscape(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xmlUnescape(value = "") {
  return String(value).replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function canonicalQuery(query = {}) {
  return Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeR2Query(key)}=${encodeR2Query(value)}`)
    .join("&");
}

function encodeR2Path(path = "") {
  return String(path).split("/").map((part) => encodeURIComponent(part)).join("/");
}

function encodeR2Query(value = "") {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getR2SigningKey(secret, dateStamp, region, service) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function isoAmz(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
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
  const scheduledTask = await scheduledTaskStatus("Maja Coffee Jazz Daily Publisher");
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
    installed: Boolean(scheduledTask.exists || (startupPath && existsSync(startupPath))),
    scheduledTask,
    backgroundInstalled: Boolean(scheduledTask.exists),
    startupFallbackInstalled: Boolean(startupPath && existsSync(startupPath)),
    dashboardInstalled: Boolean(dashboardStartupPath && existsSync(dashboardStartupPath)),
    startupPath,
    dashboardStartupPath,
    latestLog: latestLog ? join(runDir, latestLog) : "",
    latestRunAt,
    latest
  };
}

async function scheduledTaskStatus(taskName) {
  const escapedTaskName = String(taskName || "").replace(/'/g, "''");
  const command = `
$task = Get-ScheduledTask -TaskName '${escapedTaskName}' -ErrorAction SilentlyContinue
if (-not $task) {
  [pscustomobject]@{ exists = $false } | ConvertTo-Json -Compress
  exit 0
}
$info = Get-ScheduledTaskInfo -TaskName '${escapedTaskName}' -ErrorAction SilentlyContinue
$triggers = @($task.Triggers | ForEach-Object { $_.ToString() })
[pscustomobject]@{
  exists = $true
  taskName = $task.TaskName
  state = [string]$task.State
  lastRunTime = if ($info -and $info.LastRunTime) { $info.LastRunTime.ToString('o') } else { '' }
  nextRunTime = if ($info -and $info.NextRunTime) { $info.NextRunTime.ToString('o') } else { '' }
  lastTaskResult = if ($info) { [int]$info.LastTaskResult } else { $null }
  triggerCount = $triggers.Count
  triggers = $triggers
} | ConvertTo-Json -Compress
`;

  try {
    const result = await runPowerShell(["-NoProfile", "-Command", command]);
    const raw = String(result.stdout || "").trim();
    return raw ? JSON.parse(raw) : { exists: false };
  } catch (error) {
    return {
      exists: false,
      error: error.message || "Could not read Windows Scheduled Task status."
    };
  }
}

async function runStartupScript(action) {
  const script = action === "uninstall" ? "uninstall-startup-publisher.ps1" : "install-startup-publisher.ps1";
  const result = await runPowerShell([
    "-ExecutionPolicy", "Bypass",
    "-File", join(schedulerDir, script)
  ]);
  return {
    ok: true,
    message: action === "uninstall"
      ? "Background publisher removed."
      : "Background publisher installed. It checks after login and then roughly every 3 hours while you are signed in.",
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    status: await startupPublisherStatus()
  };
}

async function runStartupPublisherTest() {
  const result = await publishAllDueFromSavedPlans();
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
  const items = filterSuppressedPublishingItems(payload.items);
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

function isFailedYouTubeFullTrackItem(item = {}) {
  const status = String(item.status || "").toLowerCase();
  const publishStatus = String(item.youtubePublishStatus || item.YouTubePublishStatus || "").toLowerCase();
  return status === "publish-error"
    || publishStatus === "publish-error"
    || Boolean(item.youtubePublishError || item.YouTubePublishError);
}

function isFailedYouTubeShortItem(item = {}) {
  const publishStatus = String(item.youtubeShortPublishStatus || item.YouTubeShortPublishStatus || "").toLowerCase();
  if (["published", "same-track-spacing-held", "daily-cap-held", "artwork-paused"].includes(publishStatus)) return false;
  return publishStatus === "publish-error"
    || publishStatus === "source-error"
    || publishStatus === "missing-video"
    || /failed|error|missing|invalid|expired|revoked|permission|blocked/.test(publishStatus)
    || Boolean(item.youtubeShortPublishError || item.YouTubeShortPublishError);
}

function selectReelsForResend(reels = [], destination = "", limit = 1) {
  const cappedLimit = clamp(Number(limit) || 1, 1, 10);
  if (destination === "youtubeShorts") {
    const failed = reels
      .filter((item) => destinationEnabled(item, "youtubeShorts"))
      .filter(isFailedYouTubeShortItem)
      .sort(sortBySchedule);
    if (failed.length) return failed.slice(0, cappedLimit);

    return reels
      .filter((item) => destinationEnabled(item, "youtubeShorts"))
      .filter((item) => !youtubeShortAlreadyPublished(item, { items: {} }))
      .sort(sortBySchedule)
      .slice(0, cappedLimit);
  }
  return reels.slice(0, cappedLimit);
}

function isResendableYouTubeFullTrackItem(item = {}) {
  const status = String(item.status || "").toLowerCase();
  if (status === "rejected") return false;
  return ["approved", "ready", "scheduled", "posted"].includes(status)
    || String(item.youtubePublishStatus || item.YouTubePublishStatus || "").toLowerCase() === "published"
    || Boolean(item.youtubeVideoId || item.youtubeUrl);
}

async function publishDueContainers(payload = {}) {
  const lock = await acquirePublishLock("meta-publish");
  if (!lock.ok) return lock;
  try {
    return await publishDueContainersUnlocked(payload);
  } finally {
    await lock.release();
  }
}

async function publishDueContainersUnlocked(payload = {}) {
  const items = filterSuppressedPublishingItems(payload.items);
  if (!items.length) {
    return { ok: false, message: "No scheduled container items were sent." };
  }

  const gate = publishingGate(env);
  if (!gate.ok) return { ...gate, items };

  await mkdir(runDir, { recursive: true });
  const now = new Date();
  const force = Boolean(payload.force);
  const resend = Boolean(payload.resend);
  const postingSettings = payload.postingSettings || {};
  const maxPublishesPerDay = DAILY_PLATFORM_LIMITS.metaReels;
  const duplicateCooldownDays = force ? 0 : clamp(Number(postingSettings.postingCooldown) || 90, 0, 1000);
  const updated = [];
  const published = [];
  const skipped = [];
  const skipReasons = [];
  const errors = [];
  const ledger = await loadPublishLedger();
  let ledgerChanged = false;
  let publishedThisRun = 0;
  const alreadyPublishedToday = countLedgerMetaReelsOnDate(ledger, now);
  const profileId = requestProfileId(payload);
  const paths = profilePaths(profileId);

  for (const item of items) {
    const scheduledAt = parseLocalDateTime(item.scheduledFor);
    const status = String(item.status || "").toLowerCase();
    const label = item.title || item.id;
    const wantInstagram = destinationEnabled(item, "instagram");
    const wantFacebook = destinationEnabled(item, "facebook");
    const ledgerKey = publishLedgerKey(item);
    const facebookLedgerKey = `${ledgerKey}|facebook-page`;

    if (!force && (!scheduledAt || scheduledAt > now)) {
      updated.push(item);
      skipped.push(label);
      skipReasons.push({ item: label, reason: scheduledAt ? `not due until ${scheduledAt.toLocaleString()}` : "no scheduled time" });
      continue;
    }

    if (!wantInstagram && !wantFacebook) {
      updated.push(item);
      skipped.push(label);
      skipReasons.push({ item: label, reason: "Instagram and Facebook are unticked for this item" });
      continue;
    }

    if (status !== "posted") {
      const sourceCheck = await validateQueuedSourceMedia(item, paths, { allowRenderedShortArtworkReference: true });
      if (!sourceCheck.ok) {
        updated.push({
          ...item,
          publishStatus: sourceCheck.status || "source-error",
          publishError: sourceCheck.message
        });
        skipped.push(label);
        skipReasons.push({ item: label, reason: sourceCheck.message });
        continue;
      }
    }

    const ledgerHit = ledger.items[ledgerKey];
    if (ledgerHit && !resend) {
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

      if (wantFacebook && !facebookLedgerHit) {
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
        skipReasons.push({ item: label, reason: wantFacebook ? "already published to Instagram and Facebook" : "already published to selected Meta destinations" });
      }

      updated.push(postedItem);
      continue;
    }

    if (!wantInstagram && wantFacebook) {
      const facebookResult = await publishFacebookPageVideo(item);
      if (facebookResult.ok) {
        const postedItem = {
          ...item,
          facebookPublishStatus: "published",
          facebookPublishedAt: new Date().toISOString(),
          facebookMediaId: facebookResult.mediaId || ""
        };
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
        publishedThisRun += 1;
        published.push(`${label} Facebook Page`);
        updated.push(postedItem);
      } else {
        updated.push({ ...item, facebookPublishStatus: "publish-error", facebookPublishError: facebookResult.reason });
        errors.push({ item: label, step: "facebook-page", reason: facebookResult.reason });
      }
      continue;
    }

    if ((alreadyPublishedToday + publishedThisRun) >= maxPublishesPerDay) {
      updated.push(item);
      skipped.push(label);
      skipReasons.push({ item: label, reason: `daily Meta/Instagram cap reached (${maxPublishesPerDay} Reel per day)` });
      continue;
    }

    const recentDuplicate = findRecentPublishedDuplicate(ledger, item, duplicateCooldownDays, now);
    if (recentDuplicate) {
      updated.push({ ...item, publishStatus: "cooldown-held", publishError: recentDuplicate.reason });
      skipped.push(label);
      skipReasons.push({ item: label, reason: recentDuplicate.reason });
      continue;
    }

    if (!resend && (status === "posted" || item.publishStatus === "published")) {
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
        publishError: "",
        publishedAt: new Date().toISOString(),
        instagramMediaId: result.body?.id || ""
      };

      if (wantFacebook) {
        facebookResult = await publishFacebookPageVideo(postedItem);
      }
      if (wantFacebook && facebookResult.ok) {
        postedItem.facebookPublishStatus = "published";
        postedItem.facebookPublishedAt = new Date().toISOString();
        postedItem.facebookMediaId = facebookResult.mediaId || "";
      } else if (wantFacebook) {
        postedItem.facebookPublishStatus = "publish-error";
        postedItem.facebookPublishError = facebookResult.reason;
        errors.push({ item: label, step: "facebook-page", reason: facebookResult.reason });
      } else {
        postedItem.facebookPublishStatus = "skipped";
      }

      updated.push(postedItem);
      published.push(postedItem.title || postedItem.id);
      publishedThisRun += 1;
      ledger.items[ledgerKey] = {
        id: postedItem.id || "",
        title: postedItem.title || "",
        isrc: postedItem.isrc || postedItem.ISRC || "",
        scheduledFor: postedItem.scheduledFor || "",
        platform: "instagram-reel",
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

function youtubeVideoLedgerHit(ledger, item = {}, profileId = DEFAULT_PROFILE_ID) {
  const direct = ledger.items?.[publishLedgerKey({ ...item, platform: "youtube-video" })];
  if (direct) return direct;

  const itemId = normalizeKey(item.id || item.ID || "");
  const itemIsrc = normalizeKey(item.isrc || item.ISRC || "");
  const itemTitleAlbum = normalizeKey(`${item.title || item.Title || ""}|${item.album || item.Album || ""}`);
  const itemVideo = resolveSafe(item.video || item.Video || "").toLowerCase();
  const itemTemplate = normalizeKey(item.template || item.Template || "");
  const itemProfile = normalizeProfileId(profileId || item.profileSourceProfileId || item.ProfileSourceProfileId || DEFAULT_PROFILE_ID);

  for (const entry of Object.values(ledger.items || {})) {
    if (String(entry.platform || "") !== "youtube-video") continue;
    const entryProfile = entry.profileId ? normalizeProfileId(entry.profileId) : itemProfile;
    if (entryProfile !== itemProfile) continue;

    const sameVideo = itemVideo && resolveSafe(entry.video || "").toLowerCase() === itemVideo;
    const sameId = itemId && normalizeKey(entry.id || "") === itemId;
    const sameIsrc = itemIsrc && normalizeKey(entry.isrc || "") === itemIsrc;
    const sameTitleAlbum = itemTitleAlbum && normalizeKey(`${entry.title || ""}|${entry.album || ""}`) === itemTitleAlbum;
    const sameLegacyTitle = normalizeKey(item.title || item.Title || "")
      && normalizeKey(entry.title || "") === normalizeKey(item.title || item.Title || "")
      && !entry.album
      && !entry.video;
    const sameTemplate = !itemTemplate || !entry.template || normalizeKey(entry.template || "") === itemTemplate;
    if (sameVideo || sameId || sameIsrc || (sameTitleAlbum && sameTemplate) || (sameLegacyTitle && sameTemplate)) return entry;
  }

  return null;
}

function findRecentPublishedDuplicate(ledger, item, cooldownDays, now = new Date()) {
  if (!cooldownDays) return null;
  const title = normalizeKey(item.title || "");
  const isrc = normalizeKey(item.isrc || item.ISRC || "");
  const id = normalizeKey(item.id || "");
  if (!title && !isrc && !id) return null;

  const cutoff = now.getTime() - cooldownDays * 86400000;
  for (const entry of Object.values(ledger.items || {})) {
    const platform = String(entry.platform || "");
    if (!platform.startsWith("instagram") && platform !== "facebook-page") continue;
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
    const platform = String(entry.platform || "");
    if (!platform.startsWith("instagram") && platform !== "facebook-page") continue;
    if (!entry.publishedAt) continue;
    if (localDateKey(new Date(entry.publishedAt)) === target) {
      count += 1;
    }
  }
  return count;
}

function countLedgerMetaReelsOnDate(ledger, date = new Date()) {
  // Daily Meta/Instagram cap resets on the machine's local calendar day at 00:00.
  const target = localDateKey(date);
  let count = 0;
  for (const entry of Object.values(ledger.items || {})) {
    const platform = String(entry.platform || "");
    const hasInstagramPublish = platform.startsWith("instagram") || Boolean(entry.instagramMediaId);
    if (!hasInstagramPublish || !entry.publishedAt) continue;
    if (localDateKey(new Date(entry.publishedAt)) === target) {
      count += 1;
    }
  }
  return count;
}

function countLedgerPlatformPublishesOnDate(ledger, platformName = "", date = new Date()) {
  const target = localDateKey(date);
  let count = 0;
  for (const entry of Object.values(ledger.items || {})) {
    const platform = String(entry.platform || "");
    if (platform !== platformName) continue;
    if (!entry.publishedAt) continue;
    if (localDateKey(new Date(entry.publishedAt)) === target) {
      count += 1;
    }
  }
  return count;
}

function countArtworkShortPublishesOnDate(ledger, date = new Date()) {
  const target = localDateKey(date);
  let count = 0;
  for (const entry of Object.values(ledger.items || {})) {
    if (String(entry.platform || "") !== "youtube-shorts") continue;
    if (!entry.publishedAt) continue;
    if (localDateKey(new Date(entry.publishedAt)) !== target) continue;
    if (isArtworkVisualiserItem(entry)) count += 1;
  }
  return count;
}

function youtubeShortAlreadyPublished(item = {}, ledger = { items: {} }) {
  if (item.youtubeShortVideoId || item.youtubeShortUrl) return true;
  if (String(item.youtubeShortPublishStatus || "").toLowerCase() === "published") return true;
  return Boolean(ledger.items?.[publishLedgerKey({ ...item, platform: "youtube-shorts" })]);
}

function isArtworkVisualiserItem(item = {}) {
  const text = [
    item.template,
    item.Template,
    item.variantRole,
    item.variantLabel,
    item.visualSourceStatus,
    item.visualSourceName,
    item.shortType,
    item.shortTypeLabel
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /artwork|visualiser|visualizer|spectrum|local-artwork-derived/.test(text);
}

function youtubeSameTrackSpacingHit(ledger = { items: {} }, item = {}, now = new Date(), options = {}) {
  const spacingHours = clamp(Number(options.spacingHours) || YOUTUBE_SAME_TRACK_SPACING_HOURS, 1, 168);
  const profileId = options.profileId ? normalizeProfileId(options.profileId) : "";
  const platforms = new Set(options.platforms || ["youtube-shorts", "youtube-video"]);
  const cutoff = now.getTime() - spacingHours * 60 * 60 * 1000;
  let latestHit = null;

  for (const entry of Object.values(ledger.items || {})) {
    if (!platforms.has(String(entry.platform || ""))) continue;
    if (profileId && entry.profileId && normalizeProfileId(entry.profileId) !== profileId) continue;
    const publishedAt = new Date(entry.publishedAt || 0);
    const publishedMs = publishedAt.getTime();
    if (!publishedMs || publishedMs < cutoff) continue;
    if (!sameCampaignItem(entry, item)) continue;
    if (!latestHit || publishedMs > latestHit.publishedAt.getTime()) {
      latestHit = { entry, publishedAt };
    }
  }

  if (!latestHit) return null;
  const nextAllowedAt = new Date(latestHit.publishedAt.getTime() + spacingHours * 60 * 60 * 1000);
  return {
    entry: latestHit.entry,
    publishedAt: latestHit.publishedAt,
    nextAllowedAt,
    reason: `same track was posted to YouTube recently; moved to ${formatLocalSchedule(toLocalDateTimeValue(nextAllowedAt))}`
  };
}

function youtubeSameTrackRunHit(publishedItems = [], item = {}, now = new Date(), options = {}) {
  const spacingHours = clamp(Number(options.spacingHours) || YOUTUBE_SAME_TRACK_SPACING_HOURS, 1, 168);
  const hit = publishedItems.find((publishedItem) => sameCampaignItem(publishedItem, item));
  if (!hit) return null;
  const publishedAt = parseLocalDateTime(hit.youtubeShortPublishedAt || hit.youtubePublishedAt || hit.publishedAt) || now;
  const nextAllowedAt = new Date(Math.max(now.getTime(), publishedAt.getTime()) + spacingHours * 60 * 60 * 1000);
  return {
    entry: hit,
    publishedAt,
    nextAllowedAt,
    reason: `same track already posted in this run; moved to ${formatLocalSchedule(toLocalDateTimeValue(nextAllowedAt))}`
  };
}

function holdYoutubeItemForSpacing(item = {}, hit = {}, statusField = "youtubePublishStatus", errorField = "youtubePublishError") {
  const nextScheduledFor = toLocalDateTimeValue(hit.nextAllowedAt || new Date(Date.now() + YOUTUBE_SAME_TRACK_SPACING_HOURS * 60 * 60 * 1000));
  return {
    ...item,
    scheduledFor: nextScheduledFor,
    publishStatus: "same-track-spacing-held",
    [statusField]: "same-track-spacing-held",
    [errorField]: hit.reason || `Same-track YouTube spacing moved this upload to ${formatLocalSchedule(nextScheduledFor)}.`,
    scheduleNote: `${item.scheduleNote || ""} Same-track YouTube spacing moved this upload to ${formatLocalSchedule(nextScheduledFor)}.`.trim()
  };
}

function nextAvailableUnpublishedShort(items = [], ledger = { items: {} }, now = new Date()) {
  const next = items
    .filter((item) => destinationEnabled(item, "youtubeShorts"))
    .filter((item) => !isDueNow(item, now))
    .filter((item) => parseLocalDateTime(item.scheduledFor))
    .filter((item) => !youtubeShortAlreadyPublished(item, ledger))
    .sort((a, b) => {
      const artworkRank = Number(isArtworkVisualiserItem(a)) - Number(isArtworkVisualiserItem(b));
      if (artworkRank) return artworkRank;
      return sortBySchedule(a, b);
    })[0];
  if (!next) return null;
  const previousSchedule = next.scheduledFor || "";
  return {
    ...next,
    scheduledFor: toLocalDateTimeValue(now),
    publishStatus: "daily-fill-due-now",
    scheduleNote: `${next.scheduleNote || ""} Moved forward from ${formatLocalSchedule(previousSchedule)} to fill today's remaining YouTube Shorts slot.`.trim()
  };
}

async function publishDueYouTubeShorts(items = [], options = {}) {
  const updated = [];
  const published = [];
  const publishedItems = [];
  const skipped = [];
  const errors = [];
  const ledger = await loadPublishLedger();
  let ledgerChanged = false;
  const resend = Boolean(options.resend);
  const now = options.now instanceof Date ? options.now : new Date();
  const sameTrackSpacingHours = clamp(Number(options.sameTrackSpacingHours) || YOUTUBE_SAME_TRACK_SPACING_HOURS, 1, 168);
  const artworkShortDailyLimit = Number.isFinite(Number(options.artworkShortDailyLimit))
    ? clamp(Number(options.artworkShortDailyLimit), 0, 3)
    : YOUTUBE_ARTWORK_SHORT_DAILY_LIMIT;
  const dailyLimit = DAILY_PLATFORM_LIMITS.youtubeShorts;
  const alreadyPublishedToday = countLedgerPlatformPublishesOnDate(ledger, "youtube-shorts", now);
  let artworkShortsPublishedToday = countArtworkShortPublishesOnDate(ledger, now);
  const profileId = requestProfileId(options);
  const paths = profilePaths(profileId);

  for (const item of items) {
    const label = item.title || item.id || "Untitled Short";
    if (!destinationEnabled(item, "youtubeShorts")) {
      updated.push(item);
      skipped.push({ item: label, reason: "YouTube Shorts is unticked for this item" });
      continue;
    }
    const key = publishLedgerKey({ ...item, platform: "youtube-shorts" });
    const ledgerHit = ledger.items[key];
    if (!resend && (ledgerHit || item.youtubeShortVideoId || item.youtubeShortUrl)) {
      updated.push({
        ...item,
        youtubeShortPublishStatus: "published",
        youtubeShortVideoId: item.youtubeShortVideoId || ledgerHit?.youtubeVideoId || "",
        youtubeShortUrl: item.youtubeShortUrl || ledgerHit?.youtubeUrl || "",
        youtubeShortPublishedAt: item.youtubeShortPublishedAt || ledgerHit?.publishedAt || ""
      });
      skipped.push({ item: label, reason: "already uploaded to YouTube Shorts" });
      continue;
    }

    if ((alreadyPublishedToday + published.length) >= dailyLimit) {
      updated.push({
        ...item,
        youtubeShortPublishStatus: "daily-cap-held",
        youtubeShortPublishError: `Daily YouTube Shorts cap reached (${dailyLimit} per day).`
      });
      skipped.push({ item: label, reason: `daily YouTube Shorts cap reached (${dailyLimit} per day)` });
      continue;
    }

    if (!resend && isArtworkVisualiserItem(item) && artworkShortsPublishedToday >= artworkShortDailyLimit) {
      const destinations = { ...readDestinations(item), youtubeShorts: false };
      updated.push({
        ...item,
        destinations,
        youtubeShortPublishStatus: "artwork-paused",
        youtubeShortPublishError: "Artwork visualiser Shorts are paused/reduced because recent performance was weak. Use stock/Pexels variants for automatic Shorts posting.",
        scheduleNote: `${item.scheduleNote || ""} Artwork visualiser held back from automatic YouTube Shorts posting.`.trim()
      });
      skipped.push({ item: label, reason: "artwork visualiser Shorts are paused/reduced for automatic posting" });
      continue;
    }

    if (!resend) {
      const sameTrackHit = youtubeSameTrackRunHit(publishedItems, item, now, { spacingHours: sameTrackSpacingHours })
        || youtubeSameTrackSpacingHit(ledger, item, now, { profileId, spacingHours: sameTrackSpacingHours });
      if (sameTrackHit) {
        const heldItem = holdYoutubeItemForSpacing(item, sameTrackHit, "youtubeShortPublishStatus", "youtubeShortPublishError");
        updated.push(heldItem);
        skipped.push({ item: label, reason: sameTrackHit.reason });
        continue;
      }
    }

    if (!item.video || !existsSync(resolve(String(item.video)))) {
      updated.push({ ...item, youtubeShortPublishStatus: "missing-video" });
      skipped.push({ item: label, reason: "local Short MP4 not found" });
      continue;
    }

    const sourceCheck = await validateQueuedSourceMedia(item, paths, { allowRenderedShortArtworkReference: true });
    if (!sourceCheck.ok) {
      updated.push({
        ...item,
        youtubeShortPublishStatus: sourceCheck.status || "source-error",
        youtubeShortPublishError: sourceCheck.message
      });
      errors.push({ item: label, reason: sourceCheck.message });
      continue;
    }

    const result = await uploadYouTubeVideoPayload({
      confirmUpload: true,
      videoPath: item.video,
      title: youtubeShortTitle(item),
      description: youtubeShortDescription(item),
      privacy: options.privacy || "public",
      madeForKids: false,
      tags: youtubeShortTags(item)
    }, { shorts: true });

    if (result.ok) {
      const postedItem = {
        ...item,
        youtubeShortPublishStatus: "published",
        youtubeShortPublishError: "",
        youtubeShortVideoId: result.videoId || "",
        youtubeShortUrl: result.url || "",
        youtubeShortPublishedAt: new Date().toISOString()
      };
      ledger.items[key] = {
        id: postedItem.id || "",
        title: postedItem.title || "",
        album: postedItem.album || postedItem.Album || "",
        isrc: postedItem.isrc || postedItem.ISRC || "",
        video: postedItem.video || postedItem.Video || "",
        template: postedItem.template || postedItem.Template || "",
        profileId,
        scheduledFor: postedItem.scheduledFor || "",
        platform: "youtube-shorts",
        publishedAt: postedItem.youtubeShortPublishedAt,
        youtubeVideoId: postedItem.youtubeShortVideoId,
        youtubeUrl: postedItem.youtubeShortUrl,
        variantRole: postedItem.variantRole || "",
        variantLabel: postedItem.variantLabel || "",
        visualSourceStatus: postedItem.visualSourceStatus || "",
        visualSourceName: postedItem.visualSourceName || "",
        visualSourceUrl: postedItem.visualSourceUrl || "",
        visualSourceCreator: postedItem.visualSourceCreator || "",
        visualSourceLicense: postedItem.visualSourceLicense || "",
        visualSearchTerms: postedItem.visualSearchTerms || "",
        visualThemeBasis: postedItem.visualThemeBasis || "",
        albumTheme: postedItem.albumTheme || "",
        albumThemeMood: postedItem.albumThemeMood || "",
        albumThemeStyle: postedItem.albumThemeStyle || "",
        albumThemeScene: postedItem.albumThemeScene || "",
        albumThemeInstruments: postedItem.albumThemeInstruments || "",
        albumThemeSearchTerms: postedItem.albumThemeSearchTerms || "",
        descriptionMode: postedItem.descriptionMode || "",
        descriptionModeLabel: postedItem.descriptionModeLabel || "",
        shortType: postedItem.shortType || "",
        shortTypeLabel: postedItem.shortTypeLabel || ""
      };
      ledgerChanged = true;
      updated.push(postedItem);
      published.push(label);
      publishedItems.push(postedItem);
      if (isArtworkVisualiserItem(postedItem)) artworkShortsPublishedToday += 1;
    } else {
      updated.push({
        ...item,
        youtubeShortPublishStatus: "publish-error",
        youtubeShortPublishError: result.message || "YouTube Shorts upload failed."
      });
      errors.push({ item: label, reason: result.message || "YouTube Shorts upload failed." });
    }
  }

  if (ledgerChanged) await savePublishLedger(ledger);
  const firstError = errors[0]?.reason
    ? ` First error: ${errors[0].item || "selected Short"} - ${errors[0].reason}.`
    : "";
  return {
    ok: errors.length === 0,
    message: `YouTube Shorts: published ${published.length}, skipped ${skipped.length}${errors.length ? `, failed ${errors.length}.${firstError}` : "."}`,
    publishedCount: published.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    published,
    skipped,
    errors,
    items: updated
  };
}

async function publishDueYouTubeVideos(items = [], options = {}) {
  const updated = [];
  const published = [];
  const publishedItems = [];
  const skipped = [];
  const errors = [];
  const ledger = await loadPublishLedger();
  let ledgerChanged = false;
  const resend = Boolean(options.resend);
  const now = options.now instanceof Date ? options.now : new Date();
  const sameTrackSpacingHours = clamp(Number(options.sameTrackSpacingHours) || YOUTUBE_SAME_TRACK_SPACING_HOURS, 1, 168);
  const profileId = requestProfileId(options);
  const ignoreDailyLimit = Boolean(options.ignoreDailyLimit);
  const dailyLimit = DAILY_PLATFORM_LIMITS.youtubeVideos;
  const alreadyPublishedToday = countLedgerPlatformPublishesOnDate(ledger, "youtube-video", now);

  for (const item of items) {
    const label = item.title || item.id || "Untitled YouTube video";
    if (!destinationEnabled(item, "youtubeVideo")) {
      updated.push(item);
      skipped.push({ item: label, reason: "YouTube full video is unticked for this item" });
      continue;
    }
    const status = String(item.status || "").toLowerCase();
    let key = publishLedgerKey({ ...item, platform: "youtube-video" });
    let ledgerHit = youtubeVideoLedgerHit(ledger, item, profileId);
    if (!resend && !["approved", "ready", "scheduled"].includes(status)) {
      updated.push(item);
      skipped.push({ item: label, reason: "not approved for YouTube upload" });
      continue;
    }
    if (!resend && (ledgerHit || item.youtubeVideoId || item.youtubeUrl || status === "posted")) {
      updated.push({
        ...item,
        status: "posted",
        youtubeVideoId: item.youtubeVideoId || ledgerHit?.youtubeVideoId || "",
        youtubeUrl: item.youtubeUrl || ledgerHit?.youtubeUrl || "",
        youtubePublishedAt: item.youtubePublishedAt || ledgerHit?.publishedAt || ""
      });
      skipped.push({ item: label, reason: "already uploaded to YouTube" });
      continue;
    }

    if (!ignoreDailyLimit && (alreadyPublishedToday + published.length) >= dailyLimit) {
      updated.push({
        ...item,
        youtubePublishStatus: "daily-cap-held",
        youtubePublishError: `Daily YouTube full-video cap reached (${dailyLimit} per day).`
      });
      skipped.push({ item: label, reason: `daily YouTube full-video cap reached (${dailyLimit} per day)` });
      continue;
    }

    if (!resend) {
      const sameTrackHit = youtubeSameTrackRunHit(publishedItems, item, now, { spacingHours: sameTrackSpacingHours })
        || youtubeSameTrackSpacingHit(ledger, item, now, { profileId, spacingHours: sameTrackSpacingHours });
      if (sameTrackHit) {
        const heldItem = holdYoutubeItemForSpacing(item, sameTrackHit, "youtubePublishStatus", "youtubePublishError");
        updated.push(heldItem);
        skipped.push({ item: label, reason: sameTrackHit.reason });
        continue;
      }
    }

    const tokenCheck = await checkYouTubeUploadToken();
    if (!tokenCheck.ok) {
      updated.push({
        ...item,
        youtubePublishStatus: "publish-error",
        youtubePublishError: tokenCheck.message
      });
      errors.push({ item: label, reason: tokenCheck.message });
      continue;
    }

    let uploadItem = item;
    const uploadTemplate = String(uploadItem.template || uploadItem.Template || "").toLowerCase();
    const isAlbumCompilation = uploadTemplate === "youtube-full-album";
    if (isAlbumCompilation) {
      const sourceProfile = String(uploadItem.profileSourceProfileId || "");
      if (uploadItem.profileSourceLocked !== true || sourceProfile !== profileId) {
        const reason = "Blocked YouTube album upload: this album compilation was not rendered for the active profile.";
        updated.push({
          ...item,
          youtubePublishStatus: "source-error",
          youtubePublishError: reason
        });
        errors.push({ item: label, reason });
        continue;
      }
    } else {
      const sourceCheck = await resolveProfileYouTubeSourceItem(uploadItem, profilePaths(profileId));
      if (!sourceCheck.ok) {
        updated.push({
          ...item,
          youtubePublishStatus: "source-error",
          youtubePublishError: sourceCheck.message
        });
        errors.push({ item: label, reason: sourceCheck.message });
        continue;
      }
      const canonicalSource = sourceCheck.item;
      const mediaCheck = await validateQueuedSourceMedia(canonicalSource, profilePaths(profileId));
      if (!mediaCheck.ok) {
        updated.push({
          ...item,
          youtubePublishStatus: mediaCheck.status || "source-error",
          youtubePublishError: mediaCheck.message
        });
        errors.push({ item: label, reason: mediaCheck.message });
        continue;
      }
      const sourceLocked = uploadItem.profileSourceLocked === true && String(uploadItem.profileSourceProfileId || "") === profileId;
      const audioMatchesProfile = resolveSafe(uploadItem.audio || uploadItem.Audio || "").toLowerCase() === resolveSafe(canonicalSource.audio || "").toLowerCase();
      const artworkMatchesProfile = resolveSafe(uploadItem.artwork || uploadItem.Artwork || "").toLowerCase() === resolveSafe(canonicalSource.artwork || "").toLowerCase();
      if (!sourceLocked || !audioMatchesProfile || !artworkMatchesProfile) {
        uploadItem = {
          ...uploadItem,
          ...canonicalSource,
          video: "",
          preview: canonicalSource.artwork || uploadItem.preview || uploadItem.Preview || "",
          template: "",
          durationSeconds: 0
        };
      }
    }
    const fullTrackCheck = validateYouTubeFullTrackUpload(uploadItem);
    if (!fullTrackCheck.ok && canAutoRenderYouTubeFullTrack(uploadItem)) {
      const renderResult = await renderYouTubeFullTrackForItem(uploadItem, options);
      if (renderResult.ok) {
        uploadItem = renderResult.item;
      } else {
        updated.push({
          ...item,
          youtubePublishStatus: "render-error",
          youtubePublishError: renderResult.message || "Could not create the full-track YouTube render."
        });
        errors.push({ item: label, reason: renderResult.message || "Could not create the full-track YouTube render." });
        continue;
      }
    }
    const finalFullTrackCheck = validateYouTubeFullTrackUpload(uploadItem);
    if (!finalFullTrackCheck.ok) {
      updated.push({
        ...item,
        youtubePublishStatus: "validation-error",
        youtubePublishError: finalFullTrackCheck.message
      });
      errors.push({ item: label, reason: finalFullTrackCheck.message });
      continue;
    }
    key = publishLedgerKey({ ...uploadItem, platform: "youtube-video" });
    ledgerHit = youtubeVideoLedgerHit(ledger, uploadItem, profileId);
    if (!resend && ledgerHit) {
      updated.push({
        ...uploadItem,
        status: "posted",
        youtubePublishStatus: "published",
        youtubeVideoId: ledgerHit.youtubeVideoId || "",
        youtubeUrl: ledgerHit.youtubeUrl || "",
        youtubePublishedAt: ledgerHit.publishedAt || ""
      });
      skipped.push({ item: label, reason: "already uploaded to YouTube" });
      continue;
    }

    if (!uploadItem.video || !existsSync(resolve(String(uploadItem.video)))) {
      updated.push({ ...uploadItem, youtubePublishStatus: "missing-video" });
      skipped.push({ item: label, reason: "local YouTube video MP4 not found" });
      continue;
    }

    const result = await uploadYouTubeVideoPayload({
      confirmUpload: true,
      videoPath: uploadItem.video,
      template: uploadItem.template || uploadItem.Template || "",
      durationSeconds: uploadItem.durationSeconds || uploadItem.DurationSeconds || 0,
      audio: uploadItem.audio || uploadItem.Audio || "",
      title: uploadItem.title || "Coffee Jazz Full Track",
      description: appendYouTubeProfileLinks(uploadItem.caption || "A full-length instrumental jazz track for background listening, focus, or a slower evening."),
      privacy: options.privacy || "public",
      madeForKids: false,
      tags: ["coffee jazz", "jazz", "instrumental music", "background music"]
    }, { shorts: false });

    if (result.ok) {
      const postedItem = {
        ...uploadItem,
        status: "posted",
        youtubePublishStatus: "published",
        youtubeVideoId: result.videoId || "",
        youtubeUrl: result.url || "",
        youtubePublishedAt: new Date().toISOString()
      };
      ledger.items[key] = {
        id: postedItem.id || "",
        title: postedItem.title || "",
        album: postedItem.album || postedItem.Album || "",
        isrc: postedItem.isrc || postedItem.ISRC || "",
        video: postedItem.video || postedItem.Video || "",
        template: postedItem.template || postedItem.Template || "",
        profileId,
        scheduledFor: postedItem.scheduledFor || "",
        platform: "youtube-video",
        publishedAt: postedItem.youtubePublishedAt,
        youtubeVideoId: postedItem.youtubeVideoId,
        youtubeUrl: postedItem.youtubeUrl,
        variantRole: postedItem.variantRole || "",
        variantLabel: postedItem.variantLabel || "",
        visualSourceStatus: postedItem.visualSourceStatus || "",
        visualSourceName: postedItem.visualSourceName || "",
        visualSourceUrl: postedItem.visualSourceUrl || "",
        visualSourceCreator: postedItem.visualSourceCreator || "",
        visualSourceLicense: postedItem.visualSourceLicense || "",
        visualSearchTerms: postedItem.visualSearchTerms || "",
        visualThemeBasis: postedItem.visualThemeBasis || "",
        albumTheme: postedItem.albumTheme || "",
        albumThemeMood: postedItem.albumThemeMood || "",
        albumThemeStyle: postedItem.albumThemeStyle || "",
        albumThemeScene: postedItem.albumThemeScene || "",
        albumThemeInstruments: postedItem.albumThemeInstruments || "",
        albumThemeSearchTerms: postedItem.albumThemeSearchTerms || "",
        descriptionMode: postedItem.descriptionMode || "",
        descriptionModeLabel: postedItem.descriptionModeLabel || "",
        shortType: postedItem.shortType || "",
        shortTypeLabel: postedItem.shortTypeLabel || ""
      };
      ledgerChanged = true;
      updated.push(postedItem);
      published.push(label);
      publishedItems.push(postedItem);
    } else {
      updated.push({
        ...item,
        youtubePublishStatus: "publish-error",
        youtubePublishError: result.message || "YouTube upload failed."
      });
      errors.push({ item: label, reason: result.message || "YouTube upload failed." });
    }
  }

  if (ledgerChanged) await savePublishLedger(ledger);
  const firstError = errors[0]?.reason
    ? ` First error: ${errors[0].item || "selected video"} - ${errors[0].reason}.`
    : "";
  return {
    ok: errors.length === 0,
    message: `YouTube full videos: published ${published.length}, skipped ${skipped.length}${errors.length ? `, failed ${errors.length}.${firstError}` : "."}`,
    publishedCount: published.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    published,
    skipped,
    errors,
    items: updated
  };
}

function planCatchUpReels(dueReels = [], options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const force = Boolean(options.force);
  const dailyLimit = force
    ? dueReels.length
    : clamp(Number(options.dailyLimit) || 1, 1, 10);

  if (force || dueReels.length <= 1) {
    return {
      selected: dueReels.slice(0, dailyLimit),
      held: dueReels.slice(dailyLimit),
      rescheduled: []
    };
  }

  const orderedDueReels = [...dueReels].sort((a, b) => {
    const artworkRank = Number(isArtworkVisualiserItem(a)) - Number(isArtworkVisualiserItem(b));
    if (artworkRank) return artworkRank;
    return sortBySchedule(a, b);
  });
  const selected = orderedDueReels.slice(0, 1);
  const heldSource = dueReels.filter((item) => !selected.some((selectedItem) => publishMergeKey(selectedItem) === publishMergeKey(item)));
  const scheduleTimes = normalizeScheduleTimes(options.postingSettings?.shortScheduleTimes);
  const occupiedSlots = buildOccupiedScheduleSlots(options.scheduleItems || [], selected);
  let cursor = latestScheduledDate(options.scheduleItems || [], now);
  const rescheduled = heldSource.map((item) => {
    const scheduledAt = nextAvailableScheduleSlot(cursor, scheduleTimes, occupiedSlots);
    cursor = scheduledAt;
    occupiedSlots.add(toLocalDateTimeValue(scheduledAt));
    return {
      ...item,
      scheduledFor: toLocalDateTimeValue(scheduledAt),
      publishStatus: item.publishStatus === "published" ? item.publishStatus : "rescheduled-tail",
      scheduleNote: `Moved to the end of the schedule because multiple uploads were due at once.`
    };
  });

  return {
    selected,
    held: rescheduled,
    rescheduled
  };
}

function getDailyShortFillPolicy(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const postingSettings = options.postingSettings || {};
  const dailyLimit = clamp(Number(options.dailyLimit) || DAILY_PLATFORM_LIMITS.youtubeShorts, 1, DAILY_PLATFORM_LIMITS.youtubeShorts);
  const alreadyPublishedToday = clamp(Number(options.alreadyPublishedToday) || 0, 0, dailyLimit);
  const minimumLateDayShorts = Math.min(
    dailyLimit,
    clamp(Number(postingSettings.minimumLateDayShorts) || 2, 1, dailyLimit)
  );

  if (alreadyPublishedToday >= dailyLimit) {
    return {
      shouldFill: false,
      reason: `the daily YouTube Shorts cap is already reached (${alreadyPublishedToday}/${dailyLimit}).`,
      minimumLateDayShorts
    };
  }

  const scheduleTimes = normalizeScheduleTimes(postingSettings.shortScheduleTimes);
  const firstSlot = scheduleDateForTime(now, scheduleTimes[0]);
  const lastSlot = scheduleDateForTime(now, scheduleTimes[scheduleTimes.length - 1]);
  const graceMinutes = clamp(Number(postingSettings.lateShortFillGraceMinutes) || 60, 0, 360);
  const lateFillStartsAt = new Date(lastSlot.getTime() + graceMinutes * 60 * 1000);

  if (alreadyPublishedToday === 0 && now >= firstSlot) {
    return {
      shouldFill: true,
      reason: `no Shorts had posted today and the first Short slot (${scheduleTimes[0]}) has passed.`,
      minimumLateDayShorts,
      lateFillStartsAt: toLocalDateTimeValue(lateFillStartsAt)
    };
  }

  if (alreadyPublishedToday < minimumLateDayShorts && now >= lateFillStartsAt) {
    return {
      shouldFill: true,
      reason: `only ${alreadyPublishedToday}/${minimumLateDayShorts} minimum late-day Shorts had posted after the final Short slot (${scheduleTimes[scheduleTimes.length - 1]}).`,
      minimumLateDayShorts,
      lateFillStartsAt: toLocalDateTimeValue(lateFillStartsAt)
    };
  }

  return {
    shouldFill: false,
    reason: alreadyPublishedToday < minimumLateDayShorts
      ? `waiting until ${formatLocalSchedule(toLocalDateTimeValue(lateFillStartsAt))} before filling toward the ${minimumLateDayShorts}-Short late-day minimum.`
      : `the late-day minimum is already satisfied (${alreadyPublishedToday}/${minimumLateDayShorts}).`,
    minimumLateDayShorts,
    lateFillStartsAt: toLocalDateTimeValue(lateFillStartsAt)
  };
}

function scheduleDateForTime(baseDate, time = "06:00") {
  const [hour, minute] = String(time || "06:00").split(":").map(Number);
  const scheduled = new Date(baseDate);
  scheduled.setHours(
    Number.isFinite(hour) ? Math.max(0, Math.min(23, hour)) : 6,
    Number.isFinite(minute) ? Math.max(0, Math.min(59, minute)) : 0,
    0,
    0
  );
  return scheduled;
}

function normalizeScheduleTimes(value) {
  const raw = Array.isArray(value) && value.length ? value : ["06:00", "11:00", "16:00"];
  const normalized = raw
    .map((entry) => String(entry || "").trim())
    .map((entry) => {
      const match = entry.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) return "";
      const hour = Math.max(0, Math.min(23, Number(match[1]) || 0));
      const minute = Math.max(0, Math.min(59, Number(match[2]) || 0));
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    })
    .filter(Boolean);
  return [...new Set(normalized)].sort();
}

function buildOccupiedScheduleSlots(items = [], excluding = []) {
  const excludedKeys = new Set(excluding.map((item) => publishMergeKey(item)));
  const occupied = new Set();
  for (const item of items) {
    if (excludedKeys.has(publishMergeKey(item))) continue;
    const scheduledAt = parseLocalDateTime(item.scheduledFor);
    if (scheduledAt) occupied.add(toLocalDateTimeValue(scheduledAt));
  }
  return occupied;
}

function latestScheduledDate(items = [], fallback = new Date()) {
  let latest = fallback;
  for (const item of items) {
    const scheduledAt = parseLocalDateTime(item.scheduledFor);
    if (scheduledAt && scheduledAt > latest) latest = scheduledAt;
  }
  return latest;
}

function nextAvailableScheduleSlot(afterDate, scheduleTimes = ["06:00", "11:00", "16:00"], occupiedSlots = new Set()) {
  const times = scheduleTimes.length ? scheduleTimes : ["06:00", "11:00", "16:00"];
  const cursor = afterDate instanceof Date && !Number.isNaN(afterDate.getTime()) ? afterDate : new Date();
  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    for (const time of times) {
      const [hour, minute] = time.split(":").map(Number);
      const candidate = new Date(cursor);
      candidate.setDate(cursor.getDate() + dayOffset);
      candidate.setHours(hour, minute, 0, 0);
      const key = toLocalDateTimeValue(candidate);
      if (candidate > cursor && !occupiedSlots.has(key)) return candidate;
    }
  }
  const fallback = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  fallback.setHours(6, 0, 0, 0);
  return fallback;
}

function localDateKey(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toLocalDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatLocalSchedule(value = "") {
  const parsed = parseLocalDateTime(value);
  if (!parsed) return value || "later";
  return parsed.toLocaleString();
}

function isDueNow(item, now = new Date()) {
  const scheduledAt = parseLocalDateTime(item.scheduledFor);
  return Boolean(scheduledAt && scheduledAt <= now);
}

function isActivePublishingPlanItem(item = {}) {
  const status = String(item.status || "").toLowerCase();
  const publishStatus = String(item.publishStatus || item.youtubePublishStatus || "").toLowerCase();
  if (["posted", "published", "rejected", "held"].includes(status)) return false;
  if (["published", "held"].includes(publishStatus)) return false;
  return true;
}

function sortBySchedule(a, b) {
  return new Date(a.scheduledFor || 0).getTime() - new Date(b.scheduledFor || 0).getTime();
}

function sameCampaignItem(a = {}, b = {}) {
  const leftId = normalizeKey(a.id || "");
  const rightId = normalizeKey(b.id || "");
  const leftIsrc = normalizeKey(a.isrc || a.ISRC || "");
  const rightIsrc = normalizeKey(b.isrc || b.ISRC || "");
  const leftVideo = normalizeKey(a.video || a.Video || "");
  const rightVideo = normalizeKey(b.video || b.Video || "");
  const leftAudio = normalizeKey(a.audio || a.Audio || "");
  const rightAudio = normalizeKey(b.audio || b.Audio || "");
  const leftTitleAlbum = normalizeKey(`${a.title || a.Title || ""}|${a.album || a.Album || ""}`);
  const rightTitleAlbum = normalizeKey(`${b.title || b.Title || ""}|${b.album || b.Album || ""}`);

  return Boolean(
    (leftId && rightId && leftId === rightId)
    || (leftIsrc && rightIsrc && leftIsrc === rightIsrc)
    || (leftVideo && rightVideo && leftVideo === rightVideo)
    || (leftAudio && rightAudio && leftAudio === rightAudio)
    || (leftTitleAlbum && rightTitleAlbum && leftTitleAlbum === rightTitleAlbum)
  );
}

function itemMatchesRequestedId(item = {}, requested = "") {
  const key = normalizeKey(requested);
  if (!key) return false;
  const directMatch = [
    item.id,
    item.ID,
    item.video,
    item.Video
  ].some((value) => normalizeKey(value || "") === key);
  if (directMatch) return true;
  if (key.startsWith("review ")) return false;

  const titleAlbum = `${item.title || item.Title || ""}|${item.album || item.Album || ""}`;
  return [
    item.isrc,
    item.ISRC,
    item.title,
    item.Title,
    titleAlbum
  ].some((value) => normalizeKey(value || "") === key);
}

function readDestinations(item = {}) {
  const raw = item.destinations || item.Destinations || {};
  let destinations = raw;
  if (typeof raw === "string") {
    try {
      destinations = JSON.parse(raw);
    } catch {
      destinations = {};
    }
  }
  return destinations && typeof destinations === "object" ? destinations : {};
}

function destinationEnabled(item = {}, destination = "") {
  const destinations = readDestinations(item);
  if (!destination) return true;
  if (destination === "youtubeVideo") return destinations.youtubeVideo === true;
  return destinations?.[destination] !== false;
}

async function freshestRenderProgress(progress, startedAt) {
  const startedMs = Date.parse(startedAt || "") || 0;
  const primaryMs = Date.parse(progress?.updatedAt || "") || 0;
  const latestBatchProgressPath = await latestRenderProgressPath(startedMs);
  if (!latestBatchProgressPath) return progress;

  const latestDetails = await stat(latestBatchProgressPath).catch(() => null);
  if (!latestDetails || latestDetails.mtimeMs <= primaryMs + 1000) return progress;

  const batchProgress = await readProgress(latestBatchProgressPath, progress?.message || "Rendering...");
  return {
    ...progress,
    ...batchProgress,
    source: "batch-progress"
  };
}

async function latestRenderProgressPath(startedMs = 0) {
  const renderedDir = join(schedulerDir, "rendered-reels");
  if (!existsSync(renderedDir)) return "";

  const entries = await readdir(renderedDir, { withFileTypes: true }).catch(() => []);
  let latestPath = "";
  let latestTime = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("batch-")) continue;
    const progressPath = join(renderedDir, entry.name, "render-progress.txt");
    if (!existsSync(progressPath)) continue;
    const details = await stat(progressPath).catch(() => null);
    if (!details) continue;
    if (startedMs && details.mtimeMs < startedMs - 5000) continue;
    if (details.mtimeMs > latestTime) {
      latestPath = progressPath;
      latestTime = details.mtimeMs;
    }
  }

  return latestPath;
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
  return latestReviewManifestIn(join(schedulerDir, "rendered-reels"));
}

async function latestReviewManifestIn(renderedDir) {
  if (!existsSync(renderedDir)) return "";
  const manifests = await reviewManifestsIn(renderedDir);
  return manifests[0] || "";
}

async function reviewManifestsIn(renderedDir) {
  if (!existsSync(renderedDir)) return [];
  const entries = await readdir(renderedDir, { withFileTypes: true });
  const manifests = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("batch-")) continue;
    const manifestPath = join(renderedDir, entry.name, "review-manifest.json");
    if (!existsSync(manifestPath)) continue;
    const manifestStat = await stat(manifestPath);
    manifests.push({ path: manifestPath, mtimeMs: manifestStat.mtimeMs });
  }

  return manifests
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .map((entry) => entry.path);
}

async function readReviewManifestRecords(batchFolder) {
  if (!batchFolder) return [];
  const jsonPath = join(batchFolder, "review-manifest.json");
  if (!existsSync(jsonPath)) return [];
  const text = (await readFile(jsonPath, "utf8")).replace(/^\uFEFF/, "");
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function readReviewManifestItems(batchFolder) {
  return readReviewManifestRecords(batchFolder).then(filterPlayableReviewItems);
}

function filterPlayableReviewItems(items = []) {
  return items.filter(isPlayableReviewItem);
}

function isPlayableReviewItem(item = {}) {
  const status = String(item.Status || item.status || "").toLowerCase();
  const video = String(item.Video || item.video || "").trim();
  if (status === "render_failed" || status === "failed" || status === "error") return false;
  if (!video || !/\.mp4$/i.test(video)) return false;
  return existsSync(resolve(video));
}

export async function prepareInstagramReel(payload = {}) {
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

export function publishingGate(envValues = {}) {
  const mode = envValues.PUBLISHING_MODE || "manual";
  if (!LIVE_MODES.has(mode)) {
    return {
      ok: false,
      dryRun: true,
      mode,
      message: "Publishing is disabled. Set PUBLISHING_MODE=test only when approved queue items should be allowed to publish."
    };
  }

  if (envValues.REQUIRE_APPROVAL === "false") {
    return {
      ok: false,
      dryRun: true,
      mode,
      message: "Publishing is blocked because the approval gate is disabled."
    };
  }

  return {
    ok: true,
    dryRun: false,
    mode,
    message: "Publishing is enabled for approved queue items."
  };
}

export function allowedCorsOrigin(origin = "") {
  if (!origin || origin === "null") return "null";

  try {
    const url = new URL(origin);
    const isLocalHost = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const isHttp = url.protocol === "http:" || url.protocol === "https:";
    if (isLocalHost && isHttp) return origin;
  } catch {}

  return "null";
}

function applyCors(response, request) {
  response.setHeader("access-control-allow-origin", allowedCorsOrigin(request.headers.origin));
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("vary", "Origin");
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
    const tokenScopes = tokenDebugScopes(results);
    if (tokenScopes.size) {
      return [
        check("perm_instagram_basic", tokenScopes.has("instagram_basic"), "instagram_basic"),
        check("perm_instagram_content_publish", tokenScopes.has("instagram_content_publish"), "instagram_content_publish"),
        check("perm_pages_show_list", tokenScopes.has("pages_show_list"), "pages_show_list"),
        check("perm_pages_read_engagement", tokenScopes.has("pages_read_engagement"), "pages_read_engagement"),
        check("perm_pages_manage_posts", tokenScopes.has("pages_manage_posts"), "pages_manage_posts")
      ];
    }
    return [
      check("perm_instagram_basic", false, "Not verified"),
      check("perm_instagram_content_publish", false, "Not verified"),
      check("perm_pages_show_list", false, "Not verified"),
      check("perm_pages_read_engagement", false, "Not verified"),
      check("perm_pages_manage_posts", false, "Not verified")
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

function tokenDebugScopes(results = []) {
  const tokenDebug = results.find((item) => item.id === "token_debug" && item.ok);
  const data = tokenDebug?.body?.data || {};
  const scopes = new Set(Array.isArray(data.scopes) ? data.scopes : []);
  if (Array.isArray(data.granular_scopes)) {
    data.granular_scopes.forEach((entry) => {
      if (entry?.scope) scopes.add(entry.scope);
    });
  }
  return scopes;
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
    IG_USER_ID: Boolean(env.IG_USER_ID),
    PEXELS_API_KEY: Boolean(env.PEXELS_API_KEY),
    PIXABAY_API_KEY: Boolean(env.PIXABAY_API_KEY)
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
    env: schedulerChildEnv(),
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 10
  });
}

function schedulerChildEnv() {
  return {
    ...process.env,
    PEXELS_API_KEY: env.PEXELS_API_KEY || process.env.PEXELS_API_KEY || "",
    PIXABAY_API_KEY: env.PIXABAY_API_KEY || process.env.PIXABAY_API_KEY || ""
  };
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

async function scanTopAlbumFolders(audioRoot, artworkRoot = "") {
  const entries = await readdir(audioRoot, { withFileTypes: true });
  const folders = entries.filter((entry) => entry.isDirectory()).map((entry) => join(audioRoot, entry.name));
  const artworkFiles = artworkRoot && existsSync(artworkRoot) ? await listMediaFiles(artworkRoot, IMAGE_EXTENSIONS) : [];
  const artworkIndex = buildArtworkIndex(artworkFiles, artworkRoot || audioRoot);
  const results = [];

  for (const folderPath of folders) {
    const audioFiles = await listMediaFiles(folderPath, AUDIO_EXTENSIONS);
    const localArtwork = await listMediaFiles(folderPath, IMAGE_EXTENSIONS);
    const folderParts = [basename(folderPath)];
    const artwork = localArtwork[0]
      || findArtworkForTrack({ title: basename(folderPath), album: basename(folderPath), folderParts, artworkIndex });
    results.push({
      name: basename(folderPath),
      path: folderPath,
      audioFiles,
      artworkFiles: artwork ? [artwork] : []
    });
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function findMatchingCatalogAlbum(folderName, catalogAlbums) {
  const folderKey = compactKey(folderName);
  for (const album of catalogAlbums) {
    if (compactKey(album) === folderKey) return album;
  }
  return "";
}

function knownAlbumFolderAliases() {
  return new Map([
    ["After Hours at Maja’s", "After Hours at Maja's"],
    ["Background Listening Jazz Album Café Atmospheres", "Café Atmospheres"],
    ["Café da Manhã", "Cafe Da Manha"],
    ["Cinematic  Spaghetti Western Style Jazz Album Dust & Decaf", "Dust & Decaf"],
    ["Enter the Lo-fi Zone Chapter 2", "Enter the Lo-Fi Zone: Chapter 2"],
    ["Field Recording Jazz (with Flutes & Outdoor Sounds) Breeze Over Beans", "Breeze over Beans"],
    ["Free Jazz Album Unfiltered", "Unfiltered"],
    ["Jazz Moments Pt 1", "Maja's Coffee Jazz Moments, Pt. 1"],
    ["Jazz Noir Album Midnight Filter", "Midnight Filter"],
    ["Lounge Harmonics Post Grind", "Lounge Harmonics: Post Grind"],
    ["Midnight Brew Fingerstyle Jazz at Majas", "Midnight Brew: Fingerstyle Jazz at Maja's"],
    ["Neo Soul Jazz Album Velvet Brew", "Velvet Brew"],
    ["On The Breeze", "On the Breeze"],
    ["Post-Bop Album Espresso Conversations", "Espresso Conversations"],
    ["The Hammond File", "The Mike Mckenzie Trio Presents: the Hammond File"]
  ]);
}

function summarizeAddedAlbums(rows) {
  const albums = new Map();
  rows.forEach((row) => {
    const album = row.Album || "Unknown album";
    const current = albums.get(album) || { album, tracks: 0, artwork: row["Artwork URL"] || "", examples: [] };
    current.tracks += 1;
    if (!current.artwork && row["Artwork URL"]) current.artwork = row["Artwork URL"];
    if (current.examples.length < 4) current.examples.push(row.Title || "Untitled");
    albums.set(album, current);
  });
  return [...albums.values()].sort((a, b) => a.album.localeCompare(b.album));
}

function parseCsvRecords(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift() || [];
  const records = rows
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
  return { headers, rows: records };
}

function ensureCatalogHeaders(headers) {
  const required = [
    "Title", "Artist", "Album", "Artwork URL", "Audio file or URL", "Store URL", "Mood", "BPM", "ISRC", "UPC",
    "Release Date", "Year", "Label", "Track Number", "Spotify Artist URL", "SoundCloud URL", "Audio Match Score", "Audio Match Method",
    "Style", "Instruments", "Scene", "Energy", "Length Target", "Album Prompt", "Track Prompt", "Suno Prompt", "Negative Prompt", "Hashtags"
  ];
  const merged = [...headers];
  required.forEach((header) => {
    if (!merged.includes(header)) merged.push(header);
  });
  return merged;
}

async function writeCsvRecords(path, headers, rows) {
  const csv = [
    headers,
    ...rows.map((row) => headers.map((header) => row[header] || ""))
  ].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  await writeFile(path, `${csv}\r\n`, "utf8");
}

function compactKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function resolveSafe(value) {
  try {
    return value ? resolve(String(value)) : "";
  } catch {
    return String(value || "");
  }
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

export async function loadSetup(path) {
  if (!existsSync(path)) return DEFAULT_SETUP;
  return {
    ...DEFAULT_SETUP,
    ...(await loadJson(path))
  };
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

async function updateEnvFile(path, updates = {}) {
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];
  const remaining = { ...updates };
  const next = lines.map((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (!match || !(match[1] in remaining)) return line;
    const key = match[1];
    const value = envFileValue(remaining[key]);
    delete remaining[key];
    return `${key}=${value}`;
  });
  Object.entries(remaining).forEach(([key, value]) => {
    if (next.length && next[next.length - 1] !== "") next.push("");
    next.push(`${key}=${envFileValue(value)}`);
  });
  await writeFile(path, next.join("\r\n"), "utf8");
}

function envFileValue(value) {
  const text = String(value || "");
  return /[\s#"'`]/.test(text) ? `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"` : text;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function options(response) {
  response.writeHead(204);
  response.end();
}

function gracefulShutdown(reason = "shutdown") {
  console.log(`Jazz Scheduler backend shutting down: ${reason}`);
  for (const job of [currentRenderJob, currentYouTubeVideoJob, currentUploadJob, currentPublishJob]) {
    try {
      if (job?.child && !job.child.killed) job.child.kill("SIGTERM");
    } catch {}
  }
  rm(publishLockPath, { force: true }).catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.once("SIGINT", () => gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));

async function main() {
  if (process.argv.includes("--check-readiness")) {
    console.log(JSON.stringify(await readiness(), null, 2));
    return;
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
    return;
  }

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Jazz Scheduler backend listening on http://127.0.0.1:${PORT}`);
  });

  if (parentPid > 0) {
    setInterval(() => {
      try {
        process.kill(parentPid, 0);
      } catch {
        gracefulShutdown("launcher-closed");
      }
    }, 2000).unref();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
