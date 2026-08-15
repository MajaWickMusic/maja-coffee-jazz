const DEFAULT_PROFILE_ID = "majas-coffee-jazz-zone";
const PROFILE_LIST_KEY = "jazzProfiles";
const ACTIVE_PROFILE_KEY = "jazzActiveProfileId";
const DEFAULT_SONG_FACTORY_AUDIO_FOLDERS = {
  [DEFAULT_PROFILE_ID]: "E:\\FL Studio 20\\Data\\MaJaWick Music\\YouTube Topic streaming\\Maja's Coffee Jazz Zone\\Songs"
};
const DEFAULT_PROFILES = [
  {
    id: DEFAULT_PROFILE_ID,
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
];

function safeJsonParse(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeProfileId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || DEFAULT_PROFILE_ID;
}

function normalizeProfile(profile = {}) {
  const name = String(profile.name || profile.label || "Untitled Profile").trim();
  return {
    id: normalizeProfileId(profile.id || name),
    name,
    handle: String(profile.handle || "").trim(),
    description: String(profile.description || "").trim()
  };
}

function loadProfilesFromStorage() {
  const stored = safeJsonParse(localStorage.getItem(PROFILE_LIST_KEY), []);
  const byId = new Map();
  [...DEFAULT_PROFILES, ...(Array.isArray(stored) ? stored : [])]
    .map(normalizeProfile)
    .forEach((profile) => byId.set(profile.id, profile));
  const profiles = [...byId.values()];
  localStorage.setItem(PROFILE_LIST_KEY, JSON.stringify(profiles));
  return profiles;
}

function initialActiveProfileId(profiles) {
  const saved = localStorage.getItem(ACTIVE_PROFILE_KEY);
  if (saved && profiles.some((profile) => profile.id === saved)) return saved;
  localStorage.setItem(ACTIVE_PROFILE_KEY, DEFAULT_PROFILE_ID);
  return DEFAULT_PROFILE_ID;
}

let activeProfileId = initialActiveProfileId(loadProfilesFromStorage());

function profileStorageKey(key, profileId = activeProfileId) {
  return `jazzProfile:${profileId}:${key}`;
}

function profileStorageGet(key, fallback, profileId = activeProfileId) {
  const scoped = localStorage.getItem(profileStorageKey(key, profileId));
  if (scoped != null) return safeJsonParse(scoped, fallback);
  if (profileId === DEFAULT_PROFILE_ID) {
    return safeJsonParse(localStorage.getItem(key), fallback);
  }
  return fallback;
}

function profileStorageSet(key, value) {
  localStorage.setItem(profileStorageKey(key), JSON.stringify(value));
  if (activeProfileId === DEFAULT_PROFILE_ID) {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function profileStorageGetBoolean(key, fallback = false, profileId = activeProfileId) {
  const scoped = localStorage.getItem(profileStorageKey(key, profileId));
  if (scoped != null) return scoped === "true";
  if (profileId === DEFAULT_PROFILE_ID) {
    const legacy = localStorage.getItem(key);
    if (legacy != null) return legacy === "true";
  }
  return fallback;
}

function profileStorageSetBoolean(key, value) {
  localStorage.setItem(profileStorageKey(key), value ? "true" : "false");
  if (activeProfileId === DEFAULT_PROFILE_ID) {
    localStorage.setItem(key, value ? "true" : "false");
  }
}

const state = {
  profiles: loadProfilesFromStorage(),
  activeProfileId,
  tracks: profileStorageGet("jazzTracks", []),
  reviews: profileStorageGet("jazzReviews", []),
  youtubeVideoReviews: profileStorageGet("jazzYouTubeVideoReviews", []),
  albumVideoAlbums: [],
  albumVideoQueues: profileStorageGet("jazzAlbumVideoQueues", {}),
  albumVideoActiveAlbum: profileStorageGet("jazzAlbumVideoActiveAlbum", ""),
  albumVideoItems: profileStorageGet("jazzAlbumVideoItems", []),
  albumVideoStatus: null,
  publishingQueue: profileStorageGet("jazzPublishingQueue", []),
  postingPlan: profileStorageGet("jazzPostingPlan", []),
  songFactoryPlan: profileStorageGet("jazzSongFactoryPlan", null),
  songFactoryPlanHistory: profileStorageGet("jazzSongFactoryPlanHistory", []),
  songFactorySavedAlbum: profileStorageGet("jazzSongFactorySavedAlbum", null),
  songFactoryAlbums: [],
  songFactoryAlbumsProfileId: "",
  songFactoryAlbumsLoading: false,
  publishingHistory: [],
  metaHistory: [],
  tokenHealth: null,
  backendHealth: null,
  startupStatus: null,
  errorLog: profileStorageGet("jazzErrorLog", []),
  userConfigPath: "",
  reviewFilter: "all",
  libraryIssueFilter: "all",
  posting: profileStorageGet("jazzPostingSettings", null),
  instagramSetup: profileStorageGet("jazzInstagramSetup", null),
  youtubeSetup: profileStorageGet("jazzYouTubeSetup", null),
  profileConnection: profileStorageGet("jazzProfileConnection", null),
  youtubeHealth: null,
  youtubePerformance: null,
  youtubePerformanceLoading: false,
  performanceGeneratePreset: profileStorageGet("jazzPerformanceGeneratePreset", null),
  pexelsHealth: null,
  pexelsResults: [],
  setupWizard: profileStorageGet("jazzSetupWizard", null),
  firstRunComplete: profileStorageGetBoolean("jazzFirstRunComplete", false)
};

const backendUrl = "http://127.0.0.1:8787";
const mainViews = new Set(["firstRunSetup", "dashboard", "performance", "posting", "songFactory", "review", "publishingQueue", "albumVideos", "postingPlan", "settingsSetup", "instagramSetup", "youtubeSetup", "visualSources", "helpStatus"]);
const legacyViewRedirects = {
  library: "settingsSetup",
  rules: "posting",
  schedule: "publishingQueue",
  queue: "posting",
  connectors: "settingsSetup",
  youtubeVideos: "publishingQueue"
};
let autoPublisherTimer = null;
let renderPollTimer = null;
let uploadPollTimer = null;
let publishProgressTimer = null;
let publishRetryTimer = null;
let albumVideoPollTimer = null;
let songFactoryConvertPollTimer = null;
let bestPerformanceRefreshTimer = null;
let publishStartedAt = null;
let publishRetryReadyAt = 0;
let publishInFlight = false;

if (!state.firstRunComplete && (state.tracks.length || state.setupWizard?.lastScan)) {
  state.firstRunComplete = true;
  profileStorageSetBoolean("jazzFirstRunComplete", true);
}

const $ = (selector) => document.querySelector(selector);
const on = (selector, event, handler) => {
  const element = $(selector);
  if (element) element.addEventListener(event, handler);
};

function currentProfile() {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}

function renderProfileSelector() {
  const selector = $("#profileSelector");
  const description = $("#profileDescription");
  if (!selector) return;
  selector.innerHTML = state.profiles
    .map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`)
    .join("");
  selector.value = state.activeProfileId;
  const profile = currentProfile();
  if (description) {
    description.textContent = [profile?.handle, profile?.description].filter(Boolean).join(" | ") || "Current artist workspace";
  }
}

function persistActiveProfileState() {
  save();
  state.setupWizard = getSetupWizard();
  state.posting = getPostingSettings();
  state.instagramSetup = getInstagramSetup();
  state.youtubeSetup = getYouTubeSetup();
  state.profileConnection = getProfileWorkspaceSetup();
  profileStorageSet("jazzSetupWizard", state.setupWizard);
  profileStorageSet("jazzPostingSettings", state.posting);
  profileStorageSet("jazzInstagramSetup", state.instagramSetup);
  profileStorageSet("jazzYouTubeSetup", state.youtubeSetup);
  profileStorageSet("jazzProfileConnection", state.profileConnection);
  profileStorageSet("jazzSongFactoryPlan", state.songFactoryPlan);
  profileStorageSet("jazzSongFactoryPlanHistory", state.songFactoryPlanHistory);
  profileStorageSet("jazzSongFactorySavedAlbum", state.songFactorySavedAlbum);
  profileStorageSet("jazzPerformanceGeneratePreset", state.performanceGeneratePreset);
  profileStorageSetBoolean("jazzFirstRunComplete", state.firstRunComplete);
}

function loadProfileState(profileId) {
  activeProfileId = profileId;
  state.activeProfileId = profileId;
  localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
  state.tracks = profileStorageGet("jazzTracks", []);
  state.reviews = profileStorageGet("jazzReviews", []);
  state.youtubeVideoReviews = profileStorageGet("jazzYouTubeVideoReviews", []);
  state.albumVideoQueues = profileStorageGet("jazzAlbumVideoQueues", {});
  state.albumVideoActiveAlbum = profileStorageGet("jazzAlbumVideoActiveAlbum", "");
  state.albumVideoItems = profileStorageGet("jazzAlbumVideoItems", []);
  state.albumVideoAlbums = [];
  state.publishingQueue = profileStorageGet("jazzPublishingQueue", []);
  state.postingPlan = profileStorageGet("jazzPostingPlan", []);
  state.songFactoryPlan = profileStorageGet("jazzSongFactoryPlan", null);
  state.songFactoryPlanHistory = profileStorageGet("jazzSongFactoryPlanHistory", []);
  state.songFactorySavedAlbum = profileStorageGet("jazzSongFactorySavedAlbum", null);
  state.songFactoryAlbums = [];
  state.songFactoryAlbumsProfileId = "";
  state.songFactoryAlbumsLoading = false;
  state.errorLog = profileStorageGet("jazzErrorLog", []);
  state.posting = profileStorageGet("jazzPostingSettings", null);
  state.instagramSetup = profileStorageGet("jazzInstagramSetup", null);
  state.youtubeSetup = profileStorageGet("jazzYouTubeSetup", null);
  state.profileConnection = profileStorageGet("jazzProfileConnection", null);
  state.setupWizard = profileStorageGet("jazzSetupWizard", null);
  state.firstRunComplete = profileStorageGetBoolean("jazzFirstRunComplete", false);
  state.publishingHistory = [];
  state.metaHistory = [];
  state.youtubeHealth = null;
  state.youtubePerformance = null;
  state.youtubePerformanceLoading = false;
  state.performanceGeneratePreset = profileStorageGet("jazzPerformanceGeneratePreset", null);
  state.albumVideoStatus = null;
  state.tokenHealth = null;
}

async function switchProfile(profileId) {
  if (!profileId || profileId === state.activeProfileId) return;
  persistActiveProfileState();
  loadProfileState(profileId);
  loadPostingSettings();
  loadSetupWizard();
  loadInstagramSetup();
  loadYouTubeSetup();
  loadProfileWorkspaceSetup();
  renderProfileSelector();
  await loadUserConfigFromBackend();
  renderAll({ syncBackend: false });
  loadReviewCacheFromBackend({ silent: true });
  loadTokenHealth();
  loadStartupStatus();
}

function save() {
  profileStorageSet("jazzTracks", state.tracks);
  profileStorageSet("jazzReviews", state.reviews);
  profileStorageSet("jazzYouTubeVideoReviews", state.youtubeVideoReviews);
  profileStorageSet("jazzAlbumVideoQueues", state.albumVideoQueues);
  profileStorageSet("jazzAlbumVideoActiveAlbum", state.albumVideoActiveAlbum);
  profileStorageSet("jazzAlbumVideoItems", state.albumVideoItems);
  profileStorageSet("jazzPublishingQueue", state.publishingQueue);
  profileStorageSet("jazzPostingPlan", state.postingPlan);
  profileStorageSet("jazzSongFactoryPlan", state.songFactoryPlan);
  profileStorageSet("jazzSongFactoryPlanHistory", state.songFactoryPlanHistory);
  profileStorageSet("jazzSongFactorySavedAlbum", state.songFactorySavedAlbum);
  profileStorageSet("jazzPerformanceGeneratePreset", state.performanceGeneratePreset);
}

function saveSetupWizard() {
  state.setupWizard = getSetupWizard();
  profileStorageSet("jazzSetupWizard", state.setupWizard);
  persistUserConfigToBackend();
}

function saveFirstRunComplete(value) {
  state.firstRunComplete = Boolean(value);
  profileStorageSetBoolean("jazzFirstRunComplete", state.firstRunComplete);
  persistUserConfigToBackend();
}

function savePosting() {
  state.posting = getPostingSettings();
  profileStorageSet("jazzPostingSettings", state.posting);
  persistUserConfigToBackend();
}

function saveInstagramSetup() {
  state.instagramSetup = getInstagramSetup();
  profileStorageSet("jazzInstagramSetup", state.instagramSetup);
  persistUserConfigToBackend();
}

function saveYouTubeSetup() {
  state.youtubeSetup = getYouTubeSetup();
  profileStorageSet("jazzYouTubeSetup", state.youtubeSetup);
  persistUserConfigToBackend();
}

function userConfigPayload() {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles,
    firstRunComplete: Boolean(state.firstRunComplete),
    setupWizard: {
      artistName: state.setupWizard?.artistName || $("#setupArtistName")?.value || "Maja's Coffee Jazz Zone",
      audioRoot: state.setupWizard?.audioRoot || $("#setupAudioRoot")?.value || "",
      artworkRoot: state.setupWizard?.artworkRoot || $("#setupArtworkRoot")?.value || "",
      lastScan: state.setupWizard?.lastScan || null
    },
    postingSettings: getPostingSettings(),
    instagramSetup: getInstagramSetup(),
    youtubeSetup: getYouTubeSetup(),
    profileConfigs: buildProfileConfigSnapshot()
  };
}

function profileConfigSnapshot(profileId) {
  const isCurrent = profileId === state.activeProfileId;
  return {
    firstRunComplete: isCurrent ? Boolean(state.firstRunComplete) : profileStorageGetBoolean("jazzFirstRunComplete", false, profileId),
    setupWizard: isCurrent ? getSetupWizard() : profileStorageGet("jazzSetupWizard", null, profileId),
    postingSettings: isCurrent ? getPostingSettings() : profileStorageGet("jazzPostingSettings", null, profileId),
    instagramSetup: isCurrent ? getInstagramSetup() : profileStorageGet("jazzInstagramSetup", null, profileId),
    youtubeSetup: isCurrent ? getYouTubeSetup() : profileStorageGet("jazzYouTubeSetup", null, profileId),
    profileConnection: isCurrent ? getProfileWorkspaceSetup() : profileStorageGet("jazzProfileConnection", null, profileId)
  };
}

function buildProfileConfigSnapshot() {
  return Object.fromEntries(state.profiles.map((profile) => [profile.id, profileConfigSnapshot(profile.id)]));
}

async function persistUserConfigToBackend() {
  try {
    const result = await postBackend("/api/user-config", userConfigPayload());
    if (result.ok) state.userConfigPath = result.configPath || state.userConfigPath;
    renderUserConfigStatus();
  } catch {
    // Browser storage remains the fallback when the backend is closed.
    renderUserConfigStatus();
  }
}

async function loadUserConfigFromBackend() {
  try {
    const response = await fetch(`${backendUrl}/api/user-config`);
    const result = await response.json();
    if (!result.ok || !result.config) return false;
    if (!result.configExists) {
      state.userConfigPath = result.configPath || state.userConfigPath;
      await persistUserConfigToBackend();
      return false;
    }
    applyUserConfig(result.config, result.configPath || "");
    return true;
  } catch {
    return false;
  }
}

function applyUserConfig(config = {}, configPath = "") {
  state.userConfigPath = configPath || state.userConfigPath;
  if (Array.isArray(config.profiles) && config.profiles.length) {
    state.profiles = mergeProfiles(config.profiles);
    if (!state.profiles.some((profile) => profile.id === state.activeProfileId)) {
      state.activeProfileId = state.profiles[0]?.id || DEFAULT_PROFILE_ID;
      activeProfileId = state.activeProfileId;
      localStorage.setItem(ACTIVE_PROFILE_KEY, state.activeProfileId);
    }
    localStorage.setItem(PROFILE_LIST_KEY, JSON.stringify(state.profiles));
  }
  const profileConfig = config.profileConfigs?.[state.activeProfileId]
    || (state.activeProfileId === DEFAULT_PROFILE_ID ? config : {});
  if (typeof profileConfig.firstRunComplete === "boolean") {
    state.firstRunComplete = profileConfig.firstRunComplete;
    profileStorageSetBoolean("jazzFirstRunComplete", state.firstRunComplete);
  }
  if (profileConfig.setupWizard) {
    state.setupWizard = {
      ...(state.setupWizard || {}),
      ...profileConfig.setupWizard
    };
    profileStorageSet("jazzSetupWizard", state.setupWizard);
  }
  if (profileConfig.postingSettings) {
    state.posting = {
      ...(state.posting || {}),
      ...profileConfig.postingSettings
    };
    profileStorageSet("jazzPostingSettings", state.posting);
  }
  if (profileConfig.instagramSetup) {
    state.instagramSetup = {
      ...(state.instagramSetup || {}),
      ...profileConfig.instagramSetup
    };
    profileStorageSet("jazzInstagramSetup", state.instagramSetup);
  }
  if (profileConfig.youtubeSetup) {
    state.youtubeSetup = {
      ...(state.youtubeSetup || {}),
      ...profileConfig.youtubeSetup
    };
    profileStorageSet("jazzYouTubeSetup", state.youtubeSetup);
  }
  if (profileConfig.profileConnection) {
    state.profileConnection = {
      ...(state.profileConnection || {}),
      ...profileConfig.profileConnection
    };
    profileStorageSet("jazzProfileConnection", state.profileConnection);
  }
  loadPostingSettings();
  loadSetupWizard();
  loadInstagramSetup();
  loadYouTubeSetup();
  loadProfileWorkspaceSetup();
  renderProfileSelector();
  renderUserConfigStatus();
}

function mergeProfiles(profiles = []) {
  const byId = new Map(state.profiles.map((profile) => [profile.id, profile]));
  profiles.map(normalizeProfile).forEach((profile) => byId.set(profile.id, profile));
  return [...byId.values()];
}

function defaultProfileConnection() {
  return {
    instagramUserId: "",
    facebookPageId: "",
    r2Bucket: "",
    r2PublicBaseUrl: "",
    youtubeChannelId: "",
    youtubeOAuthLabel: ""
  };
}

function getProfileWorkspaceSetup() {
  return {
    instagramUserId: $("#profileInstagramUserId")?.value || "",
    facebookPageId: $("#profileFacebookPageId")?.value || "",
    r2Bucket: $("#profileR2Bucket")?.value || "",
    r2PublicBaseUrl: $("#profileR2PublicBaseUrl")?.value || "",
    youtubeChannelId: $("#profileYouTubeChannelId")?.value || "",
    youtubeOAuthLabel: $("#profileYouTubeOAuthLabel")?.value || ""
  };
}

function loadProfileWorkspaceSetup() {
  const profile = currentProfile() || {};
  const connection = { ...defaultProfileConnection(), ...(state.profileConnection || {}) };
  const values = {
    profileSetupName: profile.name || "",
    profileSetupHandle: profile.handle || "",
    profileSetupDescription: profile.description || "",
    profileInstagramUserId: connection.instagramUserId,
    profileFacebookPageId: connection.facebookPageId,
    profileR2Bucket: connection.r2Bucket,
    profileR2PublicBaseUrl: connection.r2PublicBaseUrl,
    profileYouTubeChannelId: connection.youtubeChannelId,
    profileYouTubeOAuthLabel: connection.youtubeOAuthLabel
  };
  Object.entries(values).forEach(([id, value]) => {
    const field = $(`#${id}`);
    if (field) field.value = value || "";
  });
  renderProfileWorkspaceStatus();
}

function saveProfilesList() {
  localStorage.setItem(PROFILE_LIST_KEY, JSON.stringify(state.profiles));
}

async function saveProfileWorkspace() {
  const current = currentProfile();
  if (!current) return;
  const name = ($("#profileSetupName")?.value || current.name || "Untitled Profile").trim();
  const handle = ($("#profileSetupHandle")?.value || "").trim();
  const description = ($("#profileSetupDescription")?.value || "").trim();
  current.name = name || current.name;
  current.handle = handle;
  current.description = description;
  state.profileConnection = getProfileWorkspaceSetup();
  state.setupWizard = {
    ...(state.setupWizard || {}),
    artistName: current.name
  };
  profileStorageSet("jazzProfileConnection", state.profileConnection);
  profileStorageSet("jazzSetupWizard", state.setupWizard);
  saveProfilesList();
  renderProfileSelector();
  loadPostingSettings();
  loadSetupWizard();
  loadInstagramSetup();
  loadYouTubeSetup();
  renderProfileWorkspaceStatus();
  await persistUserConfigToBackend();
  setStatus("#profileWorkspaceStatus", "Profile workspace saved.");
}

async function addProfileWorkspace() {
  const name = prompt("New profile name, for example Majawick Music");
  if (!name) return;
  persistActiveProfileState();
  const profile = normalizeProfile({
    name,
    handle: prompt("Social handle for this profile, optional") || "",
    description: "New artist workspace"
  });
  if (state.profiles.some((item) => item.id === profile.id)) {
    setStatus("#profileWorkspaceStatus", "A profile with that name already exists. Choose it from the profile selector.");
    return;
  }
  state.profiles.push(profile);
  saveProfilesList();
  renderProfileSelector();
  await switchProfile(profile.id);
  location.hash = "settingsSetup";
  setStatus("#profileWorkspaceStatus", `Created ${profile.name}. Choose its audio and artwork folders, then scan the library.`);
}

function renderProfileWorkspaceStatus() {
  const stats = $("#profileWorkspaceStats");
  if (!stats) return;
  const profile = currentProfile() || {};
  const connection = { ...defaultProfileConnection(), ...(state.profileConnection || {}) };
  const profileRoot = state.activeProfileId === DEFAULT_PROFILE_ID
    ? "Main app workspace"
    : `profiles/${state.activeProfileId}`;
  const setup = state.setupWizard || {};
  stats.innerHTML = [
    ["Active profile", profile.name || "Not set"],
    ["Library folder", setup.audioRoot ? "Set" : "Not set"],
    ["Catalogue", setup.lastScan?.catalogPath ? "Scanned" : "Not scanned"],
    ["Profile storage", profileRoot],
    ["Meta IDs", connection.instagramUserId || connection.facebookPageId ? "Saved" : "Not set"],
    ["R2 storage", connection.r2Bucket || connection.r2PublicBaseUrl ? "Saved" : "Not set"],
    ["YouTube", connection.youtubeChannelId || connection.youtubeOAuthLabel ? "Saved" : "Not set"]
  ].map(([label, value]) => `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(value.trim());
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.trim());
  rows.push(row);
  return rows;
}

function normalizeHeader(header) {
  return String(header || "").trim().replace(/^\uFEFF/, "").toLowerCase();
}

function renderStats() {
  const albums = new Set(state.tracks.map((track) => track.album));
  $("#trackCount").textContent = state.tracks.length;
  $("#albumCount").textContent = albums.size;
  $("#queueCount").textContent = getPublishSourceItems().length;
  renderDashboard();
}

function renderDashboard() {
  const sourceItems = getPublishSourceItems();
  const pending = sourceItems.filter((item) => item.status !== "posted" && item.publishStatus !== "published" && item.status !== "held");
  const ready = pending.filter((item) => item.publicVideoUrl || item.containerId);
  const next = getNextPublishItem(sourceItems);
  const days = new Set(sourceItems
    .filter((item) => item.scheduledFor && item.status !== "posted" && item.publishStatus !== "published")
    .map((item) => String(item.scheduledFor).slice(0, 10)));
  const tokenSummary = summarizeTokenHealth();
  const nextStep = dashboardNextStep({ pending, ready, next, tokenSummary });

  setText("#dashboardReadyCount", ready.length);
  setText("#dashboardDaysScheduled", days.size);
  setText("#dashboardTokenState", tokenSummary.label);
  setText("#dashboardMetaStatus", tokenSummary.status === "good" ? "Healthy" : tokenSummary.status === "soon" ? "Refresh soon" : tokenSummary.status === "bad" ? "Needs attention" : "Check needed");
  setText("#dashboardNextStep", nextStep.title);
  setText("#dashboardNextStepText", nextStep.text);
  setText("#dashboardHeadline", "Today's publishing status.");
  setText("#dashboardSubline", nextStep.text);
  renderDashboardPublishingSnapshot(sourceItems);
}

function renderDashboardPublishingSnapshot(sourceItems = getPublishSourceItems()) {
  const latestCard = $("#dashboardLatestDetail");
  const nextCard = $("#dashboardNextDetail");
  if (!latestCard || !nextCard) return;

  const latest = getDashboardLatestPostedItem(sourceItems);
  const next = getDashboardNextScheduledItem(sourceItems);
  latestCard.innerHTML = renderDashboardPostCard({
    eyebrow: "Latest Posted",
    item: latest,
    empty: "Published content will appear here after the next successful upload.",
    dateLabel: "Published",
    platformLabel: latest ? dashboardPublishedPlatformSummary(latest) : "",
    mode: "posted",
    sourceItems
  });
  nextCard.innerHTML = renderDashboardPostCard({
    eyebrow: "Next To Post",
    item: next,
    empty: "Scheduled content will appear here once your publishing plan is ready.",
    dateLabel: "Scheduled",
    platformLabel: next ? effectiveDestinationSummary(next, sourceItems) : "",
    mode: "next",
    sourceItems
  });
}

function getDashboardLatestPostedItem(sourceItems = []) {
  const scheduledPosted = sourceItems
    .filter((item) => item.status === "posted" || item.publishStatus === "published" || item.youtubeShortPublishStatus === "published" || item.youtubePublishStatus === "published")
    .map((item) => ({ ...item, lastPublishedAt: dashboardPublishedAt(item) }));
  const historyItems = state.publishingHistory.map((item) => enrichDashboardItemFromSources(item, sourceItems));
  return [...historyItems, ...scheduledPosted]
    .filter((item) => dashboardPublishedAt(item))
    .sort((a, b) => new Date(dashboardPublishedAt(b) || 0).getTime() - new Date(dashboardPublishedAt(a) || 0).getTime())[0] || null;
}

function getDashboardNextScheduledItem(sourceItems = []) {
  return [...sourceItems]
    .filter((item) => item.scheduledFor)
    .filter((item) => item.status !== "posted" && item.publishStatus !== "published" && item.status !== "held")
    .sort((a, b) => new Date(a.scheduledFor || 0).getTime() - new Date(b.scheduledFor || 0).getTime())[0] || null;
}

function enrichDashboardItemFromSources(item = {}, sourceItems = []) {
  const match = sourceItems.find((candidate) => dashboardItemsMatch(candidate, item)) || {};
  return {
    ...match,
    ...item,
    preview: item.preview || match.preview || "",
    artwork: item.artwork || match.artwork || "",
    video: item.video || match.video || "",
    publicVideoUrl: item.publicVideoUrl || match.publicVideoUrl || "",
    caption: item.caption || match.caption || "",
    visualSourceStatus: item.visualSourceStatus || match.visualSourceStatus || "",
    visualSourceName: item.visualSourceName || match.visualSourceName || "",
    visualSearchTerms: item.visualSearchTerms || match.visualSearchTerms || "",
    albumThemeStyle: item.albumThemeStyle || match.albumThemeStyle || "",
    albumThemeInstruments: item.albumThemeInstruments || match.albumThemeInstruments || "",
    youtubeShortUrl: item.youtubeShortUrl || match.youtubeShortUrl || "",
    youtubeUrl: item.youtubeUrl || match.youtubeUrl || ""
  };
}

function dashboardItemsMatch(a = {}, b = {}) {
  const leftId = String(a.id || "").toLowerCase();
  const rightId = String(b.id || "").toLowerCase();
  const leftIsrc = String(a.isrc || a.ISRC || "").toLowerCase();
  const rightIsrc = String(b.isrc || b.ISRC || "").toLowerCase();
  const leftTitleAlbum = `${a.title || a.Title || ""}|${a.album || a.Album || ""}`.toLowerCase();
  const rightTitleAlbum = `${b.title || b.Title || ""}|${b.album || b.Album || ""}`.toLowerCase();
  return Boolean(
    (leftId && rightId && leftId === rightId)
    || (leftIsrc && rightIsrc && leftIsrc === rightIsrc)
    || (leftTitleAlbum.trim() !== "|" && leftTitleAlbum === rightTitleAlbum)
  );
}

function dashboardPublishedAt(item = {}) {
  return item.lastPublishedAt
    || item.instagramPublishedAt
    || item.facebookPublishedAt
    || item.youtubeShortPublishedAt
    || item.youtubePublishedAt
    || item.publishedAt
    || item.lastSeenAt
    || "";
}

function dashboardPublishedPlatformSummary(item = {}) {
  if (Array.isArray(item.platformLabels) && item.platformLabels.length) return item.platformLabels.join(" + ");
  return [
    item.instagramDone || item.instagramMediaId ? "Instagram" : "",
    item.facebookDone || item.facebookMediaId ? "Facebook" : "",
    item.youtubeShortsDone || item.youtubeShortVideoId || item.youtubeShortUrl ? "YouTube Shorts" : "",
    item.youtubeVideoDone || item.youtubeVideoId || item.youtubeUrl ? "YouTube" : ""
  ].filter(Boolean).join(" + ") || "Published";
}

function renderDashboardPostCard({ eyebrow, item, empty, dateLabel, platformLabel, mode, sourceItems }) {
  if (!item) {
    return `
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <div class="dashboard-post-empty">${escapeHtml(empty)}</div>
    `;
  }

  const title = item.title || item.Title || "Untitled";
  const album = item.album || item.Album || "Unknown album";
  const date = mode === "posted" ? dashboardPublishedAt(item) : item.scheduledFor;
  const media = dashboardMediaPreview(item);
  const status = mode === "posted"
    ? "Published"
    : item.publicVideoUrl || item.containerId
      ? "Ready to publish"
      : "Needs upload";
  const details = [
    item.albumThemeStyle || item.style ? `Style: ${item.albumThemeStyle || item.style}` : "",
    item.albumThemeInstruments ? `Instrument: ${item.albumThemeInstruments}` : "",
    item.visualSourceName || item.visualSourceStatus ? `Visual: ${[item.visualSourceName, item.visualSourceStatus].filter(Boolean).join(" | ")}` : "",
    item.visualSearchTerms ? `Search: ${item.visualSearchTerms}` : ""
  ].filter(Boolean).slice(0, 4);
  const caption = dashboardCaptionSnippet(item);

  return `
    <p class="eyebrow">${escapeHtml(eyebrow)}</p>
    <div class="dashboard-post-layout">
      ${media}
      <div class="dashboard-post-body">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(album)}</p>
        </div>
        <div class="dashboard-post-meta">
          <span>${escapeHtml(dateLabel)}: ${escapeHtml(formatSchedule(date))}</span>
          <span>${escapeHtml(status)}</span>
        </div>
        <div class="dashboard-platforms">
          ${dashboardPlatformBadges(platformLabel)}
        </div>
        ${details.length ? `<dl class="dashboard-post-details">${details.map((detail) => `<div><dt>${escapeHtml(detail.split(":")[0])}</dt><dd>${escapeHtml(detail.split(":").slice(1).join(":").trim())}</dd></div>`).join("")}</dl>` : ""}
        ${caption ? `<p class="dashboard-caption">${escapeHtml(caption)}</p>` : ""}
        <div class="dashboard-post-actions">
          ${dashboardPostLinks(item)}
          <a href="${mode === "posted" ? "#postingPlan" : "#publishingQueue"}">${mode === "posted" ? "Open history" : "Open schedule"}</a>
        </div>
      </div>
    </div>
  `;
}

function dashboardMediaPreview(item = {}) {
  const source = dashboardFileUrl(item.preview || item.artwork || "");
  if (!source) {
    return `<div class="dashboard-post-media placeholder"><span>No artwork</span></div>`;
  }
  return `<div class="dashboard-post-media"><img src="${escapeHtml(source)}" alt="${escapeHtml(item.title || "Artwork preview")}" loading="lazy" /></div>`;
}

function dashboardPlatformBadges(label = "") {
  const labels = String(label || "")
    .split(/\s+\+\s+|,/)
    .map((item) => item.trim())
    .filter(Boolean);
  return (labels.length ? labels : ["No stores selected"])
    .map((item) => `<span>${escapeHtml(item)}</span>`)
    .join("");
}

function dashboardCaptionSnippet(item = {}) {
  const text = String(item.caption || item.description || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
}

function dashboardPostLinks(item = {}) {
  const links = [];
  if (item.youtubeShortUrl) links.push(`<a href="${escapeHtml(item.youtubeShortUrl)}" target="_blank" rel="noreferrer">Open Short</a>`);
  if (item.youtubeUrl && item.youtubeUrl !== item.youtubeShortUrl) links.push(`<a href="${escapeHtml(item.youtubeUrl)}" target="_blank" rel="noreferrer">Open YouTube</a>`);
  if (item.publicVideoUrl) links.push(`<a href="${escapeHtml(item.publicVideoUrl)}" target="_blank" rel="noreferrer">Open MP4 URL</a>`);
  if (item.video) links.push(`<button class="ghost dashboard-open-local" data-open-path="${escapeHtml(item.video)}">Local video</button>`);
  if (item.artwork) links.push(`<button class="ghost dashboard-open-local" data-open-path="${escapeHtml(item.artwork)}">Artwork</button>`);
  return links.join("");
}

function dashboardFileUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text) || /^file:\/\//i.test(text)) return text;
  if (/^[a-z]:\\/i.test(text) || text.startsWith("\\\\")) {
    return encodeURI(`file:///${text.replace(/\\/g, "/")}`);
  }
  return text;
}

function dashboardNextStep({ pending, ready, next, tokenSummary }) {
  if (tokenSummary.status === "bad") {
    return { title: "Fix Meta token", text: "Open Setup > Meta and use the direct fix buttons before publishing." };
  }
  if (tokenSummary.status === "soon") {
    return { title: "Refresh token soon", text: "Meta token is valid, but close to expiry. Open Setup > Meta and refresh it before it blocks publishing." };
  }
  const hasLibraryOrPlan = Boolean(
    state.tracks.length
    || state.setupWizard?.lastScan?.eligibleCount
    || state.reviews.length
    || state.publishingQueue.length
    || state.postingPlan.length
    || state.publishingHistory.length
  );
  if (!hasLibraryOrPlan) {
    return { title: "Scan library", text: "Open Setup, choose the audio/artwork folders, then scan." };
  }
  if (!state.reviews.length && !state.publishingQueue.length && !state.postingPlan.length) {
    return { title: "Generate review batch", text: "Create fresh review-ready Reels, then approve the best ones in Review." };
  }
  if (state.reviews.some((item) => item.status === "new" || item.status === "ready")) {
    return { title: "Review Reels", text: "Approve or reject the newly generated Reels." };
  }
  if (state.publishingQueue.some((item) => !item.publicVideoUrl)) {
    return { title: "Upload videos", text: "Upload approved MP4s to R2 so Meta can publish them." };
  }
  if (ready.length && getDuePublishItems(getPublishSourceItems()).length) {
    return { title: "Publish due now", text: "One or more uploaded Reels are due. Run today’s check." };
  }
  if (next) {
    return { title: "Plan is waiting", text: `Next scheduled Reel is ${formatSchedule(next.scheduledFor)}.` };
  }
  if (pending.length) {
    return { title: "Check schedule", text: "There are pending items, but they need dates or upload status checked." };
  }
  return { title: "Generate next batch", text: "Your current plan is clear. Create the next group of Reels." };
}

function summarizeTokenHealth() {
  if (!state.tokenHealth) return { status: "unknown", label: "Check" };
  const failed = state.tokenHealth.checks?.filter((item) => !item.ok).length || 0;
  const graphFailed = state.tokenHealth.graph?.results?.filter((item) => !item.ok).length || 0;
  if (failed || graphFailed || state.tokenHealth.ok === false) return { status: "bad", label: "Fix" };
  const debug = state.tokenHealth.graph?.results?.find((item) => item.id === "token_debug");
  const expiresAt = Number(debug?.body?.data?.expires_at || 0);
  if (expiresAt) {
    const days = Math.ceil(((expiresAt * 1000) - Date.now()) / 86400000);
    if (days <= 7) return { status: "soon", label: "Soon" };
  }
  return { status: "good", label: "Healthy" };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function logAppEvent(level, message, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    level,
    message: String(message || "Unknown issue").slice(0, 800),
    details: safeDiagnosticValue(details)
  };
  state.errorLog = [entry, ...state.errorLog].slice(0, 60);
  profileStorageSet("jazzErrorLog", state.errorLog);
  renderErrorReportPanel();
}

function safeDiagnosticValue(value) {
  if (value == null) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: String(value.stack || "").split("\n").slice(0, 6).join("\n")
    };
  }
  if (Array.isArray(value)) return value.slice(0, 20).map(safeDiagnosticValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !/token|secret|password|access.?key|app.?secret|authorization/i.test(key))
      .slice(0, 30)
      .map(([key, item]) => [key, safeDiagnosticValue(item)]));
  }
  return String(value).slice(0, 800);
}

function shouldLogStatus(message = "") {
  return /failed|error|not running|expired|invalid|missing|denied|permission|could not|needs attention|lost connection|not ready/i.test(message);
}

function pathToFileUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (/^[A-Z]:\\/i.test(path)) return `file:///${path.replaceAll("\\", "/").replaceAll(" ", "%20")}`;
  return path;
}

function normalizeSetupFolderInput(value = "") {
  let text = String(value || "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!text) return "";
  if (/^file:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      if (url.protocol === "file:") {
        const decoded = decodeURIComponent(url.pathname || "");
        if (/^\/[A-Za-z]:\//.test(decoded)) {
          return decoded.slice(1).replaceAll("/", "\\");
        }
        return decoded.replaceAll("/", "\\");
      }
    } catch {}
  }
  return text;
}

function defaultSongFactoryAudioFolder() {
  return DEFAULT_SONG_FACTORY_AUDIO_FOLDERS[state.activeProfileId] || state.setupWizard?.audioRoot || "";
}

function stableHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function hasRenderedVariantIdentity(item = {}) {
  return Boolean(
    item.Video || item.video ||
    item.VariantIndex || item.variantIndex ||
    item.VariantRole || item.variantRole ||
    item.ShortType || item.shortType ||
    item.Template || item.template
  );
}

function stableRenderedItemId(item = {}) {
  const existing = item.id || item.ID || "";
  if (existing && String(existing).startsWith("review::")) return existing;
  if (existing && !hasRenderedVariantIdentity(item)) return existing;

  const video = item.Video || item.video || "";
  const source = video || [
    item.ISRC || item.isrc || "",
    item.Title || item.title || "Untitled",
    item.Album || item.album || "Unknown album",
    item.VariantIndex || item.variantIndex || "",
    item.VariantRole || item.variantRole || "",
    item.ShortType || item.shortType || "",
    item.Template || item.template || "",
    item.VisualSourceUrl || item.visualSourceUrl || ""
  ].filter(Boolean).join("|");

  return source ? `review::${stableHash(source)}` : existing || crypto.randomUUID();
}

function normalizeReview(item) {
  const rawStatus = (item.Status || item.status || "draft").toLowerCase();
  const video = item.Video || item.video || "";
  return {
    id: stableRenderedItemId(item),
    status: (!video && rawStatus === "draft") ? "render_failed" : rawStatus,
    title: item.Title || item.title || "Untitled",
    album: item.Album || item.album || "Unknown album",
    isrc: item.ISRC || item.isrc || "",
    video,
    preview: item.Preview || item.preview || "",
    audio: item.Audio || item.audio || "",
    artwork: item.Artwork || item.artwork || "",
    template: item.Template || item.template || "unknown",
    durationSeconds: Number(item.DurationSeconds || item.durationSeconds || 0),
    sourceDurationSeconds: Number(item.SourceDurationSeconds || item.sourceDurationSeconds || 0),
    testRender: item.TestRender === true || String(item.TestRender || item.testRender || "").toLowerCase() === "true" || rawStatus === "test",
    scheduledFor: item.ScheduledFor || item.scheduledFor || "",
    youtubeVideoId: item.YouTubeVideoId || item.youtubeVideoId || "",
    youtubeUrl: item.YouTubeUrl || item.youtubeUrl || "",
    youtubePublishedAt: item.YouTubePublishedAt || item.youtubePublishedAt || "",
    youtubePublishStatus: item.YouTubePublishStatus || item.youtubePublishStatus || "",
    destinations: normalizeDestinations(item.Destinations || item.destinations),
    variantIndex: item.VariantIndex || item.variantIndex || "",
    variantCount: item.VariantCount || item.variantCount || "",
    variantRole: item.VariantRole || item.variantRole || "",
    variantLabel: item.VariantLabel || item.variantLabel || "",
    atmosphereEffect: item.AtmosphereEffect || item.atmosphereEffect || "",
    atmosphereEdit: item.AtmosphereEdit || item.atmosphereEdit || "",
    artworkMotionTag: item.ArtworkMotionTag || item.artworkMotionTag || "",
    albumThemeMood: item.AlbumThemeMood || item.albumThemeMood || "",
    albumTheme: item.AlbumTheme || item.albumTheme || "",
    albumThemeStyle: item.AlbumThemeStyle || item.albumThemeStyle || "",
    albumThemeScene: item.AlbumThemeScene || item.albumThemeScene || "",
    albumThemeInstruments: item.AlbumThemeInstruments || item.albumThemeInstruments || "",
    albumThemeSearchTerms: item.AlbumThemeSearchTerms || item.albumThemeSearchTerms || "",
    albumThemeNegativeTerms: item.AlbumThemeNegativeTerms || item.albumThemeNegativeTerms || "",
    shortType: item.ShortType || item.shortType || "",
    shortTypeLabel: item.ShortTypeLabel || item.shortTypeLabel || "",
    descriptionMode: item.DescriptionMode || item.descriptionMode || "",
    descriptionModeLabel: item.DescriptionModeLabel || item.descriptionModeLabel || "",
    campaignId: item.CampaignId || item.campaignId || "",
    seoTitle: item.SeoTitle || item.seoTitle || "",
    keywords: item.Keywords || item.keywords || "",
    visualConcept: item.VisualConcept || item.visualConcept || "",
    visualSearchTerms: item.VisualSearchTerms || item.visualSearchTerms || "",
    visualThemeBasis: item.VisualThemeBasis || item.visualThemeBasis || "",
    visualPrompt: item.VisualPrompt || item.visualPrompt || "",
    visualSourcingPlan: item.VisualSourcingPlan || item.visualSourcingPlan || "",
    approvedVisualSources: item.ApprovedVisualSources || item.approvedVisualSources || "",
    visualLicensingNotes: item.VisualLicensingNotes || item.visualLicensingNotes || "",
    visualSourceStatus: item.VisualSourceStatus || item.visualSourceStatus || "",
    visualLayout: item.VisualLayout || item.visualLayout || "",
    visualAssetPath: item.VisualAssetPath || item.visualAssetPath || "",
    visualSourceName: item.VisualSourceName || item.visualSourceName || "",
    visualSourceUrl: item.VisualSourceUrl || item.visualSourceUrl || "",
    visualSourceLicense: item.VisualSourceLicense || item.visualSourceLicense || "",
    visualSourceCreator: item.VisualSourceCreator || item.visualSourceCreator || "",
    visualSourceAttribution: item.VisualSourceAttribution || item.visualSourceAttribution || "",
    audience: item.Audience || item.audience || "",
    metadataStrategy: item.MetadataStrategy || item.metadataStrategy || "",
    caption: item.Caption || item.caption || "",
    hashtags: item.Hashtags || item.hashtags || "",
    profileSourceProfileId: item.ProfileSourceProfileId || item.profileSourceProfileId || "",
    profileSourceLocked: item.profileSourceLocked === true || String(item.ProfileSourceLocked || item.profileSourceLocked || "").toLowerCase() === "true",
    rejectionReason: item.RejectionReason || item.rejectionReason || "",
    rejectedAt: item.RejectedAt || item.rejectedAt || ""
  };
}

function renderReviews() {
  const list = $("#reviewList");
  if (!list) return;
  const schedulePreview = buildReviewSchedulePreview();
  const reviews = sortReviewsBySchedulePreview(getVisibleReviews(), schedulePreview);
  list.innerHTML = "";

  if (!reviews.length) {
    const message = state.reviews.length
      ? "No Reels match this filter."
      : "No rendered Reels loaded yet. Load the latest batch or create a new one from Generate.";
    list.innerHTML = `<p class="note">${message}</p>`;
    return;
  }

  renderReviewScheduleOverview(list, schedulePreview);

  const template = $("#reviewTemplate");
  reviews.forEach((item) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".review-card");
    const preview = node.querySelector(".review-preview");
    const status = node.querySelector(".status-pill");
    const templatePill = node.querySelector(".template-pill");
    const title = node.querySelector("h4");
    const album = node.querySelector(".review-album");
    const caption = node.querySelector(".review-caption");
    const hashtags = node.querySelector(".review-hashtags");
    const openVideo = node.querySelector(".open-video");

    card.dataset.id = item.id;
    if (item.preview) preview.style.backgroundImage = `url("${pathToFileUrl(item.preview)}")`;
    status.textContent = item.status;
    status.className = `status-pill ${item.status}`;
    templatePill.textContent = item.template;
    title.textContent = item.title;
    album.textContent = item.album;
    renderCampaignDetails(node, item);
    renderReviewSchedulePreview(node, item, schedulePreview);
    caption.value = item.caption;
    hashtags.value = item.hashtags;
    if (item.video && /\.mp4$/i.test(item.video)) {
      openVideo.href = pathToFileUrl(item.video);
      openVideo.removeAttribute("aria-disabled");
      openVideo.classList.remove("is-disabled");
      openVideo.textContent = "Open MP4";
    } else {
      openVideo.href = "#review";
      openVideo.setAttribute("aria-disabled", "true");
      openVideo.classList.add("is-disabled");
      openVideo.textContent = "MP4 unavailable";
      openVideo.addEventListener("click", (event) => {
        event.preventDefault();
        setReviewLoadStatus("This item did not render a playable MP4. It has been hidden from future Review loads.", "error");
      });
    }
    renderRejectionReason(node, item);

    node.querySelector(".approve").addEventListener("click", () => updateReviewStatus(item.id, "approved"));
    node.querySelector(".reject").addEventListener("click", () => updateReviewStatus(item.id, "rejected"));
    node.querySelector(".posted").addEventListener("click", () => updateReviewStatus(item.id, "posted"));
    caption.addEventListener("input", () => updateReviewText(item.id, "caption", caption.value));
    hashtags.addEventListener("input", () => updateReviewText(item.id, "hashtags", hashtags.value));

    list.appendChild(node);
  });
}

function sortReviewsBySchedulePreview(reviews = [], preview = {}) {
  const previewMap = preview.map || new Map();
  return [...reviews].sort((a, b) => {
    const aPreview = previewMap.get(a.id);
    const bPreview = previewMap.get(b.id);
    const aDate = Date.parse(aPreview?.scheduledFor || a.scheduledFor || "");
    const bDate = Date.parse(bPreview?.scheduledFor || b.scheduledFor || "");
    const aHasDate = Number.isFinite(aDate);
    const bHasDate = Number.isFinite(bDate);
    if (aHasDate && bHasDate && aDate !== bDate) return aDate - bDate;
    if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
    const byTrack = `${a.album || ""}|${a.title || ""}`.localeCompare(`${b.album || ""}|${b.title || ""}`);
    if (byTrack) return byTrack;
    return scheduleVariantSortValue(a) - scheduleVariantSortValue(b);
  });
}

function buildReviewSchedulePreview() {
  const source = state.reviews
    .filter(isPlayableReview)
    .filter((item) => !["rejected", "posted"].includes(String(item.status || "").toLowerCase()))
    .map((item) => ({ ...item, scheduledFor: "" }));
  if (!source.length) return { map: new Map(), items: [], trackCount: 0 };

  const result = autoFillScheduleItems(source, {
    startDate: new Date(),
    times: AUTO_APPROVED_SCHEDULE_TIMES
  });
  const updatedIds = new Set(result.updatedIds || []);
  const items = (result.items || [])
    .filter((item) => updatedIds.has(item.id))
    .sort((a, b) => new Date(a.scheduledFor || 0).getTime() - new Date(b.scheduledFor || 0).getTime());
  return {
    map: new Map(items.map((item) => [item.id, item])),
    items,
    trackCount: new Set(items.map(scheduleTrackKey)).size
  };
}

function renderReviewScheduleOverview(list, preview = {}) {
  if (!preview.items?.length) return;
  const first = preview.items[0];
  const last = preview.items[preview.items.length - 1];
  const dateRange = first?.scheduledFor === last?.scheduledFor
    ? formatSchedule(first.scheduledFor)
    : `${formatSchedule(first.scheduledFor)} to ${formatSchedule(last.scheduledFor)}`;
  const dayCount = new Set(preview.items.map((item) => scheduleDateKey(item.scheduledFor))).size;
  const panel = document.createElement("article");
  panel.className = "review-schedule-overview";
  panel.innerHTML = `
    <div>
      <span class="eyebrow">Schedule Preview</span>
      <strong>${preview.items.length} generated Short${preview.items.length === 1 ? "" : "s"} from ${preview.trackCount} track${preview.trackCount === 1 ? "" : "s"}</strong>
      <p>${escapeHtml(dateRange)} across ${dayCount} day${dayCount === 1 ? "" : "s"}.</p>
    </div>
    <p>Preview uses the same rule as Schedule: 06:00, 11:00, and 14:00 for YouTube Shorts, first daily slot also goes to Instagram/Facebook, and alternate visuals for the same track are pushed later where possible.</p>
  `;
  list.appendChild(panel);
}

function renderReviewSchedulePreview(node, item, preview = {}) {
  const body = node.querySelector(".review-body");
  const captionLabel = node.querySelector(".review-caption")?.closest("label");
  if (!body || !captionLabel) return;
  const scheduled = preview.map?.get(item.id);
  const panel = document.createElement("div");
  panel.className = "review-schedule-card";
  const variant = item.variantIndex && item.variantCount
    ? `Variant ${item.variantIndex} of ${item.variantCount}`
    : item.variantLabel || item.variantRole || "Generated variant";
  if (!scheduled) {
    panel.innerHTML = `
      <strong>${escapeHtml(variant)}</strong>
      <span>Not included in the current auto-schedule preview.</span>
    `;
  } else {
    panel.innerHTML = `
      <strong>${escapeHtml(variant)}</strong>
      <span>${escapeHtml(formatSchedule(scheduled.scheduledFor))}</span>
      <small>${escapeHtml(effectiveDestinationSummary(scheduled, preview.items))}</small>
    `;
  }
  body.insertBefore(panel, captionLabel);
}

function renderCampaignDetails(node, item) {
  if (!item.shortType && !item.seoTitle && !item.visualConcept && !item.keywords && !item.visualSourcingPlan && !item.albumTheme) return;
  const body = node.querySelector(".review-body");
  const album = node.querySelector(".review-album");
  if (!body || !album) return;
  const panel = document.createElement("div");
  panel.className = "campaign-note";
  panel.innerHTML = `
    <div>
      <strong>${escapeHtml(item.shortTypeLabel || shortTypeLabel(item.shortType) || "Short campaign")}</strong>
      ${item.variantLabel ? `<span>${escapeHtml(item.variantLabel)}</span>` : ""}
      ${item.atmosphereEffect ? `<span>${escapeHtml(item.atmosphereEffect)}</span>` : ""}
      ${item.atmosphereEdit ? `<span>${escapeHtml(item.atmosphereEdit)}</span>` : ""}
      ${item.artworkMotionTag ? `<span>${escapeHtml(item.artworkMotionTag)}</span>` : ""}
      ${item.descriptionModeLabel || item.descriptionMode ? `<span>${escapeHtml(item.descriptionModeLabel || item.descriptionMode)}</span>` : ""}
      ${item.metadataStrategy ? `<span>${escapeHtml(item.metadataStrategy)}</span>` : ""}
    </div>
    ${item.seoTitle ? `<p><b>SEO title:</b> ${escapeHtml(item.seoTitle)}</p>` : ""}
    ${item.albumTheme || item.albumThemeMood || item.albumThemeSearchTerms || item.albumThemeInstruments ? `<p><b>Album theme:</b> ${escapeHtml([item.albumThemeMood, item.albumTheme, item.albumThemeStyle, item.albumThemeScene, item.albumThemeInstruments, item.albumThemeSearchTerms].filter(Boolean).join(" | "))}</p>` : ""}
    ${item.albumThemeNegativeTerms ? `<p><b>Avoid:</b> ${escapeHtml(item.albumThemeNegativeTerms)}</p>` : ""}
    ${item.visualConcept ? `<p><b>Concept:</b> ${escapeHtml(item.visualConcept)}</p>` : ""}
    ${item.visualThemeBasis ? `<p><b>Theme basis:</b> ${escapeHtml(item.visualThemeBasis)}</p>` : ""}
    ${item.visualSearchTerms ? `<p><b>Visual search:</b> ${escapeHtml(item.visualSearchTerms)}</p>` : ""}
    ${item.visualSourceStatus ? `<p><b>Visual source:</b> ${escapeHtml([item.visualSourceStatus, item.visualSourceName, item.visualSourceLicense].filter(Boolean).join(" | "))}</p>` : ""}
    ${item.visualSourcingPlan ? `<p><b>Safe visual plan:</b> ${escapeHtml(item.visualSourcingPlan)}</p>` : ""}
    ${item.visualLicensingNotes ? `<p><b>Licensing:</b> ${escapeHtml(item.visualLicensingNotes)}</p>` : ""}
    ${item.keywords ? `<p><b>Keywords:</b> ${escapeHtml(item.keywords)}</p>` : ""}
  `;
  body.insertBefore(panel, album.nextSibling);
}

function shortTypeLabel(value = "") {
  if (value === "showcase") return "Album / Track Showcase";
  if (value === "mood-pov") return "Mood / POV Discovery";
  if (value === "reimagined") return "Yesterday's Song Reimagined";
  return "";
}

function renderYouTubeVideoReviews() {
  // Separate YouTube review UI was retired; full-video publishing is driven by the unified Schedule plan.
}

function replaceYouTubeVideoReviews(items) {
  state.youtubeVideoReviews = applyScheduleToYouTubeVideos(items.map(normalizeReview));
  save();
  renderYouTubeVideoReviews();
  syncYouTubeVideoPlanToBackend();
}

function albumVideoQueueAlbum(items = []) {
  const counts = new Map();
  items.forEach((item) => {
    const album = String(item.album || item.Album || "").trim();
    if (!album) return;
    counts.set(album, (counts.get(album) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function albumVideoQueueFor(album = "") {
  const key = String(album || "").trim();
  if (!key) return [];
  if (key === state.albumVideoActiveAlbum) return state.albumVideoItems || [];
  return Array.isArray(state.albumVideoQueues?.[key]) ? state.albumVideoQueues[key] : [];
}

function saveCurrentAlbumVideoQueue() {
  const album = String(state.albumVideoActiveAlbum || $("#albumVideoAlbumSelect")?.value || albumVideoQueueAlbum(state.albumVideoItems) || "").trim();
  if (!album) return;
  state.albumVideoActiveAlbum = album;
  state.albumVideoQueues = {
    ...(state.albumVideoQueues || {}),
    [album]: state.albumVideoItems || []
  };
  save();
}

function migrateAlbumVideoQueues() {
  state.albumVideoQueues = state.albumVideoQueues && typeof state.albumVideoQueues === "object" ? state.albumVideoQueues : {};
  if (state.albumVideoItems?.length) {
    const album = albumVideoQueueAlbum(state.albumVideoItems);
    if (album && !state.albumVideoQueues[album]) {
      state.albumVideoQueues[album] = state.albumVideoItems;
      if (!state.albumVideoActiveAlbum) state.albumVideoActiveAlbum = album;
    }
  }
}

function setAlbumVideoActiveAlbum(album = "", { preserveCurrent = true } = {}) {
  const next = String(album || "").trim();
  if (!next) return;
  if (preserveCurrent) saveCurrentAlbumVideoQueue();
  state.albumVideoActiveAlbum = next;
  state.albumVideoItems = Array.isArray(state.albumVideoQueues?.[next]) ? state.albumVideoQueues[next] : [];
  profileStorageSet("jazzAlbumVideoActiveAlbum", state.albumVideoActiveAlbum);
  profileStorageSet("jazzAlbumVideoItems", state.albumVideoItems);
}

function isAlbumVideoPosted(item = {}) {
  return Boolean(item.youtubeVideoId || item.youtubeUrl || item.youtubePublishStatus === "published" || item.status === "posted");
}

function albumVideoStatusInfo(album = {}) {
  const items = albumVideoQueueFor(album.album);
  const active = items.filter((item) => String(item.status || item.Status || "").toLowerCase() !== "rejected");
  const posted = active.filter(isAlbumVideoPosted).length;
  const approved = active.filter((item) => String(item.status || item.Status || "").toLowerCase() === "approved" && !isAlbumVideoPosted(item)).length;
  const draft = active.filter((item) => ["draft", ""].includes(String(item.status || item.Status || "").toLowerCase())).length;
  const failed = active.filter((item) => ["render_failed", "failed", "error"].includes(String(item.status || item.Status || "").toLowerCase()) || item.youtubePublishError).length;
  const historyCount = Number(album.youtubeVideoPublishedCount || 0);
  const uploadedCount = Math.max(posted, historyCount);
  const totalTracks = Number(album.trackCount || 0);
  const latest = album.youtubeVideoPublishedLatestAt || active.find(isAlbumVideoPosted)?.youtubePublishedAt || "";

  if (failed) return { key: "needs-fix", label: "Needs fix", detail: `${failed} issue${failed === 1 ? "" : "s"} in queue` };
  if (totalTracks && uploadedCount >= totalTracks) {
    return {
      key: "completed",
      label: "Uploaded",
      detail: `${uploadedCount}/${totalTracks} YouTube videos uploaded${latest ? ` | latest ${formatSchedule(latest)}` : ""}`
    };
  }
  if (uploadedCount > 0) return { key: "partial", label: "Part uploaded", detail: `${uploadedCount}/${totalTracks || active.length || "?"} uploaded` };
  if (approved) return { key: "ready", label: "Ready", detail: `${approved} approved video${approved === 1 ? "" : "s"} waiting` };
  if (draft) return { key: "review", label: "Review", detail: `${draft} video${draft === 1 ? "" : "s"} waiting for approval` };
  if (active.length) return { key: "queued", label: "Queued", detail: `${active.length} item${active.length === 1 ? "" : "s"} saved` };
  return { key: "not-started", label: "Not started", detail: "No album-video queue yet" };
}

function selectedAlbumVideoAlbum() {
  const value = $("#albumVideoAlbumSelect")?.value || "";
  return state.albumVideoAlbums.find((album) => album.album === value) || null;
}

function renderAlbumVideos() {
  migrateAlbumVideoQueues();
  if (!state.albumVideoActiveAlbum && state.albumVideoAlbums.length) {
    setAlbumVideoActiveAlbum(state.albumVideoAlbums[0].album, { preserveCurrent: false });
  }
  setText("#albumVideoAlbumCount", String(state.albumVideoAlbums.length || 0));
  const ready = state.albumVideoItems.filter((item) => item.status === "approved" && !item.youtubeVideoId && !item.youtubeUrl).length;
  setText("#albumVideoReadyCount", String(ready));

  const select = $("#albumVideoAlbumSelect");
  if (select) {
    const previous = state.albumVideoActiveAlbum || select.value;
    select.innerHTML = state.albumVideoAlbums.length
      ? state.albumVideoAlbums.map((album) => {
        const status = albumVideoStatusInfo(album);
        return `<option value="${escapeHtml(album.album)}">${escapeHtml(album.album)} | ${escapeHtml(status.label)} | ${album.localAudioCount}/${album.trackCount} local audio</option>`;
      }).join("")
      : `<option value="">No albums loaded yet</option>`;
    if (previous && state.albumVideoAlbums.some((album) => album.album === previous)) {
      select.value = previous;
    } else if (state.albumVideoAlbums[0]) {
      select.value = state.albumVideoAlbums[0].album;
      setAlbumVideoActiveAlbum(select.value, { preserveCurrent: false });
    }
  }

  renderAlbumVideoStatusList();

  const selected = selectedAlbumVideoAlbum();
  if (selected && state.albumVideoActiveAlbum !== selected.album) {
    setAlbumVideoActiveAlbum(selected.album, { preserveCurrent: false });
  }
  setText("#albumVideoTrackCount", String(selected?.trackCount || 0));

  const preview = $("#albumVideoTrackPreview");
  if (preview) {
    const album = selectedAlbumVideoAlbum();
    preview.innerHTML = album
      ? `
        <div class="album-track-summary">
          <strong>Tracks in this album</strong>
          <span>${album.localAudioCount}/${album.trackCount} local audio ready</span>
          ${album.localArtworkCount != null ? `<span>${album.localArtworkCount}/${album.trackCount} artwork found</span>` : ""}
        </div>
        ${album.tracks.slice(0, 24).map((track, index) => `
          <span>${index + 1}. ${escapeHtml(track.title)}${track.audio ? "" : " (missing audio)"}</span>
        `).join("")}
        ${album.tracks.length > 24 ? `<span>+${album.tracks.length - 24} more track${album.tracks.length - 24 === 1 ? "" : "s"}</span>` : ""}
      `
      : `<p class="note">Refresh albums to load the active profile catalogue.</p>`;
  }

  const list = $("#albumVideoList");
  if (!list) return;
  if (!state.albumVideoItems.length) {
    list.innerHTML = `<p class="note">This album has no saved review queue yet. Click Start render to create its own queue.</p>`;
    renderAlbumPlaylistCopyPanel();
    return;
  }

  list.innerHTML = state.albumVideoItems.map((item) => {
    const posted = isAlbumVideoPosted(item);
    const status = posted ? "posted" : item.status || "draft";
    const isCompilation = String(item.template || "").toLowerCase() === "youtube-full-album";
    const isTest = item.testRender || status === "test";
    const typeLabel = isTest ? "Test preview video" : isCompilation ? "Full album compilation" : "Individual track video";
    const visualLabel = item.visualLayout === "pexels-seamless"
      ? "Pexels seamless"
      : item.visualLayout === "artwork-feature"
        ? "Artwork feature"
        : "";
    return `
      <article class="album-video-card ${isCompilation ? "album-compilation-card" : ""}" data-id="${escapeHtml(item.id)}">
        <a class="album-video-preview" href="${item.video ? pathToFileUrl(item.video) : "#albumVideos"}" target="_blank" rel="noreferrer" style="${item.preview ? `background-image:url('${pathToFileUrl(item.preview)}')` : ""}">
          <span>${item.video ? "Open MP4" : "No MP4"}</span>
        </a>
        <div class="album-video-body">
          <div class="panel-title-row">
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(typeLabel)} | ${escapeHtml(item.album)}${item.durationSeconds ? ` | ${formatDuration(item.durationSeconds)}` : ""}${item.sourceDurationSeconds && isTest ? ` test from ${formatDuration(item.sourceDurationSeconds)}` : ""}</span>
              ${visualLabel ? `<span>Visual: ${escapeHtml(visualLabel)}${item.visualSourceName ? ` | ${escapeHtml(item.visualSourceName)}` : ""}</span>` : ""}
            </div>
            <span class="status-pill ${escapeHtml(status)}">${escapeHtml(status)}</span>
          </div>
          ${item.caption ? `<p>${escapeHtml(item.caption)}</p>` : ""}
          ${item.youtubeUrl ? `<a href="${escapeHtml(item.youtubeUrl)}" target="_blank" rel="noreferrer">Open YouTube upload</a>` : ""}
          ${item.youtubePublishError ? `<p class="note error-text">${escapeHtml(item.youtubePublishError)}</p>` : ""}
          <div class="button-row tight">
            ${isTest
              ? `<button class="ghost remove-album-video-test" data-id="${escapeHtml(item.id)}">Remove test</button>`
              : `
                <button class="secondary approve-album-video" data-id="${escapeHtml(item.id)}">Approve</button>
                <button class="ghost reject-album-video" data-id="${escapeHtml(item.id)}">Reject</button>
              `}
          </div>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".approve-album-video").forEach((button) => {
    button.addEventListener("click", () => updateAlbumVideoStatus(button.dataset.id, "approved"));
  });
  list.querySelectorAll(".reject-album-video").forEach((button) => {
    button.addEventListener("click", () => updateAlbumVideoStatus(button.dataset.id, "rejected"));
  });
  list.querySelectorAll(".remove-album-video-test").forEach((button) => {
    button.addEventListener("click", () => removeAlbumVideoItem(button.dataset.id));
  });
  renderAlbumPlaylistCopyPanel();
}

function renderAlbumVideoStatusList() {
  const panel = $("#albumVideoAlbumStatusList");
  if (!panel) return;
  if (!state.albumVideoAlbums.length) {
    panel.innerHTML = `<p class="note">Refresh albums to see upload status.</p>`;
    return;
  }
  const album = selectedAlbumVideoAlbum();
  if (!album) {
    panel.innerHTML = `<p class="note">Choose an album to see its current status.</p>`;
    return;
  }
  const status = albumVideoStatusInfo(album);
  const queue = albumVideoQueueFor(album.album);
  const testCount = queue.filter((item) => item.testRender || item.status === "test").length;
  const draftCount = queue.filter((item) => String(item.status || "").toLowerCase() === "draft").length;
  const approvedCount = queue.filter((item) => String(item.status || "").toLowerCase() === "approved" && !isAlbumVideoPosted(item)).length;
  const postedCount = queue.filter(isAlbumVideoPosted).length;

  panel.innerHTML = `
    <article class="active-album-status-card ${escapeHtml(status.key)}">
      <div>
        <span class="album-status-label">Selected album</span>
        <strong class="album-status-title">${escapeHtml(album.album)}</strong>
      </div>
      <span class="status-pill ${escapeHtml(status.key)}">${escapeHtml(status.label)}</span>
      <span class="album-status-detail">${escapeHtml(status.detail)}</span>
      <div class="active-album-status-metrics">
        <span>${album.trackCount} track${album.trackCount === 1 ? "" : "s"}</span>
        <span>${album.localAudioCount} audio ready</span>
        <span>${album.localArtworkCount || 0} artwork found</span>
        ${testCount ? `<span>${testCount} test preview${testCount === 1 ? "" : "s"}</span>` : ""}
        ${draftCount ? `<span>${draftCount} waiting for approval</span>` : ""}
        ${approvedCount ? `<span>${approvedCount} approved</span>` : ""}
        ${postedCount ? `<span>${postedCount} uploaded</span>` : ""}
      </div>
    </article>
  `;
}

function albumVideoTrackItems() {
  return state.albumVideoItems.filter((item) => String(item.template || "").toLowerCase() !== "youtube-full-album");
}

function albumVideoCompilationItems() {
  return state.albumVideoItems.filter((item) => String(item.template || "").toLowerCase() === "youtube-full-album");
}

function mergeAlbumVideoTestItems(existing = [], incoming = []) {
  const tests = incoming.map(normalizeReview);
  const testAlbums = new Set(tests.map((item) => item.album || "").filter(Boolean));
  const preserved = existing.filter((item) => {
    if (!item.testRender && item.status !== "test") return true;
    return !testAlbums.has(item.album || "");
  });
  return [...tests, ...preserved];
}

function playlistSeoStyle(album = "", tracks = []) {
  const signal = `${album} ${tracks.map((item) => item.title || "").join(" ")}`.toLowerCase();
  if (/piano|keys|midnight/.test(signal)) return "piano jazz, relaxing jazz piano, instrumental jazz, coffee shop music";
  if (/lofi|lo-fi|chill|zone/.test(signal)) return "lofi jazz, chill jazz, study music, relaxing background music";
  if (/bossa|latin|samba/.test(signal)) return "bossa nova jazz, latin jazz, cafe music, relaxing jazz";
  if (/hammond|organ/.test(signal)) return "Hammond organ jazz, vintage jazz, instrumental groove, jazz club music";
  if (/paris|cafe|coffee|espresso|brew|latte/.test(signal)) return "coffee jazz, cafe jazz, coffee shop ambience, relaxing instrumental jazz";
  if (/night|midnight|after hours|noir|blue/.test(signal)) return "night jazz, smooth jazz, late night jazz, relaxing jazz music";
  return "instrumental jazz, coffee jazz, background music, relaxing jazz, study music";
}

function generateAlbumPlaylistCopy(album = "", rawTracks = []) {
  const tracks = rawTracks.filter((item) => item.status !== "rejected");
  const trackLines = tracks.map((item, index) => `${index + 1}. ${item.title || "Untitled track"}`);
  const seoTerms = playlistSeoStyle(album, tracks);
  const title = `${album} | Full Album Playlist - ${seoTerms.split(",").slice(0, 2).join(" & ")}`;
  const description = [
    `${album} collected as a full YouTube playlist, featuring every full-length track video from the album.`,
    `This playlist is built for ${seoTerms}: calm listening, background focus, coffee shop ambience, study sessions, reading, work, and slow evening listening.`,
    trackLines.length ? `Tracks in this playlist:\n${trackLines.join("\n")}` : "",
    "Playlist keywords:",
    seoTerms,
    "#coffeejazz #instrumentaljazz #relaxingjazz #backgroundmusic #studymusic",
    "Listen / follow:",
    "Spotify: https://open.spotify.com/artist/0S6IzRQRufNIAl55OxmCSG?si=sHoguMfmTrmKvb9e2yrRoA",
    "Instagram: https://www.instagram.com/majascoffeejazzzone/?hl=en",
    "SoundCloud: https://soundcloud.com/majascoffeejazzzone"
  ].filter(Boolean).join("\n\n");
  return { title, description, combined: `Playlist title:\n${title}\n\nPlaylist description:\n${description}` };
}

function renderAlbumPlaylistCopyPanel() {
  const panel = $("#albumPlaylistCopyPanel");
  if (!panel) return;
  const tracks = albumVideoTrackItems();
  const compilations = albumVideoCompilationItems();
  if (!tracks.length && !compilations.length) {
    panel.innerHTML = "";
    return;
  }

  const byAlbum = new Map();
  [...tracks, ...compilations].forEach((item) => {
    const album = item.album || "Unknown album";
    const entry = byAlbum.get(album) || { album, tracks: [], compilation: null };
    if (String(item.template || "").toLowerCase() === "youtube-full-album") {
      entry.compilation = item;
    } else {
      entry.tracks.push(item);
    }
    byAlbum.set(album, entry);
  });

  panel.innerHTML = `
    <div class="panel-title-row">
      <div>
        <p class="eyebrow">Playlist Copy</p>
        <h4>YouTube playlist text</h4>
      </div>
      <span class="note">Paste this into YouTube Studio when creating the album playlist.</span>
    </div>
    ${[...byAlbum.values()].map((entry, index) => {
      const copy = generateAlbumPlaylistCopy(entry.album, entry.tracks);
      return `
        <article class="playlist-copy-card">
          <div>
            <strong>${escapeHtml(copy.title)}</strong>
            <span>${entry.tracks.length} track video${entry.tracks.length === 1 ? "" : "s"}${entry.compilation ? " + full album video" : ""}</span>
          </div>
          <label>Playlist name<input readonly value="${escapeHtml(copy.title)}" /></label>
          <label>Playlist description<textarea readonly rows="10">${escapeHtml(copy.description)}</textarea></label>
          <div class="button-row tight">
            <button class="secondary copy-playlist-text" data-playlist-copy="${index}" data-copy-kind="title">Copy title</button>
            <button class="secondary copy-playlist-text" data-playlist-copy="${index}" data-copy-kind="description">Copy description</button>
            <button class="ghost copy-playlist-text" data-playlist-copy="${index}" data-copy-kind="combined">Copy both</button>
          </div>
        </article>
      `;
    }).join("")}
  `;

  const copies = [...byAlbum.values()].map((entry) => generateAlbumPlaylistCopy(entry.album, entry.tracks));
  panel.querySelectorAll(".copy-playlist-text").forEach((button) => {
    button.addEventListener("click", () => {
      const copy = copies[Number(button.dataset.playlistCopy) || 0];
      copyAlbumPlaylistText(copy?.[button.dataset.copyKind] || "");
    });
  });
}

async function copyAlbumPlaylistText(text = "") {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("#albumVideoStatus", "Playlist text copied.");
  } catch {
    setStatus("#albumVideoStatus", "Could not copy automatically. Select the playlist text and copy it manually.");
  }
}

async function loadAlbumVideoAlbums() {
  setStatus("#albumVideoStatus", "Loading albums from the active profile catalogue...");
  try {
    const response = await fetch(`${backendUrl}/api/album-videos/albums?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const result = await response.json();
    if (!result.ok) {
      setStatus("#albumVideoStatus", result.message || "Could not load albums.");
      return;
    }
    state.albumVideoAlbums = result.albums || [];
    migrateAlbumVideoQueues();
    const activeExists = state.albumVideoAlbums.some((album) => album.album === state.albumVideoActiveAlbum);
    const nextAlbum = activeExists ? state.albumVideoActiveAlbum : state.albumVideoAlbums[0]?.album || "";
    if (nextAlbum) setAlbumVideoActiveAlbum(nextAlbum, { preserveCurrent: false });
    setStatus("#albumVideoStatus", result.message || "Albums loaded.");
    renderAlbumVideos();
  } catch (error) {
    setStatus("#albumVideoStatus", `Could not load albums: ${error.message || "backend unavailable"}`);
  }
}

async function startAlbumVideoTestRenderFromGui() {
  const album = $("#albumVideoAlbumSelect")?.value || "";
  if (!album) {
    setStatus("#albumVideoStatus", "Choose an album first.");
    return;
  }

  setAlbumVideoActiveAlbum(album);
  setAlbumVideoProgress({ percent: 0, stage: "starting", current: 0, total: 1, message: `Starting test video for ${album}...` });
  setAlbumVideoRenderControls(true);
  setStatus("#albumVideoStatus", `Creating a short album-video test for ${album}...`);

  try {
    const result = await postBackend("/api/album-videos/render/test", {
      profileId: state.activeProfileId,
      album,
      renderPreset: $("#albumVideoRenderPreset")?.value || "fast",
      fadeOutSeconds: 4,
      renderTimeoutSeconds: 600,
      testDurationSeconds: 30
    });
    if (!result.ok) {
      setStatus("#albumVideoStatus", result.message || "Album-video test could not start.");
      setAlbumVideoRenderControls(false);
      return;
    }
    setStatus("#albumVideoStatus", result.message || "Album-video test render started.");
    startAlbumVideoPolling();
  } catch (error) {
    setAlbumVideoRenderControls(false);
    setStatus("#albumVideoStatus", `Album-video test failed to start: ${error.message || "backend unavailable"}`);
  }
}

async function startAlbumVideoRenderFromGui() {
  const album = $("#albumVideoAlbumSelect")?.value || "";
  if (!album) {
    setStatus("#albumVideoStatus", "Choose an album first.");
    return;
  }
  const selected = selectedAlbumVideoAlbum();
  const count = selected?.localAudioCount || selected?.trackCount || 0;
  if (!confirm(`Render full-length videos for ${count || "all"} track${count === 1 ? "" : "s"} in "${album}"? This can take a while.`)) return;

  setAlbumVideoActiveAlbum(album);
  state.albumVideoItems = [];
  saveCurrentAlbumVideoQueue();
  renderAlbumVideos();
  setAlbumVideoProgress({ percent: 0, stage: "starting", current: 0, total: count, message: `Starting album render for ${album}...` });
  setAlbumVideoRenderControls(true);
  setStatus("#albumVideoStatus", `Starting full-album render for ${album}...`);

  try {
    const result = await postBackend("/api/album-videos/render/start", {
      profileId: state.activeProfileId,
      album,
      renderPreset: $("#albumVideoRenderPreset")?.value || "balanced",
      fadeOutSeconds: 8,
      renderTimeoutSeconds: 1800
    });
    if (!result.ok) {
      setStatus("#albumVideoStatus", result.message || "Album render could not start.");
      setAlbumVideoRenderControls(false);
      return;
    }
    setStatus("#albumVideoStatus", result.message || "Album render started.");
    startAlbumVideoPolling();
  } catch (error) {
    setAlbumVideoRenderControls(false);
    setStatus("#albumVideoStatus", `Album render failed to start: ${error.message || "backend unavailable"}`);
  }
}

function startAlbumVideoPolling() {
  if (albumVideoPollTimer) clearInterval(albumVideoPollTimer);
  pollAlbumVideoRenderStatus();
  albumVideoPollTimer = setInterval(pollAlbumVideoRenderStatus, 2000);
}

async function pollAlbumVideoRenderStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/youtube/videos/render/status`);
    const status = await response.json();
    state.albumVideoStatus = status;
    setAlbumVideoProgress(status.progress || {}, status);
    if (!status.running) {
      if (albumVideoPollTimer) clearInterval(albumVideoPollTimer);
      albumVideoPollTimer = null;
      setAlbumVideoRenderControls(false);
      if (status.result?.ok && Array.isArray(status.result.items)) {
        const renderedItems = status.result.items.map(normalizeReview);
        const isTestRender = renderedItems.some((item) => item.testRender || item.status === "test");
        state.albumVideoItems = isTestRender ? mergeAlbumVideoTestItems(state.albumVideoItems, renderedItems) : renderedItems;
        const renderedAlbum = albumVideoQueueAlbum(state.albumVideoItems);
        if (renderedAlbum) state.albumVideoActiveAlbum = renderedAlbum;
        saveCurrentAlbumVideoQueue();
        renderAlbumVideos();
        setStatus("#albumVideoStatus", isTestRender
          ? `${status.result.message || "Album-video test complete."} Open the test MP4 below to preview the style.`
          : `${status.result.message || "Album render complete."} Review and approve the videos below.`);
      } else if (status.cancelled) {
        setStatus("#albumVideoStatus", "Album render stopped.");
      } else if (status.error) {
        setStatus("#albumVideoStatus", `Album render failed: ${status.error}`);
      }
    }
  } catch (error) {
    if (albumVideoPollTimer) clearInterval(albumVideoPollTimer);
    albumVideoPollTimer = null;
    setAlbumVideoRenderControls(false);
    setStatus("#albumVideoStatus", "Lost connection to the backend while rendering album videos.");
  }
}

function setAlbumVideoProgress(progress = {}, status = {}) {
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const bar = $("#albumVideoProgressBar");
  if (bar) bar.style.width = `${percent}%`;
  const label = $("#albumVideoProgressLabel");
  if (!label) return;
  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  const stage = progress.stage || "idle";
  const message = progress.message || "Waiting";
  const startedAt = status.startedAt ? new Date(status.startedAt) : null;
  const elapsed = startedAt && !Number.isNaN(startedAt.getTime()) ? ` | Elapsed: ${formatDuration(Math.floor((Date.now() - startedAt.getTime()) / 1000))}` : "";
  label.textContent = `${stage} | ${current}/${total || 0} | ${Math.round(percent)}% | ${message}${elapsed}`;
}

function setAlbumVideoRenderControls(isRunning) {
  const test = $("#renderAlbumVideoTest");
  const start = $("#renderSelectedAlbumVideos");
  const stop = $("#stopAlbumVideoRender");
  const upload = $("#uploadAlbumVideos");
  if (test) test.disabled = Boolean(isRunning);
  if (start) start.disabled = Boolean(isRunning);
  if (stop) stop.disabled = !isRunning;
  if (upload) upload.disabled = Boolean(isRunning);
}

async function stopAlbumVideoRenderFromGui() {
  setStatus("#albumVideoStatus", "Stopping album render...");
  setAlbumVideoRenderControls(true);
  try {
    await postBackend("/api/youtube/videos/render/cancel", {});
    await pollAlbumVideoRenderStatus();
  } catch (error) {
    setAlbumVideoRenderControls(false);
    setStatus("#albumVideoStatus", "Could not stop album render. Check the backend.");
  }
}

function updateAlbumVideoStatus(id, status) {
  state.albumVideoItems = state.albumVideoItems.map((item) => item.id === id ? { ...item, status } : item);
  saveCurrentAlbumVideoQueue();
  renderAlbumVideos();
}

function removeAlbumVideoItem(id) {
  state.albumVideoItems = state.albumVideoItems.filter((item) => item.id !== id);
  saveCurrentAlbumVideoQueue();
  renderAlbumVideos();
  setStatus("#albumVideoStatus", "Test video removed from the review list. The MP4 file was left on disk.");
}

function updateAllAlbumVideoStatuses(status) {
  state.albumVideoItems = state.albumVideoItems.map((item) => {
    if (item.youtubeVideoId || item.youtubeUrl || item.youtubePublishStatus === "published") return item;
    if (item.testRender || item.status === "test") return item;
    return { ...item, status };
  });
  saveCurrentAlbumVideoQueue();
  renderAlbumVideos();
}

async function uploadAlbumVideosFromGui() {
  const approved = state.albumVideoItems.filter((item) => item.status === "approved" && !item.testRender && !item.youtubeVideoId && !item.youtubeUrl);
  if (!approved.length) {
    setStatus("#albumVideoStatus", "No approved album videos are ready to upload.");
    return;
  }
  const privacy = $("#albumVideoPrivacy")?.value || "private";
  if (!confirm(`Upload ${approved.length} approved full-length album video${approved.length === 1 ? "" : "s"} to YouTube as ${privacy}?`)) return;
  setStatus("#albumVideoStatus", `Uploading ${approved.length} album video${approved.length === 1 ? "" : "s"} to YouTube...`);
  try {
    const result = await postBackend("/api/album-videos/upload", {
      profileId: state.activeProfileId,
      privacy,
      items: state.albumVideoItems
    });
    if (Array.isArray(result.items)) {
      state.albumVideoItems = result.items.map(normalizeReview);
      saveCurrentAlbumVideoQueue();
      renderAlbumVideos();
    }
    setStatus("#albumVideoStatus", result.message || "Album upload finished.");
  } catch (error) {
    setStatus("#albumVideoStatus", `Album upload failed: ${error.message || "Check YouTube credentials and backend status."}`);
  }
}

async function compileFullAlbumVideoFromGui() {
  const trackItems = albumVideoTrackItems().filter((item) => item.video && item.status !== "rejected");
  if (trackItems.length < 2) {
    setStatus("#albumVideoStatus", "Need at least two rendered track videos before creating the full album video.");
    return;
  }
  const album = trackItems[0]?.album || selectedAlbumVideoAlbum()?.album || "";
  if (!confirm(`Create one combined full-album video from ${trackItems.length} rendered track video${trackItems.length === 1 ? "" : "s"}${album ? ` for "${album}"` : ""}?`)) return;
  setStatus("#albumVideoStatus", "Creating the single full album MP4 from the rendered track videos...");
  try {
    const result = await postBackend("/api/album-videos/compile", {
      profileId: state.activeProfileId,
      album,
      items: state.albumVideoItems
    });
    if (Array.isArray(result.items)) {
      state.albumVideoItems = result.items.map(normalizeReview);
      saveCurrentAlbumVideoQueue();
      renderAlbumVideos();
    }
    setStatus("#albumVideoStatus", result.message || "Full album video compile finished.");
  } catch (error) {
    setStatus("#albumVideoStatus", `Full album video compile failed: ${error.message || "backend unavailable"}`);
  }
}

async function cleanupPartialAlbumVideosFromGui() {
  setStatus("#albumVideoStatus", "Scanning incomplete album render batches...");
  try {
    const preview = await postBackend("/api/album-videos/cleanup-partials", {
      profileId: state.activeProfileId,
      apply: false,
      items: state.albumVideoItems
    });
    if (!preview.ok) {
      setStatus("#albumVideoStatus", preview.message || "Could not scan incomplete album renders.");
      return;
    }
    const total = Number(preview.totalCandidates || 0);
    if (!total) {
      setStatus("#albumVideoStatus", "No incomplete album render batches found. Current review videos were protected.");
      return;
    }
    const sample = (preview.items || [])
      .slice(0, 5)
      .map((item) => `- ${item.name}: ${item.reason}`)
      .join("\n");
    const confirmed = confirm(
      `${preview.message}\n\n${sample}${total > 5 ? `\n...and ${total - 5} more` : ""}\n\nDelete these incomplete local render folders? Current Album Videos review items will be kept.`
    );
    if (!confirmed) {
      setStatus("#albumVideoStatus", "Incomplete render cleanup cancelled. Nothing was deleted.");
      return;
    }
    setStatus("#albumVideoStatus", "Deleting incomplete album render batches...");
    const result = await postBackend("/api/album-videos/cleanup-partials", {
      profileId: state.activeProfileId,
      apply: true,
      items: state.albumVideoItems
    });
    setStatus("#albumVideoStatus", result.message || "Incomplete album render cleanup finished.");
  } catch (error) {
    setStatus("#albumVideoStatus", `Incomplete album render cleanup failed: ${error.message || "backend unavailable"}`);
  }
}

function updateYouTubeVideoReviewStatus(id, status) {
  const item = state.youtubeVideoReviews.find((review) => review.id === id);
  if (!item) return;
  if (status === "rejected") {
    rejectReviewItem(item, "youtube-video", () => {
      state.youtubeVideoReviews = applyScheduleToYouTubeVideos(state.youtubeVideoReviews);
      renderYouTubeVideoReviews();
      syncYouTubeVideoPlanToBackend();
    });
    return;
  }
  item.status = status;
  if (status !== "rejected") {
    item.rejectionReason = "";
    item.rejectedAt = "";
  }
  state.youtubeVideoReviews = applyScheduleToYouTubeVideos(state.youtubeVideoReviews);
  save();
  renderYouTubeVideoReviews();
  syncYouTubeVideoPlanToBackend();
}

function updateAllYouTubeVideoReviewStatuses(status) {
  const reason = status === "rejected" ? askRejectionReason(state.youtubeVideoReviews.length) : "";
  if (status === "rejected" && !reason) return;
  state.youtubeVideoReviews = state.youtubeVideoReviews.map((item) => (
    item.status !== "render_failed"
      ? {
          ...item,
          status,
          rejectionReason: status === "rejected" ? reason : "",
          rejectedAt: status === "rejected" ? new Date().toISOString() : ""
        }
      : item
  ));
  if (status === "rejected") {
    state.youtubeVideoReviews
      .filter((item) => item.status === "rejected" && item.rejectionReason === reason)
      .forEach((item) => sendReviewFeedback(item, "youtube-video"));
  }
  state.youtubeVideoReviews = applyScheduleToYouTubeVideos(state.youtubeVideoReviews);
  save();
  renderYouTubeVideoReviews();
  syncYouTubeVideoPlanToBackend();
}

function updateYouTubeVideoReviewText(id, field, value) {
  const item = state.youtubeVideoReviews.find((review) => review.id === id);
  if (!item) return;
  item[field] = value;
  save();
  syncYouTubeVideoPlanToBackend();
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const remainder = Math.floor(total % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function getVisibleReviews() {
  const playableReviews = state.reviews.filter(isPlayableReview);
  if (state.reviewFilter === "all") {
    return playableReviews.filter((item) => item.status === "draft");
  }
  return playableReviews.filter((item) => item.status === state.reviewFilter);
}

function isPlayableReview(item = {}) {
  return Boolean(item.video && /\.mp4$/i.test(item.video) && item.status !== "render_failed");
}

function updateReviewStatus(id, status) {
  const item = state.reviews.find((review) => review.id === id);
  if (!item) return;
  if (status === "rejected") {
    rejectReviewItem(item, "reel", () => {
      renderReviews();
      syncReviewCacheToBackend("rejected-item");
    });
    return;
  }
  item.status = status;
  if (status !== "rejected") {
    item.rejectionReason = "";
    item.rejectedAt = "";
  }
  save();
  renderReviews();
  syncReviewCacheToBackend("status-change");
}

function updateVisibleReviewStatuses(status) {
  const visibleReviews = getVisibleReviews().filter((item) => item.status !== "render_failed");
  const visibleIds = new Set(visibleReviews.map((item) => item.id));
  if (!visibleIds.size) return;
  const reason = status === "rejected" ? askRejectionReason(visibleIds.size) : "";
  if (status === "rejected" && !reason) return;
  const rejectedAt = new Date().toISOString();
  state.reviews = state.reviews.map((item) => (
    visibleIds.has(item.id) && item.status !== "render_failed"
      ? {
          ...item,
          status,
          rejectionReason: status === "rejected" ? reason : "",
          rejectedAt: status === "rejected" ? rejectedAt : ""
        }
      : item
  ));
  if (status === "rejected") {
    state.reviews
      .filter((item) => visibleIds.has(item.id))
      .forEach((item) => sendReviewFeedback(item, "reel"));
  }
  save();
  renderReviews();
  syncReviewCacheToBackend(`bulk-${status}`);
}

function renderRejectionReason(node, item) {
  if (!item.rejectionReason) return;
  const body = node.querySelector(".review-body");
  const actions = node.querySelector(".button-row");
  if (!body || !actions) return;
  const note = document.createElement("p");
  note.className = "rejection-note";
  note.textContent = `Rejected: ${item.rejectionReason}`;
  body.insertBefore(note, actions);
}

function askRejectionReason(count = 1) {
  const intro = count > 1
    ? `Why reject these ${count} review items?`
    : "Why reject this review item?";
  const reason = prompt(`${intro}\n\nThis helps future batches avoid the same issue. Example: wrong track title, audio mismatch, bad artwork, too repetitive.`);
  return String(reason || "").trim();
}

function rejectReviewItem(item, source, afterSave) {
  const reason = askRejectionReason(1);
  if (!reason) return;
  item.status = "rejected";
  item.rejectionReason = reason;
  item.rejectedAt = new Date().toISOString();
  save();
  sendReviewFeedback(item, source);
  if (typeof afterSave === "function") afterSave();
}

async function sendReviewFeedback(item, source) {
  try {
    await postBackend("/api/review-feedback", {
      source,
      reason: item.rejectionReason,
      item
    });
  } catch (error) {
    setStatus("#reviewImportStatus", `Rejected locally, but feedback was not saved to the backend: ${error.message || "backend unavailable"}`);
  }
}

function updateReviewText(id, field, value) {
  const item = state.reviews.find((review) => review.id === id);
  if (!item) return;
  item[field] = value;
  save();
}

function importReviews(items) {
  const existing = new Map(state.reviews.map((item) => [item.id, item]));
  items.map(normalizeReview).filter(isPlayableReview).forEach((item) => {
    existing.set(item.id, { ...existing.get(item.id), ...item });
  });
  state.reviews = [...existing.values()];
  save();
  renderReviews();
  syncReviewCacheToBackend("import-review");
}

function replaceReviews(items) {
  state.reviews = items.map(normalizeReview).filter(isPlayableReview);
  state.reviewFilter = "all";
  save();
  document.querySelectorAll("[data-review-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reviewFilter === "all");
  });
  renderReviews();
  syncReviewCacheToBackend("replace-review");
}

async function loadReviewCacheFromBackend(options = {}) {
  const silent = options.silent !== false;
  const replaceExisting = Boolean(options.replaceExisting);
  if (!replaceExisting && state.reviews.some(isPlayableReview)) return;
  try {
    const response = await fetch(`${backendUrl}/api/review/cache?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const result = await response.json();
    if (!result.ok || !Array.isArray(result.items) || !result.items.length) {
      if (!silent) setReviewLoadStatus(result.message || "No cached review queue found.", "error");
      return;
    }
    state.reviews = result.items.map(normalizeReview).filter(isPlayableReview);
    state.reviewFilter = "all";
    save();
    renderReviews();
    setReviewLoadStatus(`${result.message || "Cached review queue restored."} These were saved on disk after rendering.`, "success");
  } catch (error) {
    if (!silent) setReviewLoadStatus("Could not load the cached review queue. Check the backend.", "error");
  }
}

async function syncReviewCacheToBackend(source = "browser-review") {
  try {
    await postBackend("/api/review/cache", {
      profileId: state.activeProfileId,
      source,
      items: state.reviews.filter(isPlayableReview)
    });
  } catch {}
}

function exportApproved() {
  const approved = state.reviews.filter((item) => item.status === "approved" && isPlayableReview(item));
  if (!approved.length) {
    alert("No approved Reels yet.");
    return;
  }
  downloadJson("approved-reels.json", {
    exportedAt: new Date().toISOString(),
    postingSettings: getPostingSettings(),
    items: approved
  });
}

function getApprovedReviews() {
  return state.reviews.filter((item) => item.status === "approved" && isPlayableReview(item));
}

function sendApprovedToPublishingQueue() {
  const approved = getApprovedReviews();
  if (!approved.length) {
    alert("No approved Reels yet. Mark at least one item as approved in Review.");
    return;
  }
  const freshSchedule = approved.map((item) => ({ ...item, scheduledFor: "" }));
  importPublishingQueue(freshSchedule, getPostingSettings());
  location.hash = "publishingQueue";
}

function normalizePublishItem(item, settings = getPostingSettings(), index = 0) {
  const baseDate = defaultPublishDate(index, settings);
  const destinations = normalizeDestinations(item.destinations || item.Destinations);

  return {
    id: stableRenderedItemId(item),
    status: item.status || item.Status || item.publishStatus || "ready",
    platform: settings.defaultPostType === "story" ? "instagram-story" : settings.defaultPostType === "feed" ? "instagram-feed" : "instagram-reel",
    destinations,
    scheduledFor: item.scheduledFor || toLocalDateTime(baseDate),
    account: settings.igAccount,
    title: item.title || item.Title || "Untitled",
    album: item.album || item.Album || "Unknown album",
    isrc: item.isrc || item.ISRC || "",
    video: item.video || item.Video || "",
    publicVideoUrl: item.publicVideoUrl || item.PublicVideoUrl || item.videoUrl || item.VideoUrl || "",
    containerId: item.containerId || "",
    containerStatus: item.containerStatus || "",
    publishedAt: item.publishedAt || "",
    instagramMediaId: item.instagramMediaId || "",
    publishStatus: item.publishStatus || "",
    publishError: item.publishError || "",
    youtubeShortVideoId: item.youtubeShortVideoId || "",
    youtubeShortUrl: item.youtubeShortUrl || "",
    youtubeShortUploadedAt: item.youtubeShortUploadedAt || "",
    youtubeShortPublishStatus: item.youtubeShortPublishStatus || item.YouTubeShortPublishStatus || "",
    youtubeShortPublishError: item.youtubeShortPublishError || item.YouTubeShortPublishError || "",
    youtubeVideoId: item.youtubeVideoId || item.YouTubeVideoId || "",
    youtubeUrl: item.youtubeUrl || item.YouTubeUrl || "",
    youtubePublishStatus: item.youtubePublishStatus || item.YouTubePublishStatus || item.youtubeVideoPublishStatus || item.YouTubeVideoPublishStatus || "",
    youtubePublishError: item.youtubePublishError || item.YouTubePublishError || item.youtubeVideoPublishError || item.YouTubeVideoPublishError || "",
    facebookMediaId: item.facebookMediaId || item.FacebookMediaId || "",
    facebookPublishStatus: item.facebookPublishStatus || item.FacebookPublishStatus || "",
    facebookPublishError: item.facebookPublishError || item.FacebookPublishError || "",
    apiMessage: item.apiMessage || item.ApiMessage || "",
    preview: item.preview || item.Preview || "",
    audio: item.audio || item.Audio || "",
    artwork: item.artwork || item.Artwork || "",
    template: item.template || item.Template || "",
    variantIndex: item.variantIndex || item.VariantIndex || "",
    variantCount: item.variantCount || item.VariantCount || "",
    variantRole: item.variantRole || item.VariantRole || "",
    variantLabel: item.variantLabel || item.VariantLabel || "",
    atmosphereEffect: item.atmosphereEffect || item.AtmosphereEffect || "",
    artworkMotionTag: item.artworkMotionTag || item.ArtworkMotionTag || "",
    albumThemeMood: item.albumThemeMood || item.AlbumThemeMood || "",
    albumTheme: item.albumTheme || item.AlbumTheme || "",
    albumThemeStyle: item.albumThemeStyle || item.AlbumThemeStyle || "",
    albumThemeScene: item.albumThemeScene || item.AlbumThemeScene || "",
    albumThemeInstruments: item.albumThemeInstruments || item.AlbumThemeInstruments || "",
    albumThemeSearchTerms: item.albumThemeSearchTerms || item.AlbumThemeSearchTerms || "",
    albumThemeNegativeTerms: item.albumThemeNegativeTerms || item.AlbumThemeNegativeTerms || "",
    shortType: item.shortType || item.ShortType || "",
    shortTypeLabel: item.shortTypeLabel || item.ShortTypeLabel || "",
    descriptionMode: item.descriptionMode || item.DescriptionMode || "",
    descriptionModeLabel: item.descriptionModeLabel || item.DescriptionModeLabel || "",
    campaignId: item.campaignId || item.CampaignId || "",
    seoTitle: item.seoTitle || item.SeoTitle || "",
    keywords: item.keywords || item.Keywords || "",
    visualConcept: item.visualConcept || item.VisualConcept || "",
    visualSearchTerms: item.visualSearchTerms || item.VisualSearchTerms || "",
    visualThemeBasis: item.visualThemeBasis || item.VisualThemeBasis || "",
    visualPrompt: item.visualPrompt || item.VisualPrompt || "",
    visualSourcingPlan: item.visualSourcingPlan || item.VisualSourcingPlan || "",
    approvedVisualSources: item.approvedVisualSources || item.ApprovedVisualSources || "",
    visualLicensingNotes: item.visualLicensingNotes || item.VisualLicensingNotes || "",
    visualSourceStatus: item.visualSourceStatus || item.VisualSourceStatus || "",
    visualLayout: item.visualLayout || item.VisualLayout || "",
    visualAssetPath: item.visualAssetPath || item.VisualAssetPath || "",
    visualSourceName: item.visualSourceName || item.VisualSourceName || "",
    visualSourceUrl: item.visualSourceUrl || item.VisualSourceUrl || "",
    visualSourceLicense: item.visualSourceLicense || item.VisualSourceLicense || "",
    visualSourceCreator: item.visualSourceCreator || item.VisualSourceCreator || "",
    visualSourceAttribution: item.visualSourceAttribution || item.VisualSourceAttribution || "",
    audience: item.audience || item.Audience || "",
    metadataStrategy: item.metadataStrategy || item.MetadataStrategy || "",
    caption: item.caption || item.Caption || "",
    hashtags: item.hashtags || item.Hashtags || "",
    profileSourceProfileId: item.profileSourceProfileId || item.ProfileSourceProfileId || "",
    profileSourceLocked: item.profileSourceLocked === true || String(item.ProfileSourceLocked || item.profileSourceLocked || "").toLowerCase() === "true"
  };
}

function defaultPublishDate(index = 0, settings = getPostingSettings()) {
  const times = settings.shortScheduleTimes?.length ? settings.shortScheduleTimes : AUTO_APPROVED_SCHEDULE_TIMES;
  const perDay = Math.max(1, Math.min(Number(settings.shortsPerDay) || times.length || 1, times.length || 1));
  const dayOffset = Math.floor(index / perDay);
  const time = times[index % perDay] || times[0] || "01:00";
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours || 0, minutes || 0, 0, 0);
  if (date.getTime() <= Date.now() && dayOffset === 0) {
    date.setDate(date.getDate() + 1);
  }
  date.setDate(date.getDate() + dayOffset);
  return date;
}

function toLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const AUTO_APPROVED_SCHEDULE_TIMES = ["06:00", "11:00", "14:00"];

function isAutoScheduleCandidate(item = {}) {
  const status = String(item.status || "").toLowerCase();
  const publishStatus = String(item.publishStatus || "").toLowerCase();
  const youtubeShortStatus = String(item.youtubeShortPublishStatus || "").toLowerCase();
  const youtubeVideoStatus = String(item.youtubePublishStatus || item.youtubeVideoPublishStatus || "").toLowerCase();
  if (["posted", "published", "rejected", "held"].includes(status)) return false;
  if (["published", "held"].includes(publishStatus)) return false;
  if (youtubeShortStatus === "published" || youtubeVideoStatus === "published") return false;
  if (item.instagramMediaId || item.facebookMediaId || item.youtubeShortVideoId || item.youtubeVideoId || item.youtubeUrl) return false;
  return true;
}

function autoScheduleDestinations(slotIndex = 0) {
  return {
    instagram: slotIndex === 0,
    facebook: slotIndex === 0,
    youtubeShorts: true,
    youtubeVideo: false
  };
}

function autoScheduleSlotSummary(slotIndex = 0) {
  if (slotIndex === 0) return "Instagram, Facebook, and YouTube Shorts";
  return "YouTube Shorts only";
}

function scheduleSlotDate(startDate, dayOffset, time) {
  const [hour, minute] = String(time || "06:00").split(":").map(Number);
  return new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate() + dayOffset,
    Math.max(0, Math.min(23, hour || 0)),
    Math.max(0, Math.min(59, minute || 0)),
    0,
    0
  );
}

function scheduleSortValue(item = {}) {
  const scheduled = Date.parse(item.scheduledFor || "");
  if (Number.isFinite(scheduled)) return scheduled;
  const added = Date.parse(item.planAddedAt || item.approvedAt || item.renderedAt || "");
  if (Number.isFinite(added)) return added;
  return Number.MAX_SAFE_INTEGER;
}

function scheduleTrackKey(item = {}) {
  const preferred = item.isrc || item.ISRC || item.trackId || item.TrackId || item.sourceAudioPath || item.audioPath || "";
  const fallback = `${item.profileId || state.activeProfileId || ""}|${item.artist || ""}|${item.album || ""}|${item.title || ""}`;
  return String(preferred || fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-") || String(item.id || "").toLowerCase();
}

function scheduleVariantSortValue(item = {}) {
  const variantIndex = Number(item.variantIndex || item.VariantIndex || 1);
  return Number.isFinite(variantIndex) ? variantIndex : 1;
}

function rotateScheduleCandidatesByTrack(candidates = []) {
  const grouped = new Map();
  candidates.forEach((item) => {
    const key = scheduleTrackKey(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });

  const groups = [...grouped.values()].map((group) => group.sort((a, b) => {
    const byVariant = scheduleVariantSortValue(a) - scheduleVariantSortValue(b);
    if (byVariant) return byVariant;
    const byDate = scheduleSortValue(a) - scheduleSortValue(b);
    if (byDate) return byDate;
    return `${a.album || ""}|${a.title || ""}`.localeCompare(`${b.album || ""}|${b.title || ""}`);
  })).sort((a, b) => {
    const byDate = scheduleSortValue(a[0]) - scheduleSortValue(b[0]);
    if (byDate) return byDate;
    return `${a[0].album || ""}|${a[0].title || ""}`.localeCompare(`${b[0].album || ""}|${b[0].title || ""}`);
  });

  const rotated = [];
  const maxGroupLength = groups.reduce((max, group) => Math.max(max, group.length), 0);
  for (let round = 0; round < maxGroupLength; round += 1) {
    groups.forEach((group) => {
      if (group[round]) rotated.push(group[round]);
    });
  }
  return rotated;
}

function autoScheduleSlotKey(dayOffset, slotIndex) {
  return `${dayOffset}:${slotIndex}`;
}

function findAutoScheduleSlot(item, usedSlots, usedTracksByDay, lastTrackDate, startDate, times) {
  const trackKey = scheduleTrackKey(item);
  const minSameTrackGapMs = 48 * 60 * 60 * 1000;
  const maxDays = Math.max(90, Math.ceil((usedSlots.size + 1) / Math.max(1, times.length)) + 60);
  let fallback = null;

  for (let dayOffset = 0; dayOffset <= maxDays; dayOffset += 1) {
    const dayKey = toLocalDateTime(scheduleSlotDate(startDate, dayOffset, times[0] || "06:00")).slice(0, 10);
    if (usedTracksByDay.get(dayKey)?.has(trackKey)) continue;

    for (let slotIndex = 0; slotIndex < times.length; slotIndex += 1) {
      const slotKey = autoScheduleSlotKey(dayOffset, slotIndex);
      if (usedSlots.has(slotKey)) continue;
      const slotDate = scheduleSlotDate(startDate, dayOffset, times[slotIndex]);
      const lastDate = lastTrackDate.get(trackKey);
      const respectsSpacing = !lastDate || Math.abs(slotDate.getTime() - lastDate.getTime()) >= minSameTrackGapMs;
      const candidate = { dayOffset, slotIndex, slotDate, dayKey, respectsSpacing };
      if (respectsSpacing) return candidate;
      if (!fallback) fallback = candidate;
    }
  }

  return fallback;
}

function autoFillScheduleItems(items = [], { startDate = new Date(), times = AUTO_APPROVED_SCHEDULE_TIMES } = {}) {
  const normalized = items.map((item, index) => normalizePublishItem(item, getPostingSettings(), index));
  const candidates = normalized
    .filter(isAutoScheduleCandidate)
    .sort((a, b) => {
      const byDate = scheduleSortValue(a) - scheduleSortValue(b);
      if (byDate) return byDate;
      return `${a.album || ""}|${a.title || ""}`.localeCompare(`${b.album || ""}|${b.title || ""}`);
    });
  const rotated = rotateScheduleCandidatesByTrack(candidates);
  const updates = new Map();
  const usedSlots = new Set();
  const usedTracksByDay = new Map();
  const lastTrackDate = new Map();

  rotated.forEach((item) => {
    const slot = findAutoScheduleSlot(item, usedSlots, usedTracksByDay, lastTrackDate, startDate, times) || {
      dayOffset: Math.floor(usedSlots.size / times.length),
      slotIndex: usedSlots.size % times.length,
      slotDate: scheduleSlotDate(startDate, Math.floor(usedSlots.size / times.length), times[usedSlots.size % times.length]),
      dayKey: toLocalDateTime(scheduleSlotDate(startDate, Math.floor(usedSlots.size / times.length), times[0] || "06:00")).slice(0, 10),
      respectsSpacing: false
    };
    const trackKey = scheduleTrackKey(item);
    usedSlots.add(autoScheduleSlotKey(slot.dayOffset, slot.slotIndex));
    if (!usedTracksByDay.has(slot.dayKey)) usedTracksByDay.set(slot.dayKey, new Set());
    usedTracksByDay.get(slot.dayKey).add(trackKey);
    lastTrackDate.set(trackKey, slot.slotDate);
    updates.set(item.id, {
      scheduledFor: toLocalDateTime(slot.slotDate),
      destinations: autoScheduleDestinations(slot.slotIndex),
      scheduleNote: `Auto-filled slot ${slot.slotIndex + 1} of ${times.length}: ${autoScheduleSlotSummary(slot.slotIndex)}. Different-track daily rotation${slot.respectsSpacing ? "; same-track variants spaced at least 48 hours." : "; same-track spacing relaxed to keep the queue moving."}`,
      status: "scheduled"
    });
  });
  return {
    assignedCount: candidates.length,
    updatedIds: [...updates.keys()],
    items: normalized.map((item) => updates.has(item.id) ? { ...item, ...updates.get(item.id) } : item)
  };
}

function importPublishingQueue(items, settings) {
  const existing = new Map(
    state.publishingQueue
      .map((item, index) => normalizePublishItem(item, settings, index))
      .map((item) => [item.id, item])
  );
  items.map((item, index) => normalizePublishItem(item, settings, index)).forEach((item) => {
    existing.set(item.id, { ...existing.get(item.id), ...item });
  });
  state.publishingQueue = [...existing.values()];
  save();
  renderPublishingQueue();
}

function addToPostingPlan(items, settings = getPostingSettings()) {
  const existing = new Map(
    state.postingPlan
      .map((item, index) => normalizePublishItem(item, settings, index))
      .map((item) => [item.id, item])
  );
  items.map((item, index) => normalizePublishItem(item, settings, index)).forEach((item) => {
    existing.set(item.id, {
      ...existing.get(item.id),
      ...item,
      planAddedAt: existing.get(item.id)?.planAddedAt || new Date().toISOString()
    });
  });
  state.postingPlan = [...existing.values()].sort((a, b) => new Date(a.scheduledFor || 0) - new Date(b.scheduledFor || 0));
  save();
  renderPostingPlan();
  syncPostingPlanToBackend();
}

function renderPublishingQueue() {
  const list = $("#publishingQueueList");
  if (!list) return;
  list.innerHTML = "";

  if (!state.publishingQueue.length) {
    list.innerHTML = state.postingPlan.length
      ? `<p class="note">No new Reels are staged. Your uploaded videos are already saved in the scheduled plan above and can still publish from this Schedule page when due.</p>`
      : `<p class="note">No approved Reels staged yet. Go to Review, approve the Reels you like, then use Load approved here.</p>`;
    renderPublishTimeline();
    renderMetaQueueSummary();
    return;
  }

  const template = $("#publishTemplate");
  state.publishingQueue.forEach((item) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".publish-card");
    const preview = node.querySelector(".publish-preview");
    const status = node.querySelector(".publish-status");
    const platform = node.querySelector(".publish-platform");
    const title = node.querySelector("h4");
    const album = node.querySelector(".review-album");
    const destinationInputs = [...node.querySelectorAll(".destination-input")];
    const scheduledInput = node.querySelector(".publish-scheduled");
    const caption = node.querySelector(".publish-caption");
    const hashtags = node.querySelector(".publish-hashtags");
    const publicVideoUrl = node.querySelector(".publish-public-url");
    const apiResult = node.querySelector(".publish-api-result");
    const openVideo = node.querySelector(".open-video");

    card.dataset.id = item.id;
    if (item.preview) preview.style.backgroundImage = `url("${pathToFileUrl(item.preview)}")`;
    status.textContent = item.status;
    status.className = `status-pill publish-status ${item.status === "posted" ? "posted" : item.status === "held" ? "rejected" : item.status === "scheduled" ? "approved" : ""}`;
    platform.textContent = effectiveDestinationSummary(item, state.publishingQueue);
    title.textContent = item.title;
    album.textContent = `${item.album} - ${item.account || "No account set"}`;
    renderPublishCampaignDetails(node, item);
    const destinations = normalizeDestinations(item.destinations);
    destinationInputs.forEach((input) => {
      input.checked = destinations[input.dataset.destination] !== false;
      input.addEventListener("change", () => updatePublishDestination(item.id, input.dataset.destination, input.checked));
    });
    scheduledInput.value = item.scheduledFor;
    caption.value = item.caption;
    hashtags.value = item.hashtags;
    publicVideoUrl.value = item.publicVideoUrl || "";
    apiResult.textContent = item.apiMessage || publishItemApiSummary(item);
    openVideo.href = pathToFileUrl(item.video);

    scheduledInput.addEventListener("input", () => updatePublishItem(item.id, "scheduledFor", scheduledInput.value));
    caption.addEventListener("input", () => updatePublishItem(item.id, "caption", caption.value));
    hashtags.addEventListener("input", () => updatePublishItem(item.id, "hashtags", hashtags.value));
    publicVideoUrl.addEventListener("input", () => updatePublishItem(item.id, "publicVideoUrl", publicVideoUrl.value));

    list.appendChild(node);
  });
  renderPublishTimeline();
  renderMetaQueueSummary();
}

function updatePublishItem(id, field, value, rerender = false) {
  const item = state.publishingQueue.find((entry) => entry.id === id);
  if (!item) return;
  item[field] = value;
  save();
  renderPublishTimeline();
  if (rerender) renderPublishingQueue();
}

function renderPublishCampaignDetails(node, item) {
  if (!item.shortType && !item.seoTitle && !item.visualConcept && !item.keywords && !item.visualSourcingPlan) return;
  const body = node.querySelector(".publish-body");
  const fields = node.querySelector(".publish-fields");
  if (!body || !fields) return;
  const panel = document.createElement("div");
  panel.className = "campaign-note compact";
  panel.innerHTML = `
    <div>
      <strong>${escapeHtml(item.shortTypeLabel || shortTypeLabel(item.shortType) || "Short campaign")}</strong>
      ${item.variantLabel ? `<span>${escapeHtml(item.variantLabel)}</span>` : ""}
      ${item.descriptionModeLabel || item.descriptionMode ? `<span>${escapeHtml(item.descriptionModeLabel || item.descriptionMode)}</span>` : ""}
      ${item.audience ? `<span>${escapeHtml(item.audience)}</span>` : ""}
    </div>
    ${item.seoTitle ? `<p><b>SEO title:</b> ${escapeHtml(item.seoTitle)}</p>` : ""}
    ${item.visualConcept ? `<p><b>Concept:</b> ${escapeHtml(item.visualConcept)}</p>` : ""}
    ${item.visualThemeBasis ? `<p><b>Theme basis:</b> ${escapeHtml(item.visualThemeBasis)}</p>` : ""}
    ${item.visualSourceStatus ? `<p><b>Visual source:</b> ${escapeHtml([item.visualSourceStatus, item.visualSourceName, item.visualSourceLicense].filter(Boolean).join(" | "))}</p>` : ""}
    ${item.visualSourcingPlan ? `<p><b>Safe visual plan:</b> ${escapeHtml(item.visualSourcingPlan)}</p>` : ""}
    ${item.keywords ? `<p><b>Keywords:</b> ${escapeHtml(item.keywords)}</p>` : ""}
  `;
  body.insertBefore(panel, fields);
}

function updatePublishDestination(id, destination, checked) {
  const item = state.publishingQueue.find((entry) => entry.id === id);
  if (!item || !destination) return;
  item.destinations = {
    ...normalizeDestinations(item.destinations),
    [destination]: Boolean(checked)
  };
  save();
  renderPublishingQueue();
}

function normalizeDestinations(value = {}) {
  const parsed = typeof value === "string"
    ? (() => {
      try { return JSON.parse(value); } catch { return {}; }
    })()
    : value || {};
  return {
    instagram: parsed.instagram !== false,
    facebook: parsed.facebook !== false,
    youtubeShorts: parsed.youtubeShorts !== false,
    youtubeVideo: parsed.youtubeVideo === true
  };
}

function destinationSummary(item = {}) {
  const destinations = normalizeDestinations(item.destinations);
  return [
    destinations.instagram ? "Instagram" : "",
    destinations.facebook ? "Facebook" : "",
    destinations.youtubeShorts ? "Shorts" : "",
    destinations.youtubeVideo ? "YouTube" : ""
  ].filter(Boolean).join(" + ") || "No stores selected";
}

function scheduleDateKey(value = "") {
  return String(value || "").slice(0, 10) || "unscheduled";
}

function isMetaDestinationEnabled(item = {}) {
  const destinations = normalizeDestinations(item.destinations);
  return destinations.instagram || destinations.facebook;
}

function metaDailyRole(item = {}, items = []) {
  if (!isMetaDestinationEnabled(item)) return "none";
  const dateKey = scheduleDateKey(item.scheduledFor);
  const sameDayMetaItems = [...items]
    .filter((entry) => isMetaDestinationEnabled(entry))
    .filter((entry) => scheduleDateKey(entry.scheduledFor) === dateKey)
    .sort((a, b) => new Date(a.scheduledFor || 0).getTime() - new Date(b.scheduledFor || 0).getTime());
  const first = sameDayMetaItems[0];
  return first?.id === item.id ? "daily-pick" : "daily-locked";
}

function effectiveDestinationSummary(item = {}, items = []) {
  const destinations = normalizeDestinations(item.destinations);
  const metaRole = metaDailyRole(item, items.length ? items : [item]);
  const metaLabel = metaRole === "daily-pick"
    ? [destinations.instagram ? "Instagram" : "", destinations.facebook ? "Facebook" : ""].filter(Boolean).join(" + ")
    : metaRole === "daily-locked"
      ? "Meta skipped: daily lock"
      : "";
  return [
    metaLabel,
    destinations.youtubeShorts ? "Shorts" : "",
    destinations.youtubeVideo ? "YouTube" : ""
  ].filter(Boolean).join(" + ") || "No stores selected";
}

function platformOutcomeChips(item = {}, items = []) {
  const destinations = normalizeDestinations(item.destinations);
  const metaRole = metaDailyRole(item, items.length ? items : [item]);
  const publishStatus = String(item.publishStatus || "").toLowerCase();
  const status = String(item.status || "").toLowerCase();
  const facebookStatus = String(item.facebookPublishStatus || "").toLowerCase();
  const shortStatus = String(item.youtubeShortPublishStatus || "").toLowerCase();
  const videoStatus = String(item.youtubePublishStatus || item.youtubeVideoPublishStatus || "").toLowerCase();
  const chips = [];

  chips.push(item.publicVideoUrl
    ? { label: "R2 ready", state: "ready", detail: "Public MP4 URL saved" }
    : { label: "R2 needed", state: "pending", detail: "Upload MP4 before publishing" });

  if (destinations.instagram || destinations.facebook) {
    if (metaRole === "daily-locked") {
      chips.push({ label: "Meta locked", state: "held", detail: "Daily IG/FB slot already used" });
    } else {
      if (destinations.instagram) {
        chips.push(item.instagramMediaId || publishStatus === "published" || status === "posted"
          ? { label: "IG posted", state: "posted", detail: item.instagramMediaId || "Published" }
          : item.publishError || publishStatus === "publish-error"
            ? { label: "IG failed", state: "error", detail: item.publishError || "Publish failed" }
            : item.containerId
              ? { label: "IG container", state: "ready", detail: item.containerStatus || "Container created" }
              : { label: "IG pending", state: "pending", detail: "Waiting for due publish" });
      }
      if (destinations.facebook) {
        chips.push(item.facebookMediaId || facebookStatus === "published"
          ? { label: "FB posted", state: "posted", detail: item.facebookMediaId || "Published" }
          : item.facebookPublishError || facebookStatus === "publish-error"
            ? { label: "FB failed", state: "error", detail: item.facebookPublishError || "Publish failed" }
            : { label: "FB pending", state: "pending", detail: "Waiting for Meta publish" });
      }
    }
  }

  if (destinations.youtubeShorts) {
    chips.push(item.youtubeShortVideoId || item.youtubeShortUrl || shortStatus === "published"
      ? { label: "Shorts posted", state: "posted", detail: item.youtubeShortUrl || item.youtubeShortVideoId || "Published" }
      : isFailedYouTubeShortItem(item)
        ? { label: "Shorts failed", state: "error", detail: item.youtubeShortPublishError || "Upload failed" }
        : isHeldYouTubeShortItem(item)
          ? { label: "Shorts held", state: "held", detail: item.youtubeShortPublishError || item.scheduleNote || "Held by publishing rules" }
          : { label: "Shorts pending", state: "pending", detail: "Waiting for due publish" });
  }

  if (destinations.youtubeVideo) {
    chips.push(item.youtubeVideoId || item.youtubeUrl || videoStatus === "published"
      ? { label: "YouTube posted", state: "posted", detail: item.youtubeUrl || item.youtubeVideoId || "Published" }
      : item.youtubePublishError || videoStatus === "publish-error"
        ? { label: "YouTube failed", state: "error", detail: item.youtubePublishError || "Upload failed" }
        : ["same-track-spacing-held", "daily-cap-held"].includes(videoStatus)
          ? { label: "YouTube held", state: "held", detail: item.youtubePublishError || "Held by publishing rules" }
          : { label: "YouTube pending", state: "pending", detail: "Waiting for due publish" });
  }

  return chips;
}

function platformOutcomeHtml(item = {}, items = [], compact = false) {
  return `<div class="${compact ? "platform-outcomes compact" : "platform-outcomes"}">${platformOutcomeChips(item, items).map((chip) => (
    `<span class="platform-chip ${escapeHtml(chip.state)}" title="${escapeHtml(chip.detail || chip.label)}">${escapeHtml(chip.label)}</span>`
  )).join("")}</div>`;
}

function overallPublishStateLabel(item = {}, items = []) {
  const chips = platformOutcomeChips(item, items);
  if (chips.some((chip) => chip.state === "error")) return "Needs fix";
  const destinationChips = chips.filter((chip) => chip.label !== "R2 ready" && chip.label !== "R2 needed");
  if (destinationChips.length && destinationChips.every((chip) => chip.state === "posted")) return "Complete";
  if (destinationChips.length && destinationChips.every((chip) => chip.state === "posted" || chip.state === "held")) return "Held by rule";
  if (destinationChips.some((chip) => chip.state === "posted")) return "Part posted";
  if (chips.some((chip) => chip.state === "held")) return "Held";
  if (item.publicVideoUrl) return "Ready";
  return "Needs upload";
}

function isHeldYouTubeShortItem(item = {}) {
  const status = String(item.youtubeShortPublishStatus || "").toLowerCase();
  return ["same-track-spacing-held", "daily-cap-held", "artwork-paused"].includes(status);
}

function isFailedYouTubeShortItem(item = {}) {
  const status = String(item.youtubeShortPublishStatus || "").toLowerCase();
  if (isHeldYouTubeShortItem(item) || status === "published") return false;
  return Boolean(item.youtubeShortPublishError)
    || status === "publish-error"
    || status === "source-error"
    || status === "missing-video"
    || /failed|error|missing|invalid|expired|revoked|permission|blocked/.test(status);
}

function youtubeShortFailureReason(item = {}) {
  const status = String(item.youtubeShortPublishStatus || "").toLowerCase();
  if (item.youtubeShortPublishError) return String(item.youtubeShortPublishError);
  if (status === "missing-video") return "The local Short MP4 could not be found.";
  if (status === "source-error") return "The queued source media did not pass the profile/artwork/audio checks.";
  if (status === "publish-error") return "YouTube rejected the upload request.";
  return status ? `Shorts status: ${status}` : "YouTube Shorts failed without a saved reason.";
}

function youtubeShortFixHint(item = {}) {
  const reason = youtubeShortFailureReason(item).toLowerCase();
  if (/expired|revoked|token|oauth|credential|unauthorized|invalid grant/.test(reason)) {
    return "Reconnect YouTube in Setup, then re-send Shorts.";
  }
  if (/permission|forbidden|access|api.*disabled|not configured/.test(reason)) {
    return "Check YouTube API access/permissions, then re-send Shorts.";
  }
  if (/missing|not found|local short mp4/.test(reason)) {
    return "The rendered MP4 is missing. Remove it and generate a fresh replacement.";
  }
  if (/source|artwork|metadata|profile|catalogue|blocked/.test(reason)) {
    return "This looks like a media/source mismatch. Remove/regenerate after checking artwork and audio.";
  }
  return "If the account/token is now fixed, use Re-send Shorts.";
}

function updatePostingPlanItem(id, field, value) {
  const item = state.postingPlan.find((entry) => entry.id === id);
  if (!item) return;
  item[field] = value;
  state.postingPlan = [...state.postingPlan].sort((a, b) => new Date(a.scheduledFor || 0) - new Date(b.scheduledFor || 0));
  save();
  renderPostingPlan();
  renderPublishTimeline();
  renderMetaQueueSummary();
  renderDashboard();
  syncPostingPlanToBackend();
}

function itemNeedsRegeneration(item = {}) {
  const text = [
    item.apiMessage,
    item.publishError,
    item.youtubeShortPublishError,
    item.youtubePublishError,
    item.youtubeVideoPublishError,
    item.scheduleNote
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /stale queued metadata|artwork mismatch|regenerate this item|blocked upload: artwork|source audio.*missing|outside this profile|not in the active profile catalogue|source-error/.test(text);
}

function normalizeLocalPath(value = "") {
  return String(value || "").replace(/^file:\/\/\/?/i, "").replace(/\//g, "\\").trim();
}

function localDirName(value = "") {
  const normalized = normalizeLocalPath(value).replace(/\\+$/g, "");
  const index = normalized.lastIndexOf("\\");
  return index > 0 ? normalized.slice(0, index) : "";
}

function isInsideLocalPath(parent = "", child = "") {
  const cleanParent = normalizeLocalPath(parent).replace(/\\+$/g, "").toLowerCase();
  const cleanChild = normalizeLocalPath(child).replace(/\\+$/g, "").toLowerCase();
  if (!cleanParent || !cleanChild) return false;
  return cleanChild === cleanParent || cleanChild.startsWith(`${cleanParent}\\`);
}

function queuedArtworkLooksMismatched(item = {}) {
  const audio = normalizeLocalPath(item.audio || item.Audio || "");
  const artwork = normalizeLocalPath(item.artwork || item.Artwork || "");
  if (!/^[a-z]:\\/i.test(audio) || !/^[a-z]:\\/i.test(artwork)) return false;
  const audioFolder = localDirName(audio);
  const albumFolder = localDirName(audioFolder);
  return Boolean(audioFolder && albumFolder)
    && !isInsideLocalPath(audioFolder, artwork)
    && !isInsideLocalPath(albumFolder, artwork);
}

function queuedMediaDiagnosis(item = {}) {
  const audio = item.audio || item.Audio || "";
  const artwork = item.artwork || item.Artwork || "";
  const parts = [];
  const text = [
    item.apiMessage,
    item.publishError,
    item.youtubeShortPublishError,
    item.youtubePublishError,
    item.youtubeVideoPublishError,
    item.scheduleNote
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  if (/artwork mismatch|blocked upload: artwork|stale queued metadata/.test(text)) {
    parts.push("Artwork mismatch reported by publisher.");
  }
  if (audio) parts.push(`Audio: ${fileBaseName(audio)}`);
  if (artwork) parts.push(`Artwork: ${fileBaseName(artwork)}`);
  return parts;
}

function fileBaseName(value = "") {
  const cleaned = String(value || "").replace(/[?#].*$/, "").replace(/\\/g, "/");
  return cleaned.split("/").filter(Boolean).pop() || cleaned || "";
}

function removeScheduledItemForRegeneration(id = "") {
  if (!id) return;
  const allItems = [...state.publishingQueue, ...state.postingPlan, ...state.youtubeVideoReviews, ...state.reviews];
  const item = allItems.find((entry) => entry.id === id || stableRenderedItemId(entry) === id);
  const title = item?.title || item?.Title || "this item";
  const confirmed = confirm(
    `Remove "${title}" from the active schedule and mark the generated version as rejected?\n\nUse this when the app says stale queued metadata or regenerate this item. It will not delete your audio/artwork files.`
  );
  if (!confirmed) return;

  const rejectionReason = "Stale queued metadata: regenerate this item from the current catalogue/artwork.";
  const matchesId = (entry) => entry.id === id || stableRenderedItemId(entry) === id;
  state.publishingQueue = state.publishingQueue.filter((entry) => !matchesId(entry));
  state.postingPlan = state.postingPlan.filter((entry) => !matchesId(entry));
  state.youtubeVideoReviews = state.youtubeVideoReviews.filter((entry) => !matchesId(entry));
  state.reviews = state.reviews.map((entry) => matchesId(entry)
    ? {
        ...entry,
        status: "rejected",
        rejectionReason,
        rejectedAt: new Date().toISOString()
      }
    : entry);

  save();
  renderPublishingQueue();
  renderPostingPlan();
  renderDashboard();
  renderHelpStatus();
  syncReviewCacheToBackend("remove-stale-scheduled-item");
  syncPostingPlanToBackend();
  setStatus("#apiPublishStatus", `Removed "${title}" from Schedule. Generate a fresh batch to create a clean replacement from the current audio/artwork folders.`);
}

async function resetSchedulePipeline() {
  const confirmed = confirm(
    "Reset the active schedule pipeline?\n\nThis clears the active queue, saved schedule, uploaded/public URL state, Meta container state, and temporary upload logs. It keeps your catalogue, rendered files, reviews, and published history."
  );
  if (!confirmed) return;

  setStatus("#apiPublishStatus", "Resetting schedule pipeline...");
  try {
    await postBackend("/api/schedule/clear-pipeline", {});
  } catch (error) {
    setStatus("#apiPublishStatus", `Backend cleanup could not finish. Local schedule will still be cleared. ${error?.message || ""}`.trim());
  }

  if (autoPublisherTimer) {
    clearInterval(autoPublisherTimer);
    autoPublisherTimer = null;
  }
  clearPublishRetryCountdown(false);
  if (uploadPollTimer) {
    clearInterval(uploadPollTimer);
    uploadPollTimer = null;
  }

  state.publishingQueue = [];
  state.postingPlan = [];
  state.youtubeVideoReviews = state.youtubeVideoReviews.map((item) => (
    item.status === "approved"
      ? { ...item, status: "draft", scheduledFor: "", youtubePublishStatus: "" }
      : { ...item, scheduledFor: "" }
  ));

  save();
  setUploadProgress({ percent: 0, stage: "idle", message: "No active upload.", current: 0, total: 0 });
  setPublishProgress({ mode: "idle", message: "Publisher idle.", percent: 0 });
  renderPublishingQueue();
  renderPostingPlan();
  renderYouTubeVideoReviews();
  renderDashboard();
  renderHelpStatus();
  setStatus("#apiPublishStatus", "Schedule pipeline reset. Load approved Reels again when you want to build a fresh plan.");
}

async function cleanupUnusedR2Uploads() {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#apiPublishStatus", "R2 cleanup is not connected for this profile yet. Profile-specific storage setup comes next.");
    return;
  }
  const start = confirm(
    "Scan Cloudflare R2 for unused scheduler uploads?\n\nThis checks files under the reels/ folder and compares them with your current schedule and local published history. Nothing is deleted until you confirm the preview."
  );
  if (!start) return;

  setStatus("#apiPublishStatus", "Scanning R2 for unused uploads...");
  try {
    const preview = await postBackend("/api/r2/cleanup-unused", {
      dryRun: true,
      items: [...state.publishingQueue, ...state.postingPlan],
      youtubeVideoItems: applyScheduleToYouTubeVideos(state.youtubeVideoReviews)
    });
    const sample = (preview.unused || []).slice(0, 5).map((item) => `- ${item.key}`).join("\n");
    const confirmed = preview.unusedCount > 0 && confirm(
      `${preview.message}\n\n${sample}${preview.unusedCount > 5 ? `\n...and ${preview.unusedCount - 5} more` : ""}\n\nDelete these unused R2 uploads now? This cannot be undone from the app.`
    );
    if (!confirmed) {
      setStatus("#apiPublishStatus", preview.unusedCount ? "R2 cleanup preview finished. No files deleted." : "No unused R2 uploads found.");
      return;
    }

    setStatus("#apiPublishStatus", "Deleting unused R2 uploads...");
    const result = await postBackend("/api/r2/cleanup-unused", {
      dryRun: false,
      items: [...state.publishingQueue, ...state.postingPlan],
      youtubeVideoItems: applyScheduleToYouTubeVideos(state.youtubeVideoReviews)
    });
    setStatus("#apiPublishStatus", result.message || "R2 cleanup finished.");
  } catch (error) {
    setStatus("#apiPublishStatus", `R2 cleanup failed. ${error?.message || ""}`.trim());
  }
}

async function autoFillApprovedSchedule() {
  const settings = getPostingSettings();
  const existingIds = new Set(getPublishSourceItems().map((item) => item.id));
  const newlyApproved = getApprovedReviews()
    .map((item, index) => normalizePublishItem({ ...item, scheduledFor: "" }, settings, index))
    .filter((item) => !existingIds.has(item.id));
  if (newlyApproved.length) {
    state.publishingQueue = [...state.publishingQueue, ...newlyApproved];
  }
  const sourceItems = getPublishSourceItems();
  if (!sourceItems.some(isAutoScheduleCandidate)) {
    setStatus("#apiPublishStatus", "No approved, unposted items are ready to auto-schedule.");
    return;
  }
  const startDate = new Date();
  const { assignedCount, items, updatedIds } = autoFillScheduleItems(sourceItems, {
    startDate,
    times: AUTO_APPROVED_SCHEDULE_TIMES
  });
  const changedIds = new Set(updatedIds || []);
  const updates = new Map(items.filter((item) => changedIds.has(item.id)).map((item) => [item.id, item]));
  const applyUpdates = (storeItems) => storeItems
    .map((item, index) => {
      const normalized = normalizePublishItem(item, settings, index);
      return updates.get(normalized.id) ? { ...normalized, ...updates.get(normalized.id) } : item;
    })
    .sort((a, b) => new Date(a.scheduledFor || 0) - new Date(b.scheduledFor || 0));
  state.publishingQueue = applyUpdates(state.publishingQueue);
  state.postingPlan = applyUpdates(state.postingPlan);
  state.youtubeVideoReviews = applyScheduleToYouTubeVideos(state.youtubeVideoReviews);
  save();
  renderPublishingQueue();
  renderPostingPlan();
  renderDashboard();
  await syncPostingPlanToBackend();
  setStatus("#apiPublishStatus", `Auto-filled ${assignedCount} approved item${assignedCount === 1 ? "" : "s"} from today at 06:00, 11:00, and 14:00. Schedule now rotates different tracks across the 3 Shorts slots, keeps Meta/Instagram to the first slot only, and pushes alternate visuals for the same track later where possible.`);
}

function renderPublishTimeline() {
  const panel = $("#finalPublisherPanel");
  const title = $("#finalPublishTitle");
  const dialogue = $("#finalPublishDialogue");
  const stats = $("#finalPublishStats");
  const list = $("#publishTimelineList");
  if (!panel || !title || !dialogue || !stats || !list) return;

  const activeItems = [...state.publishingQueue].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const savedPlanItems = [...state.postingPlan].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const items = activeItems.length ? activeItems : savedPlanItems;
  const showingSavedPlan = !activeItems.length && savedPlanItems.length;
  const uploaded = items.filter((item) => item.publicVideoUrl).length;
  const scheduled = items.filter((item) => item.status === "scheduled" || item.scheduledFor).length;
  const posted = items.filter((item) => item.status === "posted" || item.publishStatus === "published").length;
  const held = items.filter((item) => item.status === "held").length;
  const readyToPublish = items.filter((item) => item.publicVideoUrl && item.status !== "posted" && item.status !== "held").length;
  const nextItem = items.find((item) => item.status !== "posted" && item.status !== "held");

  stats.innerHTML = [
    [showingSavedPlan ? "Scheduled" : "Staged", items.length],
    ["R2 ready", uploaded],
    ["Publish-ready", readyToPublish],
    ["Posted", posted]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");

  if (!items.length) {
    panel.classList.remove("committed");
    title.textContent = "No committed publishing timeline yet";
    dialogue.textContent = "Load approved Reels, choose their publish dates, upload the videos to R2, then start the auto publisher.";
    list.innerHTML = `<p class="note">Your scheduled Reels will appear here.</p>`;
    return;
  }

  if (showingSavedPlan) {
    panel.classList.remove("committed");
    title.textContent = "Scheduled plan is active";
    dialogue.textContent = nextItem
      ? `Your uploaded videos are saved in the publishing plan. Next up is ${nextItem.title} on ${formatSchedule(nextItem.scheduledFor)}. Use Publish due now or let the startup publisher run when it is due.`
      : "Your saved plan is complete. Create a new batch when you want more Reels.";
  } else {
    panel.classList.toggle("committed", Boolean(autoPublisherTimer));
  }

  const missingUploads = items.length - uploaded;
  if (showingSavedPlan) {
    // Saved-plan copy is set above; keep rendering the timeline below.
  } else if (autoPublisherTimer) {
    title.textContent = "Auto publisher is running";
    dialogue.textContent = nextItem
      ? `Next up: ${nextItem.title} on ${formatSchedule(nextItem.scheduledFor)}. The video is already uploaded; Meta publish happens at the scheduled time. Keep the backend and this dashboard open.`
      : "Everything in this queue is posted or held.";
  } else if (missingUploads > 0) {
    title.textContent = "Timeline prepared, uploads still needed";
    dialogue.textContent = `${missingUploads} Reel${missingUploads === 1 ? "" : "s"} still need the MP4 uploaded to R2 before scheduled publishing can run.`;
  } else {
    title.textContent = "Timeline ready to publish";
    dialogue.textContent = nextItem
      ? `All videos are uploaded to R2. Start the auto publisher when you are ready; it will publish ${nextItem.title} on ${formatSchedule(nextItem.scheduledFor)}.`
      : "All queued Reels are already posted or held.";
  }

  list.innerHTML = items.map((item, index) => {
    const isPosted = item.status === "posted" || item.publishStatus === "published";
    const stateLabel = item.publishStatus === "rescheduled-tail"
      ? "Moved to tail"
      : item.publishStatus === "rescheduled-catch-up"
        ? "Moved"
        : overallPublishStateLabel(item, items);
    const scheduleControl = showingSavedPlan && !isPosted
      ? `<label class="timeline-date-edit">Scheduled <input class="plan-scheduled-input" data-plan-id="${escapeHtml(item.id)}" type="datetime-local" value="${escapeHtml(item.scheduledFor || "")}" /></label>`
      : `<time>${formatSchedule(item.scheduledFor)}</time>`;
    return `
      <article class="timeline-card ${isPosted ? "posted" : item.status === "held" ? "held" : ""}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(item.title || "Untitled Reel")}</strong>
        <small>${escapeHtml(`${item.album || "Unknown album"} | ${effectiveDestinationSummary(item, items)}`)}</small>
        ${scheduleControl}
        <em>${stateLabel}</em>
        ${platformOutcomeHtml(item, items, true)}
      </article>
    `;
  }).join("");

  list.querySelectorAll(".plan-scheduled-input").forEach((input) => {
    input.addEventListener("change", () => updatePostingPlanItem(input.dataset.planId, "scheduledFor", input.value));
  });
}

function renderMetaQueueSummary() {
  const label = $("#metaQueueSummaryLabel");
  const stats = $("#metaQueueStats");
  const list = $("#metaQueueList");
  if (!label || !stats || !list) return;

  const activeItems = [...state.publishingQueue].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const savedPlanItems = [...state.postingPlan].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const items = activeItems.length ? activeItems : savedPlanItems;
  const showingSavedPlan = !activeItems.length && savedPlanItems.length;
  const uploaded = items.filter((item) => Boolean(item.publicVideoUrl));
  const posted = items.filter((item) => item.status === "posted" || item.publishStatus === "published");
  const metaReady = items.filter((item) => item.publicVideoUrl && item.status !== "held" && item.status !== "posted" && item.publishStatus !== "published");
  const dueNow = getDuePublishItems(items);
  const needsUpload = items.filter((item) => !item.publicVideoUrl && item.status !== "held" && item.status !== "posted");
  const failedShorts = items.filter(isFailedYouTubeShortItem);
  const heldShorts = items.filter(isHeldYouTubeShortItem);
  const nextItem = getNextPublishItem(items);

  label.textContent = metaReady.length
    ? dueNow.length
      ? `${dueNow.length} due now`
      : `${metaReady.length} uploaded and waiting`
    : items.length ? showingSavedPlan ? "Scheduled plan active" : "Nothing publish-ready yet" : "No schedule loaded";

  stats.innerHTML = [
    ["Needs upload", needsUpload.length],
    ["Uploaded", uploaded.length],
    ["Due now", dueNow.length],
    ["Shorts failed", failedShorts.length],
    ["Shorts held", heldShorts.length],
    ["Posted", posted.length]
  ].map(([statLabel, value]) => `<div><strong>${value}</strong><span>${statLabel}</span></div>`).join("");

  if (!items.length) {
    list.innerHTML = `<p class="note">Load approved Reels first. This panel will show one combined publishing pipeline.</p>`;
    return;
  }

  const savedPlanNote = showingSavedPlan
    ? `<p class="note">These videos have already left the staging queue and are saved in the scheduled plan. They can still publish from this page when due.</p>`
    : "";
  const failedShortsPanel = failedShorts.length ? renderFailedShortsPanel(failedShorts) : "";

  list.innerHTML = savedPlanNote + failedShortsPanel + items.slice(0, 12).map((item, index) => {
    const isPosted = item.status === "posted" || item.publishStatus === "published";
    const isHeld = item.status === "held";
    const isCatchUpSpaced = item.publishStatus === "rescheduled-catch-up";
    const isDue = dueNow.some((dueItem) => dueItem.id === item.id);
    const itemKey = item.id || item.isrc || item.title || "";
    const image = item.preview || item.artwork || "";
    const description = item.caption || item.description || "No description saved for this item yet.";
    const campaignLine = [
      item.variantLabel,
      item.shortTypeLabel || shortTypeLabel(item.shortType),
      item.descriptionModeLabel || item.descriptionMode,
      item.visualSourceStatus,
      item.visualSourceName,
      item.visualThemeBasis ? `Theme: ${item.visualThemeBasis}` : ""
    ].filter(Boolean).join(" | ");
    const stateLabel = isPosted
      ? "Posted"
      : isCatchUpSpaced
        ? "Catch-up spaced"
        : isHeld
        ? "Held"
        : isDue
          ? "Due now"
          : item.publicVideoUrl && nextItem?.id === item.id
            ? "Next"
            : item.publicVideoUrl
            ? "Waiting"
            : "Needs upload";
    const needsRegeneration = itemNeedsRegeneration(item);
    const diagnosis = queuedMediaDiagnosis(item);
    const shortsFailure = isFailedYouTubeShortItem(item)
      ? `<div class="pipeline-warning shorts-failure"><strong>YouTube Shorts failed</strong><span>${escapeHtml(youtubeShortFailureReason(item))}</span><span>${escapeHtml(youtubeShortFixHint(item))}</span></div>`
      : "";
    const regenerateNote = needsRegeneration
      ? `<div class="pipeline-warning"><strong>Regenerate required</strong>${diagnosis.map((line) => `<span>${escapeHtml(line)}</span>`).join("")}<span>Remove it, then create a fresh batch from the current catalogue/artwork.</span></div>`
      : "";

    return `
      <article class="pipeline-card ${needsRegeneration ? "needs-regeneration" : isDue ? "due" : isPosted ? "posted" : isHeld ? "held" : ""}">
        <span class="pipeline-index">${index + 1}</span>
        <div class="pipeline-art" style="${image ? `background-image:url('${pathToFileUrl(image)}')` : ""}"></div>
        <div class="pipeline-detail">
          <div class="pipeline-title-row">
            <div>
              <strong>${escapeHtml(item.title || "Untitled Reel")}</strong>
              <small>${escapeHtml(item.album || "Unknown album")}</small>
            </div>
            <em>${stateLabel}</em>
          </div>
          <small>${formatSchedule(item.scheduledFor)} | ${escapeHtml(effectiveDestinationSummary(item, items))}</small>
          ${item.scheduleNote ? `<small>${escapeHtml(item.scheduleNote)}</small>` : ""}
          ${platformOutcomeHtml(item, items)}
          ${campaignLine ? `<p class="pipeline-campaign">${escapeHtml(campaignLine)}</p>` : ""}
          ${shortsFailure}
          ${regenerateNote}
          <p class="pipeline-description">${escapeHtml(description)}</p>
          ${item.hashtags ? `<p class="pipeline-tags">${escapeHtml(item.hashtags)}</p>` : ""}
          <div class="pipeline-actions">
            <button class="secondary resend-item" data-destination="meta" data-item-id="${escapeHtml(itemKey)}">Re-send Meta/Instagram</button>
            <button class="secondary resend-item" data-destination="youtubeShorts" data-item-id="${escapeHtml(itemKey)}">Re-send Shorts</button>
            <button class="secondary resend-item" data-destination="youtubeVideo" data-item-id="${escapeHtml(itemKey)}">Re-send YouTube</button>
            ${isFailedYouTubeShortItem(item) ? `<button class="ghost reset-short-failure" data-item-id="${escapeHtml(item.id)}">Reset Shorts status</button>` : ""}
            <button class="ghost remove-stale-item" data-item-id="${escapeHtml(item.id)}">${needsRegeneration ? "Remove / regenerate" : "Remove from schedule"}</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  list.querySelectorAll(".resend-item").forEach((button) => {
    button.addEventListener("click", () => resendDueFromGui(button.dataset.destination, button.dataset.itemId));
  });
  list.querySelectorAll(".retry-failed-shorts").forEach((button) => {
    button.addEventListener("click", retryFailedShortsFromGui);
  });
  list.querySelectorAll(".reset-failed-shorts").forEach((button) => {
    button.addEventListener("click", () => resetFailedShortsStatus());
  });
  list.querySelectorAll(".reset-short-failure").forEach((button) => {
    button.addEventListener("click", () => resetFailedShortsStatus(button.dataset.itemId));
  });
  list.querySelectorAll(".remove-stale-item").forEach((button) => {
    button.addEventListener("click", () => removeScheduledItemForRegeneration(button.dataset.itemId));
  });
}

function renderFailedShortsPanel(failedShorts = []) {
  const dueFailed = failedShorts.filter((item) => item.publicVideoUrl && isDueNow(item));
  const preview = failedShorts.slice(0, 6).map((item) => `
    <article>
      <strong>${escapeHtml(item.title || "Untitled Short")}</strong>
      <span>${escapeHtml(formatSchedule(item.scheduledFor))}</span>
      <p>${escapeHtml(youtubeShortFailureReason(item))}</p>
      <small>${escapeHtml(youtubeShortFixHint(item))}</small>
    </article>
  `).join("");
  return `
    <section class="failed-shorts-panel">
      <div class="failed-shorts-head">
        <div>
          <p class="eyebrow">YouTube Shorts needs attention</p>
          <h4>${failedShorts.length} failed Short${failedShorts.length === 1 ? "" : "s"}</h4>
          <p>${dueFailed.length ? `${dueFailed.length} failed Short${dueFailed.length === 1 ? " is" : "s are"} due now and can be retried.` : "No failed Shorts are due right now. You can reset the failed state after fixing the cause, or remove/regenerate broken media."}</p>
        </div>
        <div class="button-row">
          <button class="secondary retry-failed-shorts" ${dueFailed.length ? "" : "disabled"}>Retry due failed Shorts</button>
          <button class="ghost reset-failed-shorts">Reset failed Shorts status</button>
        </div>
      </div>
      <div class="failed-shorts-list">${preview}</div>
    </section>
  `;
}

function renderPostingPlan() {
  const stats = $("#postingPlanStats");
  const list = $("#postingPlanList");
  if (!stats || !list) return;

  const items = [...state.postingPlan].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const uploaded = items.filter((item) => item.publicVideoUrl).length;
  const instagramPosted = items.filter((item) => item.status === "posted" || item.publishStatus === "published").length;
  const facebookPosted = items.filter((item) => item.facebookPublishStatus === "published" || item.facebookMediaId).length;
  const waiting = items.filter((item) => item.publicVideoUrl && item.status !== "posted" && item.publishStatus !== "published").length;

  stats.innerHTML = [
    ["Planned", items.length],
    ["Uploaded", uploaded],
    ["Waiting", waiting],
    ["Instagram", instagramPosted],
    ["Facebook", facebookPosted]
  ].map(([label, value]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join("");

  if (!items.length) {
    list.innerHTML = `<p class="note">Uploaded Reels will appear here after the Schedule upload step completes.</p>`;
    return;
  }

  list.innerHTML = items.map((item, index) => {
    const instagramDone = item.status === "posted" || item.publishStatus === "published";
    const facebookDone = item.facebookPublishStatus === "published" || item.facebookMediaId;
    const metaRole = metaDailyRole(item, items);
    const metaLocked = metaRole === "daily-locked";
    const youtubeHandled = item.youtubeShortVideoId || item.youtubeShortUrl || item.youtubeVideoId || item.youtubeUrl;
    const canEditSchedule = !(instagramDone && facebookDone);
    const needsRegeneration = itemNeedsRegeneration(item);
    const diagnosis = queuedMediaDiagnosis(item);
    const label = metaLocked
      ? youtubeHandled
        ? "Meta skipped, YouTube handled"
        : item.publicVideoUrl
          ? "Meta skipped, waiting for YouTube"
          : "Needs upload"
      : instagramDone && facebookDone
      ? "Posted to both"
      : instagramDone
        ? "Instagram posted, Facebook pending"
        : item.publicVideoUrl
          ? "Uploaded, waiting"
          : "Needs upload";
    return `
      <article class="timeline-card ${instagramDone && facebookDone ? "posted" : ""}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(item.title || "Untitled Reel")}</strong>
        <small>${escapeHtml(`${item.album || "Unknown album"} | ${effectiveDestinationSummary(item, items)}`)}</small>
        ${canEditSchedule
          ? `<label class="timeline-date-edit">Scheduled <input class="plan-scheduled-input" data-plan-id="${escapeHtml(item.id)}" type="datetime-local" value="${escapeHtml(item.scheduledFor || "")}" /></label>`
          : `<time>${formatSchedule(item.scheduledFor)}</time>`}
        <em>${label}</em>
        ${needsRegeneration ? `<small class="timeline-warning">Regenerate required: ${escapeHtml(diagnosis[0] || "queued media mismatch.")}</small>` : ""}
        ${canEditSchedule ? `<button class="ghost remove-stale-item" data-item-id="${escapeHtml(item.id)}">${needsRegeneration ? "Remove / regenerate" : "Remove"}</button>` : ""}
      </article>
    `;
  }).join("");
  list.querySelectorAll(".plan-scheduled-input").forEach((input) => {
    input.addEventListener("change", () => updatePostingPlanItem(input.dataset.planId, "scheduledFor", input.value));
  });
  list.querySelectorAll(".remove-stale-item").forEach((button) => {
    button.addEventListener("click", () => removeScheduledItemForRegeneration(button.dataset.itemId));
  });
  renderPublishingHistory();
}

function renderHelpStatus() {
  const badge = $("#helpOverallBadge");
  const title = $("#helpOverallTitle");
  const text = $("#helpOverallText");
  const cards = $("#helpStatusCards");
  const steps = $("#helpNextSteps");
  if (!badge || !title || !text || !cards || !steps) return;

  const backendOk = Boolean(state.backendHealth?.ok);
  const scan = state.setupWizard?.lastScan;
  const libraryReady = Boolean(scan?.eligibleCount || state.tracks.length);
  const tokenSummary = summarizeTokenHealth();
  const metaReady = tokenSummary.status === "good" || tokenSummary.status === "soon";
  const youtubeReady = Boolean(state.youtubeHealth?.ready);
  const sourceItems = getPublishSourceItems();
  const pending = sourceItems.filter((item) => item.status !== "posted" && item.publishStatus !== "published" && item.status !== "held");
  const uploaded = pending.filter((item) => item.publicVideoUrl);
  const due = getDuePublishItems(sourceItems);
  const next = getNextPublishItem(sourceItems);
  const hasQueue = Boolean(state.publishingQueue.length);
  const hasPlan = Boolean(state.postingPlan.length);
  const startupInstalled = Boolean(state.startupStatus?.installed);
  const r2Ready = uploaded.length > 0 || state.postingPlan.some((item) => item.publicVideoUrl);

  const statuses = [
    {
      label: "Backend",
      value: backendOk ? "Running" : "Offline",
      state: backendOk ? "good" : "bad",
      text: backendOk ? "Local app services are available." : "Open the app using start-jazz-scheduler.bat."
    },
    {
      label: "Library",
      value: libraryReady ? `${scan?.eligibleCount || state.tracks.length} ready` : "Not ready",
      state: libraryReady ? "good" : "bad",
      text: libraryReady ? "Tracks are available for Generate." : "Run First-Time Setup or Setup > Scan library."
    },
    {
      label: "Meta",
      value: tokenSummary.label,
      state: metaReady ? tokenSummary.status : "bad",
      text: metaReady ? "Publishing connection is usable." : "Open Setup > Meta for the exact failed check."
    },
    {
      label: "YouTube",
      value: youtubeReady ? "Ready" : state.youtubeHealth ? "Setup" : "Planned",
      state: youtubeReady ? "good" : state.youtubeHealth ? "warn" : "neutral",
      text: youtubeReady ? "Credentials are present for Shorts testing." : "Open YouTube setup before upload testing."
    },
    {
      label: "Storage",
      value: r2Ready ? "R2 ready" : hasQueue ? "Upload needed" : "No uploads yet",
      state: r2Ready ? "good" : hasQueue ? "warn" : "neutral",
      text: r2Ready ? "At least one public MP4 is ready for Meta." : "Approved Reels need uploading before publishing."
    },
    {
      label: "Schedule",
      value: due.length ? `${due.length} due now` : next ? "Waiting" : "Empty",
      state: due.length ? "warn" : next ? "good" : "neutral",
      text: due.length ? "Open Schedule and publish due content." : next ? `Next: ${formatSchedule(next.scheduledFor)}.` : "No scheduled Reels yet."
    },
    {
      label: "Automation",
      value: startupInstalled ? "Installed" : "Optional",
      state: startupInstalled ? "good" : "neutral",
      text: startupInstalled ? "Daily startup check is installed." : "Install later from Setup if wanted."
    }
  ];

  const bad = statuses.filter((item) => item.state === "bad").length;
  const warn = statuses.filter((item) => item.state === "warn").length;
  badge.className = bad ? "bad" : warn ? "warn" : "good";
  badge.textContent = bad ? "Needs attention" : warn ? "Action available" : "Ready";
  title.textContent = bad ? "A setup item needs attention" : warn ? "The app is ready, with an action waiting" : "Everything important looks ready";
  text.textContent = due.length
    ? `${due.length} Reel${due.length === 1 ? "" : "s"} due now. Open Schedule to publish.`
    : next
      ? `No urgent issue. Next scheduled Reel is ${formatSchedule(next.scheduledFor)}.`
      : "Use this page to check setup, publishing readiness, and what to do next.";

  cards.innerHTML = statuses.map((item) => `
    <article class="${item.state}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
      <p>${escapeHtml(item.text)}</p>
    </article>
  `).join("");

  const actions = [];
  if (!backendOk) actions.push(["Start backend", "Close the app and reopen it using start-jazz-scheduler.bat.", "#helpStatus"]);
  if (!libraryReady) actions.push(["Scan library", "Open Setup, choose the music folder, then run Scan library.", "#settingsSetup"]);
  if (!metaReady) actions.push(["Fix Meta", "Open Meta setup and run the health check to see the exact failed item.", "#instagramSetup"]);
  if (!youtubeReady) actions.push(["Prepare YouTube", "Open YouTube setup and check planned Shorts credentials.", "#youtubeSetup"]);
  if (state.reviews.some((item) => item.status === "new" || item.status === "ready")) actions.push(["Review Reels", "Approve or reject the latest generated Reels.", "#review"]);
  if (hasQueue && !uploaded.length) actions.push(["Upload videos", "Open Schedule and upload approved Reels to R2.", "#publishingQueue"]);
  if (due.length) actions.push(["Publish due content", "Open Schedule and press Publish due now.", "#publishingQueue"]);
  if (!actions.length && !hasPlan && !hasQueue) actions.push(["Create first batch", "Open Generate and create a review batch.", "#posting"]);
  if (!actions.length) actions.push(["No urgent action", "Your saved plan is waiting for the next scheduled publish time.", "#postingPlan"]);

  steps.innerHTML = actions.map(([heading, body, href]) => `
    <a href="${href}">
      <strong>${escapeHtml(heading)}</strong>
      <span>${escapeHtml(body)}</span>
    </a>
  `).join("");
  renderErrorReportPanel();
}

function renderErrorReportPanel() {
  const list = $("#errorReportList");
  if (!list) return;
  const recent = state.errorLog.slice(0, 8);
  if (!recent.length) {
    list.innerHTML = `<p class="note">No errors logged in this browser session yet.</p>`;
    return;
  }
  list.innerHTML = recent.map((entry) => `
    <article class="${escapeHtml(entry.level || "warn")}">
      <strong>${escapeHtml(entry.message || "Unknown issue")}</strong>
      <span>${formatSchedule(entry.at)} | ${escapeHtml(entry.level || "log")}</span>
    </article>
  `).join("");
}

function buildErrorReport() {
  const scan = state.setupWizard?.lastScan || null;
  const tokenSummary = summarizeTokenHealth();
  const sourceItems = getPublishSourceItems();
  const pending = sourceItems.filter((item) => item.status !== "posted" && item.publishStatus !== "published" && item.status !== "held");
  const due = getDuePublishItems(sourceItems);
  const next = getNextPublishItem(sourceItems);
  return {
    reportVersion: "2026-06-19-error-report-1",
    exportedAt: new Date().toISOString(),
    app: {
      urlHash: location.hash || "",
      backendUrl,
      userAgent: navigator.userAgent,
      language: navigator.language
    },
    status: {
      backend: {
        ok: Boolean(state.backendHealth?.ok),
        service: state.backendHealth?.service || "unknown",
        publishingEnabled: Boolean(state.backendHealth?.publishingEnabled)
      },
      library: {
        tracksLoaded: state.tracks.length,
        artistSet: Boolean(state.setupWizard?.artistName),
        audioFolderSet: Boolean(state.setupWizard?.audioRoot),
        artworkFolderSet: Boolean(state.setupWizard?.artworkRoot),
        lastScanAt: scan?.scannedAt || "",
        scanCounts: scan ? {
          tracks: scan.trackCount || 0,
          ready: scan.eligibleCount || 0,
          missingArtwork: scan.missingArtworkCount || 0,
          duplicates: scan.duplicateCount || 0,
          unsupported: scan.unsupportedCount || 0
        } : null
      },
      meta: {
        status: tokenSummary.status,
        label: tokenSummary.label,
        checked: Boolean(state.tokenHealth),
        checksPassed: state.tokenHealth?.checks?.filter((item) => item.ok).length || 0,
        checksTotal: state.tokenHealth?.checks?.length || 0,
        publishingEnabled: Boolean(state.tokenHealth?.publishingEnabled)
      },
      youtube: {
        checked: Boolean(state.youtubeHealth),
        ready: Boolean(state.youtubeHealth?.ready),
        credentialsPresent: state.youtubeHealth?.presentCount || 0,
        credentialsRequired: state.youtubeHealth?.requiredCount || 0,
        channelConfigured: Boolean(state.youtubeHealth?.channelConfigured || state.youtubeSetup?.channelId || state.youtubeSetup?.channelLabel)
      },
      schedule: {
        activeQueue: state.publishingQueue.length,
        savedPlan: state.postingPlan.length,
        pending: pending.length,
        uploaded: pending.filter((item) => item.publicVideoUrl).length,
        dueNow: due.length,
        nextTitle: next?.title || "",
        nextScheduledFor: next?.scheduledFor || ""
      },
      automation: {
        startupPublisherInstalled: Boolean(state.startupStatus?.installed),
        dashboardStartupInstalled: Boolean(state.startupStatus?.dashboardInstalled),
        latestRunAt: state.startupStatus?.latestRunAt || state.startupStatus?.latest?.checkedAt || "",
        latestMessage: state.startupStatus?.latest?.message || ""
      }
    },
    recentErrors: state.errorLog.slice(0, 30),
    localStorageKeys: Object.keys(localStorage)
      .filter((key) => key.startsWith("jazz"))
      .filter((key) => !/token|secret/i.test(key))
      .sort()
  };
}

function exportErrorReport() {
  logAppEvent("info", "Error report exported.");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  downloadJson(`jazz-scheduler-error-report-${stamp}.json`, buildErrorReport());
}

function clearErrorLog() {
  state.errorLog = [];
  profileStorageSet("jazzErrorLog", state.errorLog);
  renderErrorReportPanel();
}

async function previewLocalCleanup() {
  setStatus("#storageCleanupStatus", "Scanning old local files...");
  renderStorageCleanupList(null);
  try {
    const response = await fetch(`${backendUrl}/api/storage/cleanup-preview`);
    const result = await response.json();
    renderStorageCleanupResult(result);
  } catch (error) {
    setStatus("#storageCleanupStatus", "Backend is not running. Reopen the app with the launcher, then try again.");
  }
}

async function runLocalCleanup() {
  setStatus("#storageCleanupStatus", "Checking what can be cleaned...");
  try {
    const previewResponse = await fetch(`${backendUrl}/api/storage/cleanup-preview`);
    const preview = await previewResponse.json();
    const total = Number(preview.totalCandidates || 0);
    if (!total) {
      renderStorageCleanupResult(preview);
      return;
    }
    const confirmed = confirm(`Clean ${total} old local item${total === 1 ? "" : "s"} and free about ${formatFileSize(preview.totalBytes)}?\n\nRecent batches and scheduled files are kept.`);
    if (!confirmed) {
      renderStorageCleanupResult(preview);
      return;
    }
    setStatus("#storageCleanupStatus", "Cleaning old local files...");
    const result = await postBackend("/api/storage/cleanup", { apply: true });
    renderStorageCleanupResult(result);
  } catch (error) {
    setStatus("#storageCleanupStatus", `Cleanup failed. ${error?.message || "Check the backend window."}`.trim());
  }
}

function renderStorageCleanupResult(result) {
  if (!result?.ok) {
    setStatus("#storageCleanupStatus", result?.message || "Cleanup preview could not be loaded.");
    renderStorageCleanupList(null);
    return;
  }
  setStatus("#storageCleanupStatus", result.message || "Cleanup scan finished.");
  renderStorageCleanupList(result);
}

function renderStorageCleanupList(result) {
  const list = $("#storageCleanupList");
  if (!list) return;
  if (!result) {
    list.innerHTML = `<p class="note">Scanning...</p>`;
    return;
  }
  const groups = Array.isArray(result.groups) ? result.groups : [];
  const groupsWithItems = groups.filter((group) => Array.isArray(group.items) && group.items.length);
  if (!groupsWithItems.length) {
    list.innerHTML = `<p class="note">No old local files are currently safe to clean.</p>`;
    return;
  }
  list.innerHTML = groupsWithItems.map((group) => {
    const totalBytes = group.items.reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    const rows = group.items.slice(0, 8).map((item) => `
      <li>
        <span>${escapeHtml(item.relativePath || item.name || "Local item")}</span>
        <em>${formatFileSize(item.bytes)}${item.deleted ? " cleaned" : ""}</em>
      </li>
    `).join("");
    const extra = group.items.length > 8 ? `<li><span>${group.items.length - 8} more item${group.items.length - 8 === 1 ? "" : "s"}</span><em></em></li>` : "";
    return `
      <article>
        <strong>${escapeHtml(group.label || group.id || "Cleanup group")}</strong>
        <small>${group.items.length} item${group.items.length === 1 ? "" : "s"} | ${formatFileSize(totalBytes)}</small>
        <ul>${rows}${extra}</ul>
      </article>
    `;
  }).join("");
}

function formatFileSize(bytes = 0) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${value} B`;
}

async function loadPublishingHistory() {
  try {
    const response = await fetch(`${backendUrl}/api/publishing-history`);
    const result = await response.json();
    if (result.ok && Array.isArray(result.items)) {
      state.publishingHistory = result.items;
      renderPublishingHistory();
      renderDashboard();
    }
  } catch {
    renderPublishingHistory("Backend is not running. History will update when the backend is open.");
  }
}

async function clearPublishingHistory() {
  if (!confirm("Clear local publishing history?\n\nThis only removes scheduler history files on this computer. It will not delete anything already posted on Instagram, Facebook, or YouTube.")) return;
  setStatus("#metaHistoryStatus", "Clearing local publishing history...");
  try {
    const result = await postBackend("/api/publishing-history/clear", {});
    state.publishingHistory = [];
    state.metaHistory = [];
    renderPublishingHistory();
    renderDashboard();
    setStatus("#metaHistoryStatus", result.message || "Local publishing history cleared.");
  } catch (error) {
    setStatus("#metaHistoryStatus", `Could not clear local publishing history. ${error?.message || ""}`.trim());
  }
}

async function loadBackendHealth() {
  try {
    const response = await fetch(`${backendUrl}/health`);
    const text = await response.text();
    let result = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { message: text ? text.slice(0, 500) : "Backend returned an unreadable response." };
    }
    state.backendHealth = { ok: response.ok && result.ok, ...result };
  } catch {
    state.backendHealth = { ok: false, service: "offline", publishingEnabled: false };
  }
  renderHelpStatus();
}

async function loadTokenHealth() {
  renderTokenHealth("Checking Meta connection...");
  try {
    const response = await fetch(`${backendUrl}/api/readiness`);
    const result = await response.json();
    state.tokenHealth = result;
    renderTokenHealth();
    renderDashboard();
    renderHelpStatus();
    renderFirstRunWizard();
  } catch {
    state.tokenHealth = null;
    renderTokenHealth("Backend is not running. Start the scheduler app, then check again.");
    renderDashboard();
    renderHelpStatus();
    renderFirstRunWizard();
  }
}

async function saveMetaEnvFromApp() {
  const button = $("#saveMetaEnvFromApp");
  const payload = {
    userAccessToken: $("#metaUserAccessTokenInput")?.value || "",
    pageAccessToken: $("#metaPageAccessTokenInput")?.value || "",
    metaAppId: $("#metaAppIdInput")?.value || "",
    metaAppSecret: $("#metaAppSecretInput")?.value || "",
    facebookPageId: $("#metaFacebookPageIdInput")?.value || "",
    igUserId: $("#metaIgUserIdInput")?.value || "",
    accountsJson: $("#metaAccountsJsonInput")?.value || ""
  };
  const hasValue = Object.values(payload).some((value) => String(value || "").trim());
  if (!hasValue) {
    setStatus("#metaEnvSaveStatus", "Paste a token, ID, app value, or /me/accounts JSON first.");
    return;
  }

  if (button) button.disabled = true;
  setStatus("#metaEnvSaveStatus", "Saving Meta values to backend .env...");
  try {
    const result = await postBackend("/api/meta/env", payload);
    [
      "#metaUserAccessTokenInput",
      "#metaPageAccessTokenInput",
      "#metaAppSecretInput",
      "#metaAccountsJsonInput"
    ].forEach((selector) => {
      const field = $(selector);
      if (field) field.value = "";
    });
    setStatus("#metaEnvSaveStatus", `${result.message || "Meta values saved."} Checking connection now...`);
    await loadTokenHealth();
    setStatus("#metaEnvSaveStatus", `${result.message || "Meta values saved."} Health check refreshed.`);
  } catch (error) {
    setStatus("#metaEnvSaveStatus", `Could not save Meta values. ${error?.message || ""}`.trim());
  } finally {
    if (button) button.disabled = false;
  }
}

async function startMetaOAuth() {
  const button = $("#startMetaOAuth");
  if (button) button.disabled = true;
  setStatus("#metaOAuthStatus", "Preparing Meta connection...");
  try {
    const returnUrl = `${location.origin}${location.pathname}#instagramSetup`;
    const response = await fetch(`${backendUrl}/api/meta/oauth/start?returnUrl=${encodeURIComponent(returnUrl)}`);
    const result = await response.json();
    if (!result.ok || !result.authUrl) {
      setStatus("#metaOAuthStatus", result.message || "Could not start Meta connection.");
      return;
    }
    setStatus("#metaOAuthStatus", `Meta approval is opening. If Meta says the redirect is invalid, add this URL in your Meta app: ${result.redirectUri}`);
    const opened = await openUrlInChrome(result.authUrl, "#metaOAuthStatus");
    if (opened.ok) {
      setStatus("#metaOAuthStatus", "Meta approval opened in Chrome. Approve the permissions, then return here and click Check Meta health.");
    }
  } catch (error) {
    setStatus("#metaOAuthStatus", `Could not start Meta connection. ${error?.message || "Check the backend is running."}`.trim());
  } finally {
    if (button) button.disabled = false;
  }
}

function renderTokenHealth(message = "") {
  const stats = $("#tokenHealthStats");
  const details = $("#tokenHealthDetails");
  if (!stats || !details) return;

  if (message) {
    stats.innerHTML = `<article><strong>...</strong><span>${escapeHtml(message)}</span></article>`;
    details.innerHTML = "";
    renderMetaHealthConsole(message);
    return;
  }

  const health = state.tokenHealth;
  if (!health) {
    stats.innerHTML = `<article><strong>Check</strong><span>Token status has not been checked yet</span></article>`;
    details.innerHTML = "";
    renderMetaHealthConsole();
    return;
  }

  const checks = Array.isArray(health.checks) ? health.checks : [];
  const graph = Array.isArray(health.graph?.results) ? health.graph.results : [];
  const passed = checks.filter((item) => item.ok).length + graph.filter((item) => item.ok).length;
  const total = checks.length + graph.length;
  const failed = total - passed;

  stats.innerHTML = [
    ["Status", health.ok ? "Healthy" : "Fix"],
    ["Checks passed", `${passed}/${total || 0}`],
    ["Needs action", failed],
    ["Mode", health.publishingEnabled ? "Live" : "Readiness"]
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");

  const rows = [
    ...checks.map((item) => ({ name: item.id, ok: item.ok, detail: item.detail || "" })),
    ...graph.map((item) => ({ name: item.id, ok: item.ok, detail: item.id === "token_debug" ? tokenDebugText(item) : item.ok ? "Connected" : graphErrorText(item) }))
  ];

  details.innerHTML = `
    <table>
      <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
      <tbody>${rows.map((row) => `
        <tr>
          <td>${escapeHtml(row.name)}</td>
          <td>${row.ok ? "OK" : "Needs action"}</td>
          <td>${escapeHtml(row.detail)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
    <p class="note">${escapeHtml(health.note || "Token health checked.")}</p>
  `;
  renderMetaHealthConsole();
}

function renderMetaHealthConsole(message = "") {
  const title = $("#metaHealthTitle");
  const summary = $("#metaHealthSummary");
  const cards = $("#metaHealthCards");
  const permissions = $("#metaPermissionList");
  const actions = $("#metaNextActions");
  if (!title || !summary || !cards || !permissions || !actions) return;

  if (message) {
    title.textContent = message;
    summary.textContent = "The app is checking your Meta setup now.";
    cards.innerHTML = "";
    permissions.innerHTML = "";
    actions.innerHTML = "";
    return;
  }

  const health = state.tokenHealth;
  if (!health) {
    title.textContent = "Meta health has not been checked yet";
    summary.textContent = "Click Check Meta health to verify the app, token, permissions, Instagram account, and Facebook Page.";
    cards.innerHTML = metaHealthCards([
      ["Status", "Not checked", "neutral"],
      ["Token", "Unknown", "neutral"],
      ["Instagram", "Unknown", "neutral"],
      ["Facebook", "Unknown", "neutral"]
    ]);
    permissions.innerHTML = `<p class="note">Permissions appear after a health check.</p>`;
    actions.innerHTML = metaActionItems([{ text: "Run a Meta health check.", detail: "This refreshes token, Page, Instagram and permission checks." }]);
    bindChromeOpeners(actions);
    return;
  }

  const model = buildMetaHealthModel(health);
  title.textContent = model.ready ? "Meta is ready to publish" : "Meta needs attention";
  summary.textContent = model.summary;
  cards.innerHTML = metaHealthCards(model.cards);
  permissions.innerHTML = model.permissions.map((item) => `
    <article class="${item.ok ? "ok" : "missing"}">
      <strong>${item.ok ? "OK" : "Missing"}</strong>
      <span>${escapeHtml(item.label)}</span>
    </article>
  `).join("");
  actions.innerHTML = metaActionItems(model.actions);
  bindChromeOpeners(actions);
}

function buildMetaHealthModel(health = {}) {
  const checks = Array.isArray(health.checks) ? health.checks : [];
  const graph = Array.isArray(health.graph?.results) ? health.graph.results : [];
  const checkMap = new Map(checks.map((item) => [item.id, item]));
  const graphMap = new Map(graph.map((item) => [item.id, item]));
  const token = graphMap.get("token_debug");
  const tokenExpiry = tokenExpirySummary(token);
  const tokenOk = Boolean(checkMap.get("env_access_token")?.ok && graphMap.get("token_me")?.ok);
  const pageOk = Boolean(checkMap.get("env_page_id")?.ok && graphMap.get("facebook_page")?.ok);
  const instagramOk = Boolean(graphMap.get("instagram_user")?.ok);
  const appOk = Boolean(checkMap.get("env_meta_app_id")?.ok && checkMap.get("env_app_secret")?.ok);
  const pageTokenOk = Boolean(checkMap.get("env_page_access_token")?.ok);
  const requiredPermissions = [
    ["pages_show_list", "pages_show_list"],
    ["pages_read_engagement", "pages_read_engagement"],
    ["pages_manage_posts", "pages_manage_posts"],
    ["instagram_basic", "instagram_basic"],
    ["instagram_content_publish", "instagram_content_publish"]
  ].map(([id, label]) => ({
    id,
    label,
    ok: Boolean(checkMap.get(`perm_${id}`)?.ok)
  }));
  const permissionsOk = requiredPermissions.every((item) => item.ok);
  const ready = Boolean(health.ok && tokenOk && pageOk && instagramOk && appOk && pageTokenOk && permissionsOk);
  const actions = [];
  const failedDetail = (id, fallback = "") => {
    const entry = checkMap.get(id) || graphMap.get(id);
    return entry?.detail || graphErrorText(entry) || entry?.error || fallback;
  };

  if (!appOk) actions.push({
    text: "Add Meta app ID and app secret.",
    detail: failedDetail("env_meta_app_id", "Open your Meta app dashboard, then copy App ID and App Secret into backend .env."),
    url: "https://developers.facebook.com/apps/",
    button: "Open Meta apps in Chrome"
  });
  if (!tokenOk) actions.push({
    text: "Refresh or replace META_ACCESS_TOKEN.",
    detail: failedDetail("token_me", failedDetail("env_access_token", "The user token is missing, expired, revoked, or cannot be parsed.")),
    url: "https://developers.facebook.com/tools/explorer/",
    button: "Open Graph API Explorer in Chrome"
  });
  if (tokenExpiry.status === "soon") actions.push({
    text: "Refresh the Meta access token soon.",
    detail: tokenExpiry.text,
    url: "https://developers.facebook.com/tools/debug/accesstoken/",
    button: "Open token debugger in Chrome"
  });
  if (!pageTokenOk) actions.push({
    text: "Add META_PAGE_ACCESS_TOKEN.",
    detail: failedDetail("env_page_access_token", "Get the Page access token from /me/accounts and paste it into backend .env."),
    url: "https://developers.facebook.com/tools/explorer/",
    button: "Open Graph API Explorer in Chrome"
  });
  if (!pageOk) actions.push({
    text: "Fix FACEBOOK_PAGE_ID or Page access.",
    detail: failedDetail("facebook_page", "The Page ID is missing/wrong or the token cannot access that Facebook Page."),
    url: "https://business.facebook.com/settings/pages",
    button: "Open Business Page settings in Chrome"
  });
  if (!instagramOk) actions.push({
    text: "Fix IG_USER_ID or Instagram/Page link.",
    detail: failedDetail("instagram_user", "The Instagram professional account is missing/wrong or not connected to the Facebook Page."),
    url: "https://business.facebook.com/latest/settings/instagram_accounts",
    button: "Open Instagram settings in Chrome"
  });
  requiredPermissions.filter((item) => !item.ok).forEach((item) => actions.push({
    text: `Grant ${item.label} permission in Meta.`,
    detail: failedDetail(`perm_${item.id}`, `${item.label} is not granted on the current token.`),
    url: "https://developers.facebook.com/tools/explorer/",
    button: "Open Graph API Explorer in Chrome"
  }));
  if (!health.publishingEnabled) actions.push({
    text: "Enable API publishing mode.",
    detail: "The backend is in readiness/setup mode. Use test/live publishing mode when you are ready.",
    url: "#posting",
    button: "Open posting settings"
  });
  if (!actions.length) actions.push({ text: "No action needed. Meta publishing is ready.", detail: tokenExpiry.text });

  return {
    ready,
    summary: ready
      ? `Token, Page, Instagram account, and permissions look ready. ${tokenExpiry.text}`
      : "Fix the items below before relying on automatic publishing.",
    cards: [
      ["Overall", ready ? "Ready" : "Fix", ready ? "good" : "bad"],
      ["Token", tokenOk ? tokenExpiry.label : "Invalid", tokenOk && tokenExpiry.status !== "soon" ? "good" : tokenOk ? "warn" : "bad"],
      ["Instagram", instagramOk ? graphName(graphMap.get("instagram_user")) : "Not connected", instagramOk ? "good" : "bad"],
      ["Facebook", pageOk ? graphName(graphMap.get("facebook_page")) : "Not connected", pageOk ? "good" : "bad"],
      ["Permissions", permissionsOk ? "All granted" : "Missing", permissionsOk ? "good" : "bad"],
      ["Mode", health.publishingEnabled ? "API enabled" : "Readiness", health.publishingEnabled ? "good" : "warn"]
    ],
    permissions: requiredPermissions,
    actions
  };
}

function metaHealthCards(items) {
  return items.map(([label, value, tone]) => `
    <article class="${escapeHtml(tone || "neutral")}">
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </article>
  `).join("");
}

function metaActionItems(items) {
  return items.map((item, index) => `
    <article>
      <strong>${index + 1}</strong>
      <span>${escapeHtml(item.text || item)}</span>
      ${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ""}
      ${item.url ? metaActionButton(item) : ""}
    </article>
  `).join("");
}

function metaActionButton(item = {}) {
  if (String(item.url || "").startsWith("#")) {
    return `<a class="secondary meta-action-button" href="${escapeHtml(item.url)}">${escapeHtml(item.button || "Open")}</a>`;
  }
  return `<button class="secondary meta-action-button open-chrome-link" data-url="${escapeHtml(item.url)}">${escapeHtml(item.button || "Open in Chrome")}</button>`;
}

function graphName(result = {}) {
  return result.body?.username || result.body?.name || result.body?.id || "Connected";
}

function tokenExpirySummary(item = {}) {
  const data = item.body?.data || {};
  if (!item?.ok) return { status: "bad", label: "Invalid", text: "Token could not be validated." };
  if (!data.expires_at) return { status: "good", label: "Valid", text: "Meta did not return an expiry date." };
  const expires = new Date(Number(data.expires_at) * 1000);
  const days = Math.ceil((expires.getTime() - Date.now()) / 86400000);
  if (days <= 0) return { status: "bad", label: "Expired", text: `Token expired ${formatSchedule(expires.toISOString())}.` };
  if (days <= 7) return { status: "soon", label: `${days}d left`, text: `Token expires ${formatSchedule(expires.toISOString())}.` };
  return { status: "good", label: `${days}d left`, text: `Token expires ${formatSchedule(expires.toISOString())}.` };
}

function graphErrorText(item = {}) {
  return item.body?.error?.message || item.error || `Meta returned ${item.status || "an error"}`;
}

function tokenDebugText(item = {}) {
  const data = item.body?.data || {};
  if (!item.ok) return graphErrorText(item);
  if (!data.expires_at) return data.is_valid === true ? "Valid. No expiry returned by Meta." : "Connected";
  const expires = new Date(Number(data.expires_at) * 1000);
  const days = Math.ceil((expires.getTime() - Date.now()) / 86400000);
  if (days <= 7) return `Expires ${formatSchedule(expires.toISOString())}. Refresh soon.`;
  return `Expires ${formatSchedule(expires.toISOString())}. ${days} days left.`;
}

async function loadStartupStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/startup/status`);
    const result = await response.json();
    state.startupStatus = result;
    renderStartupStatus();
    renderHelpStatus();
    renderFirstRunWizard();
  } catch {
    state.startupStatus = null;
    renderStartupStatus("Backend is not running. Startup status will appear when the app is open.");
    renderHelpStatus();
    renderFirstRunWizard();
  }
}

function renderStartupStatus(message = "") {
  const stats = $("#startupAutomationStats");
  const status = $("#startupAutomationStatus");
  if (!stats || !status) return;
  if (message) {
    stats.innerHTML = `<article><strong>...</strong><span>${escapeHtml(message)}</span></article>`;
    status.textContent = message;
    return;
  }

  const info = state.startupStatus;
  const latest = info?.latest;
  const latestMessage = latest?.message || "No startup publish has run yet.";
  const task = info?.scheduledTask || {};
  stats.innerHTML = [
    ["Background publisher", info?.backgroundInstalled ? "On" : info?.startupFallbackInstalled ? "Startup only" : "No"],
    ["Next check", task?.nextRunTime ? formatSchedule(task.nextRunTime) : info?.backgroundInstalled ? "Waiting" : "Not scheduled"],
    ["Dashboard opens", info?.dashboardInstalled ? "Yes" : "No"],
    ["Last run", info?.latestRunAt ? formatSchedule(info.latestRunAt) : latest?.checkedAt ? formatSchedule(latest.checkedAt) : "Not yet"],
    ["Published", latest?.publishedCount ?? latest?.published?.length ?? 0],
    ["Errors", latest?.errorCount ?? latest?.errors?.length ?? 0]
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");
  status.textContent = latestMessage;
}

async function runStartupAction(action) {
  const labels = {
    install: "Installing background publisher...",
    uninstall: "Removing background publisher...",
    test: "Running startup publisher test...",
    dashboardInstall: "Installing dashboard startup opener...",
    dashboardUninstall: "Removing dashboard startup opener..."
  };
  setStatus("#startupAutomationStatus", labels[action] || "Working...");
  try {
    const endpoint =
      action === "test" ? "/api/startup/test"
        : action === "uninstall" ? "/api/startup/uninstall"
          : action === "dashboardInstall" ? "/api/startup/dashboard/install"
            : action === "dashboardUninstall" ? "/api/startup/dashboard/uninstall"
              : "/api/startup/install";
    const result = await postBackend(endpoint, {});
    state.startupStatus = result.status || null;
    renderStartupStatus();
    renderFirstRunWizard();
    setStatus("#startupAutomationStatus", result.message || "Automation action finished.");
    if (result.items) {
      mergePublishResultsIntoStores(result.items);
      save();
      renderPostingPlan();
      renderDashboard();
      renderHelpStatus();
    }
  } catch {
    setStatus("#startupAutomationStatus", "Startup action failed. Make sure the backend is running.");
  }
}

async function loadMetaHistory() {
  setStatus("#metaHistoryStatus", "Checking live Instagram and Facebook history...");
  try {
    const response = await fetch(`${backendUrl}/api/meta/history`);
    const result = await response.json();
    state.metaHistory = Array.isArray(result.items) ? result.items : [];
    setStatus("#metaHistoryStatus", result.message || "Meta history loaded.");
    renderPublishingHistory();
  } catch {
    setStatus("#metaHistoryStatus", "Could not load live Meta history. Check token health first.");
  }
}

function renderPublishingHistory(message = "") {
  const list = $("#publishingHistoryList");
  if (!list) return;

  if (message) {
    list.innerHTML = `<p class="note">${escapeHtml(message)}</p>`;
    return;
  }

  const metaItems = [...state.metaHistory];
  const items = [...state.publishingHistory];
  if (!items.length) {
    list.innerHTML = metaItems.length
      ? renderMetaHistoryCards(metaItems)
      : `<p class="note">No local publish history found yet. Posts published through this scheduler will appear here.</p>`;
    return;
  }

  list.innerHTML = `
    ${items.map((item, index) => {
    const label = Array.isArray(item.platformLabels) && item.platformLabels.length
      ? item.platformLabels.join(" + ")
      : [
        item.instagramDone ? "Instagram" : "",
        item.facebookDone ? "Facebook" : "",
        item.youtubeShortsDone ? "YouTube Shorts" : "",
        item.youtubeVideoDone ? "YouTube" : ""
      ].filter(Boolean).join(" + ") || "Published";
    const postedAt = item.lastPublishedAt || item.instagramPublishedAt || item.facebookPublishedAt || item.lastSeenAt;
    return `
      <article class="timeline-card posted">
        <span>${index + 1}</span>
        <strong>${escapeHtml(item.title || "Untitled Reel")}</strong>
        <small>${escapeHtml(item.album || "Unknown album")}</small>
        <time>${formatSchedule(postedAt)}</time>
        <em>${label}</em>
      </article>
    `;
  }).join("")}
    ${metaItems.length ? `<h5 class="history-subhead">Live Meta posts</h5>${renderMetaHistoryCards(metaItems)}` : ""}
  `;
}

function renderMetaHistoryCards(items) {
  return items.slice(0, 20).map((item, index) => `
    <article class="timeline-card posted">
      <span>${index + 1}</span>
      <strong>${escapeHtml(item.title || "Meta post")}</strong>
      <small>${escapeHtml(item.platform || "Meta")}</small>
      <time>${formatSchedule(item.publishedAt)}</time>
      <em>${escapeHtml(item.type || "post")}</em>
    </article>
  `).join("");
}

function formatSchedule(value) {
  if (!value) return "No date set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function publishItemApiSummary(item) {
  if (item.publishStatus === "published" || item.status === "posted") {
    return `Published${item.publishedAt ? ` at ${new Date(item.publishedAt).toLocaleString()}` : ""}.`;
  }
  if (item.publishStatus === "publish-error") return "Publish failed. Check the latest API run output.";
  if (item.containerStatus === "container-created" && item.containerId) return `Instagram container ready: ${item.containerId}`;
  if (item.publicVideoUrl) return "Uploaded to R2. Auto publisher will create the container at publish time.";
  return "Add a public HTTPS MP4 URL before API publishing.";
}

async function prepareInstagramItem(id) {
  const item = state.publishingQueue.find((entry) => entry.id === id);
  if (!item) return;

  updatePublishItem(id, "apiMessage", "Checking with local backend...", true);

  try {
    const response = await fetch(`${backendUrl}/api/publish/instagram/reel`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ item })
    });
    const result = await response.json();
    const message = result.message || (result.ok ? "Ready for Instagram." : "Not ready yet.");
    updatePublishItem(id, "apiMessage", message, true);
  } catch (error) {
    updatePublishItem(id, "apiMessage", "Backend is not running yet. Start it before checking Instagram publishing.", true);
  }
}

function getPostingSettings() {
  return {
    publishMode: $("#publishMode")?.value || "approval",
    requirePreview: Boolean($("#requirePreview")?.checked),
    skipFallbackAudio: Boolean($("#skipFallbackAudio")?.checked),
    igAccount: $("#igAccount")?.value || currentProfile()?.handle || "",
    defaultPostType: $("#defaultPostType")?.value || "reel",
    publishOriginalAudio: Boolean($("#publishOriginalAudio")?.checked),
    captionStyle: $("#captionStyle")?.value || "calm",
    hashtagSet: $("#hashtagSet")?.value || "",
    postingTimezone: $("#postingTimezone")?.value || "Europe/London",
    postingWindow: $("#postingWindow")?.value || "start",
    maxPostsPerDay: 1,
    shortsPerDay: Number($("#shortsPerDay")?.value) || 1,
    shortScheduleTimes: getShortScheduleTimes(),
    mixReels: Number($("#mixReels")?.value ?? 100) || 100,
    mixStories: Number($("#mixStories")?.value ?? 0) || 0,
    mixFeed: Number($("#mixFeed")?.value ?? 0) || 0,
    postingCooldown: Number($("#postingCooldown")?.value) || 90,
    renderBatchSize: Number($("#renderBatchSize")?.value) || 7,
    renderPreset: $("#renderPreset")?.value || "optimized",
    renderMinSeconds: Number($("#renderMinSeconds")?.value) || 20,
    renderMaxSeconds: Number($("#renderMaxSeconds")?.value) || 30,
    renderFadeSeconds: Number($("#renderFadeSeconds")?.value) || 4,
    optimizedPresetMigrationComplete: true
  };
}

function getSetupWizard() {
  return {
    artistName: $("#setupArtistName")?.value || currentProfile()?.name || "Maja's Coffee Jazz Zone",
    audioRoot: normalizeSetupFolderInput($("#setupAudioRoot")?.value || ""),
    artworkRoot: normalizeSetupFolderInput($("#setupArtworkRoot")?.value || ""),
    lastScan: state.setupWizard?.lastScan || null
  };
}

function loadSetupWizard() {
  const setup = {
    artistName: currentProfile()?.name || "Maja's Coffee Jazz Zone",
    audioRoot: "",
    artworkRoot: "",
    ...(state.setupWizard || {})
  };

  const artist = $("#setupArtistName");
  const audio = $("#setupAudioRoot");
  const artwork = $("#setupArtworkRoot");
  if (artist) artist.value = setup.artistName || "";
  if (audio) audio.value = setup.audioRoot || "";
  if (artwork) artwork.value = setup.artworkRoot || "";
  syncFirstRunFieldsFromSetup(setup);
  renderSetupLibrarySummary(setup.lastScan);
}

function syncFirstRunFieldsFromSetup(setup = getSetupWizard()) {
  const artist = $("#wizardArtistName");
  const audio = $("#wizardAudioRoot");
  const artwork = $("#wizardArtworkRoot");
  if (artist) artist.value = setup.artistName || "";
  if (audio) audio.value = setup.audioRoot || "";
  if (artwork) artwork.value = setup.artworkRoot || "";
}

function syncSetupFieldsFromFirstRun() {
  const setup = {
    artistName: $("#wizardArtistName")?.value || "Maja's Coffee Jazz Zone",
    audioRoot: normalizeSetupFolderInput($("#wizardAudioRoot")?.value || ""),
    artworkRoot: normalizeSetupFolderInput($("#wizardArtworkRoot")?.value || ""),
    lastScan: state.setupWizard?.lastScan || null
  };
  const artist = $("#setupArtistName");
  const audio = $("#setupAudioRoot");
  const artwork = $("#setupArtworkRoot");
  if (artist) artist.value = setup.artistName;
  if (audio) audio.value = setup.audioRoot;
  if (artwork) artwork.value = setup.artworkRoot;
  state.setupWizard = setup;
  saveSetupWizard();
  renderFirstRunWizard();
}

async function pickSetupFolder(kind) {
  const field = kind === "audio" ? $("#setupAudioRoot") : $("#setupArtworkRoot");
  const title = kind === "audio" ? "Choose the folder containing your audio files" : "Choose the folder containing your artwork";
  setStatus("#setupLibraryStatus", "Opening folder picker...");
  try {
    const result = await postBackend("/api/setup/pick-folder", {
      title,
      initialPath: field?.value.trim() || ""
    });
    if (result.ok && result.path && field) {
      field.value = result.path;
      saveSetupWizard();
      setStatus("#setupLibraryStatus", `${kind === "audio" ? "Audio" : "Artwork"} folder selected.`);
    } else {
      setStatus("#setupLibraryStatus", result.message || "No folder selected.");
    }
  } catch (error) {
    setStatus("#setupLibraryStatus", "Backend is not running. Start the scheduler backend, then choose a folder.");
  }
}

async function pickFirstRunFolder(kind) {
  const field = kind === "audio" ? $("#wizardAudioRoot") : $("#wizardArtworkRoot");
  const title = kind === "audio" ? "Choose the folder containing your audio files" : "Choose the folder containing your artwork";
  setStatus("#wizardStatus", "Opening folder picker...");
  try {
    const result = await postBackend("/api/setup/pick-folder", {
      title,
      initialPath: field?.value.trim() || ""
    });
    if (result.ok && result.path && field) {
      field.value = result.path;
      syncSetupFieldsFromFirstRun();
      setStatus("#wizardStatus", `${kind === "audio" ? "Music" : "Artwork"} folder selected.`);
    } else {
      setStatus("#wizardStatus", result.message || "No folder selected.");
    }
  } catch {
    setStatus("#wizardStatus", "Backend is not running. Open the app launcher, then choose a folder.");
  }
}

async function pasteFolderPath(kind, firstRun = false) {
  const field = firstRun
    ? (kind === "audio" ? $("#wizardAudioRoot") : $("#wizardArtworkRoot"))
    : (kind === "audio" ? $("#setupAudioRoot") : $("#setupArtworkRoot"));
  const statusSelector = firstRun ? "#wizardStatus" : "#setupLibraryStatus";
  if (!field) return;

  let value = "";
  try {
    value = await navigator.clipboard.readText();
  } catch {
    value = prompt("Paste the folder path or file:/// folder link here") || "";
  }

  value = value.trim();
  if (!value) {
    setStatus(statusSelector, "No folder path was pasted.");
    return;
  }

  field.value = normalizeSetupFolderInput(value);
  if (firstRun) {
    syncSetupFieldsFromFirstRun();
  } else {
    state.setupWizard = getSetupWizard();
    saveSetupWizard();
    syncFirstRunFieldsFromSetup();
    renderFirstRunWizard();
  }
  setStatus(statusSelector, `${kind === "audio" ? "Audio" : "Artwork"} folder path added. Run Scan library to check it.`);
}

async function scanFirstRunLibrary() {
  syncSetupFieldsFromFirstRun();
  await scanSetupLibrary();
  syncFirstRunFieldsFromSetup();
  renderFirstRunWizard();
  setStatus("#wizardStatus", state.setupWizard?.lastScan ? "Library scan complete." : "Library scan needs attention.");
}

async function checkFirstRunMeta() {
  setStatus("#wizardStatus", "Checking Meta connection...");
  await loadTokenHealth();
  renderFirstRunWizard();
  const tokenSummary = summarizeTokenHealth();
  setStatus("#wizardStatus", tokenSummary.status === "bad" ? "Meta needs attention. Open Setup > Meta for the exact failed check." : "Meta connection looks ready.");
}

async function installFirstRunStartupPublisher() {
  await runStartupAction("install");
  renderFirstRunWizard();
  setStatus("#wizardStatus", state.startupStatus?.installed ? "Startup publisher installed." : "Startup publisher needs attention.");
}

async function checkFirstRunVisualSources() {
  setStatus("#wizardStatus", "Checking visual source setup...");
  await loadPexelsReadiness();
  renderFirstRunWizard();
  setStatus("#wizardStatus", state.pexelsHealth?.ready
    ? "Visual sources are ready. Album theme guidance and enabled stock providers can support atmosphere Shorts."
    : "Visual sources are optional. Add PEXELS_API_KEY or PIXABAY_API_KEY in the backend .env later if you want automatic stock video sourcing.");
}

function finishFirstRunSetup(skip = false) {
  syncSetupFieldsFromFirstRun();
  if (!skip) {
    const scanReady = Boolean(state.setupWizard?.lastScan?.eligibleCount || state.tracks.length);
    const tokenSummary = summarizeTokenHealth();
    if (!scanReady || tokenSummary.status === "bad") {
      setStatus("#wizardStatus", "Complete the required library scan and Meta check first, or choose Skip for now.");
      renderFirstRunWizard();
      return;
    }
  }
  saveFirstRunComplete(true);
  renderFirstRunWizard();
  location.hash = "dashboard";
  syncView();
}

async function scanSetupLibrary() {
  const setup = getSetupWizard();
  if (!setup.audioRoot) {
    setStatus("#setupLibraryStatus", "Choose an audio folder first.");
    return;
  }

  setStatus("#setupLibraryStatus", "Scanning audio and artwork folders...");
  try {
    const result = await postBackend("/api/library/scan", {
      profileId: state.activeProfileId,
      artistName: setup.artistName,
      audioRoot: setup.audioRoot,
      artworkRoot: setup.artworkRoot,
      writeCatalog: true
    });

    if (!result.ok) {
      setStatus("#setupLibraryStatus", result.message || "Library scan failed.");
      return;
    }

    state.setupWizard = {
      ...setup,
      audioRoot: result.audioRoot || setup.audioRoot,
      artworkRoot: result.artworkRoot || setup.artworkRoot,
      lastScan: {
        scannedAt: new Date().toISOString(),
        trackCount: result.trackCount,
        artworkCount: result.artworkCount,
        eligibleCount: result.eligibleCount,
        missingArtworkCount: result.missingArtworkCount || 0,
        missingAudioCount: result.missingAudioCount || 0,
        duplicateCount: result.duplicateCount || 0,
        unsupportedCount: result.unsupportedCount || 0,
        issues: Array.isArray(result.issues) ? result.issues : [],
        catalogPath: result.catalogPath
      }
    };
    state.tracks = result.items.map((item) => ({
      id: item.id || crypto.randomUUID(),
      title: item.title,
      artist: item.artist,
      album: item.album,
      artworkUrl: item.artworkUrl,
      audioUrl: item.audioUrl,
      storeUrl: item.storeUrl || "",
      mood: item.mood || "",
      bpm: item.bpm || null,
      isrc: item.isrc || "",
      importedAt: item.importedAt || new Date().toISOString()
    }));
    save();
    saveSetupWizard();
    renderAll();
    renderFirstRunWizard();
    setStatus("#setupLibraryStatus", result.message || "Library scan complete.");
  } catch (error) {
    setStatus("#setupLibraryStatus", "Scan failed. Check the backend is running and the folder paths exist.");
  }
}

async function mergeFolderCatalogFromSetup() {
  const setup = getSetupWizard();
  const confirmed = confirm("Merge album folders that are missing from the renderer catalogue? A backup of the current catalogue will be created first.");
  if (!confirmed) return;

  setStatus("#setupLibraryStatus", "Merging missing album folders into the renderer catalogue...");
  renderCatalogMergeReport(null);
  try {
    const result = await postBackend("/api/library/merge-folder-catalog", {
      profileId: state.activeProfileId,
      artistName: setup.artistName,
      audioRoot: setup.audioRoot,
      artworkRoot: setup.artworkRoot
    });

    renderCatalogMergeReport(result);
    setStatus("#setupLibraryStatus", result.message || "Catalogue merge complete.");
  } catch {
    setStatus("#setupLibraryStatus", "Catalogue merge failed. Check the backend is running and the audio folder path exists.");
  }
}

function renderCatalogMergeReport(result) {
  const panel = $("#catalogMergeReport");
  if (!panel) return;
  if (!result) {
    panel.innerHTML = "";
    return;
  }

  const addedAlbums = Array.isArray(result.addedAlbums) ? result.addedAlbums : [];
  const skipped = Array.isArray(result.skippedFolders) ? result.skippedFolders : [];
  panel.innerHTML = `
    <article class="${result.ok ? "success" : "warning"}">
      <h5>Catalogue merge report</h5>
      <p>${escapeHtml(result.message || "Merge finished.")}</p>
      <div class="setup-result-grid">
        <article><strong>${result.addedAlbumCount || 0}</strong><span>Albums added</span></article>
        <article><strong>${result.addedTrackCount || 0}</strong><span>Tracks added</span></article>
        <article><strong>${result.scannedFolderCount || 0}</strong><span>Folders scanned</span></article>
        <article><strong>${result.newAlbumCount || result.existingAlbumCount || 0}</strong><span>Catalogue albums now</span></article>
      </div>
      ${addedAlbums.length ? `
        <table>
          <thead><tr><th>Added album</th><th>Tracks</th><th>Example tracks</th></tr></thead>
          <tbody>
            ${addedAlbums.map((album) => `
              <tr>
                <td>${escapeHtml(album.album)}</td>
                <td>${album.tracks || 0}</td>
                <td>${escapeHtml((album.examples || []).join(", "))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : ""}
      ${skipped.length ? `<p class="note">Skipped: ${escapeHtml(skipped.map((item) => `${item.album}: ${item.reason}`).join(" | "))}</p>` : ""}
      ${result.backupPath ? `<p class="note">Backup saved: ${escapeHtml(result.backupPath)}</p>` : ""}
      ${result.reportPath ? `<p class="note">Report saved: ${escapeHtml(result.reportPath)}</p>` : ""}
    </article>
  `;
}

function renderSetupLibrarySummary(scan = state.setupWizard?.lastScan) {
  const summary = $("#setupLibrarySummary");
  const preview = $("#setupLibraryPreview");
  if (!summary || !preview) return;

  if (!scan) {
    summary.innerHTML = "";
    preview.innerHTML = `<p class="note">No setup scan has been run yet.</p>`;
    renderLibraryIssues(null);
    return;
  }

  summary.innerHTML = [
    ["Tracks found", scan.trackCount || 0],
    ["Artwork files", scan.artworkCount || 0],
    ["Render-ready", scan.eligibleCount || 0],
    ["Missing artwork", scan.missingArtworkCount || 0],
    ["Duplicates", scan.duplicateCount || 0],
    ["Unsupported", scan.unsupportedCount || 0]
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");

  preview.innerHTML = `
    <table>
      <tr><th>Catalog saved for renderer</th></tr>
      <tr><td>${escapeHtml(scan.catalogPath || "Not saved yet")}</td></tr>
    </table>
  `;
  renderLibraryIssues(scan);
}

function renderLibraryIssues(scan = state.setupWizard?.lastScan) {
  const stats = $("#libraryIssueStats");
  const albumList = $("#missingArtworkAlbums");
  const list = $("#libraryIssueList");
  if (!stats || !list) return;

  if (!scan) {
    stats.innerHTML = "";
    if (albumList) albumList.innerHTML = "";
    list.innerHTML = `<p class="note">Run a library scan to review missing artwork, duplicates, and unsupported files.</p>`;
    return;
  }

  const issues = Array.isArray(scan.issues) ? scan.issues : [];
  const filtered = state.libraryIssueFilter === "all"
    ? issues
    : issues.filter((issue) => issue.type === state.libraryIssueFilter);

  stats.innerHTML = [
    ["Ready tracks", scan.eligibleCount || 0],
    ["Missing artwork", scan.missingArtworkCount || 0],
    ["Duplicate titles", scan.duplicateCount || 0],
    ["Unsupported files", scan.unsupportedCount || 0]
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");

  if (albumList) {
    const missingByAlbum = new Map();
    issues
      .filter((issue) => issue.type === "missing-artwork")
      .forEach((issue) => {
        const album = issue.album || "Unknown album";
        const current = missingByAlbum.get(album) || { album, count: 0, examples: [] };
        current.count += 1;
        if (current.examples.length < 3) current.examples.push(issue.title || "Untitled");
        missingByAlbum.set(album, current);
      });
    const albums = [...missingByAlbum.values()].sort((a, b) => b.count - a.count || a.album.localeCompare(b.album));
    albumList.innerHTML = albums.length
      ? `
        <h5>Albums still missing artwork</h5>
        <table>
          <thead><tr><th>Album</th><th>Tracks affected</th><th>Example tracks</th></tr></thead>
          <tbody>
            ${albums.map((entry) => `
              <tr>
                <td>${escapeHtml(entry.album)}</td>
                <td>${entry.count}</td>
                <td>${escapeHtml(entry.examples.join(", "))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `
      : `<p class="note">No albums are missing artwork in the latest scan.</p>`;
  }

  if (!issues.length) {
    list.innerHTML = `<p class="note">No missing assets or duplicate-title issues found. Lovely and tidy.</p>`;
    return;
  }

  if (!filtered.length) {
    list.innerHTML = `<p class="note">No issues in this filter.</p>`;
    return;
  }

  list.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Issue</th>
          <th>Track / file</th>
          <th>Album / folder</th>
          <th>What to fix</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.slice(0, 250).map((issue) => `
          <tr>
            <td><span class="issue-pill ${escapeHtml(issue.severity || "warning")}">${escapeHtml(issue.type || "issue")}</span></td>
            <td>${escapeHtml(issue.title || "Unknown")}</td>
            <td>${escapeHtml(issue.album || "")}</td>
            <td>${escapeHtml(issue.message || issue.path || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${filtered.length > 250 ? `<p class="note">Showing first 250 of ${filtered.length} issues.</p>` : ""}
  `;
}

function renderFirstRunWizard() {
  const scan = state.setupWizard?.lastScan || null;
  const tokenSummary = summarizeTokenHealth();
  const startupInstalled = Boolean(state.startupStatus?.installed);
  const visualReady = Boolean(state.pexelsHealth?.ready);
  const steps = [
    { label: "Artist", type: "Required", ok: Boolean($("#wizardArtistName")?.value || state.setupWizard?.artistName) },
    { label: "Music folder", type: "Required", ok: Boolean($("#wizardAudioRoot")?.value || state.setupWizard?.audioRoot) },
    { label: "Library scan", type: "Required", ok: Boolean(scan?.eligibleCount || state.tracks.length) },
    { label: "Meta check", type: "Required", ok: tokenSummary.status === "good" || tokenSummary.status === "soon" },
    { label: "Visual sources", type: "Optional", ok: visualReady, optional: true },
    { label: "Startup publisher", type: "Optional", ok: startupInstalled, optional: true }
  ];
  const requiredSteps = steps.filter((step) => !step.optional);
  const requiredComplete = requiredSteps.filter((step) => step.ok).length;
  const complete = steps.filter((step) => step.ok).length;
  const percent = Math.round((requiredComplete / requiredSteps.length) * 100);
  const bar = $("#wizardProgressBar");
  if (bar) bar.style.width = `${percent}%`;

  const summary = $("#wizardStepSummary");
  if (summary) {
    summary.innerHTML = steps.map((step) => `
      <article class="${step.ok ? "done" : ""} ${step.optional ? "optional" : ""}">
        <strong>${step.ok ? "Done" : step.type}</strong>
        <span>${escapeHtml(step.label)}</span>
      </article>
    `).join("");
  }

  const scanStats = $("#wizardScanStats");
  if (scanStats) {
    scanStats.innerHTML = scan
      ? wizardMiniStats([
        ["Tracks", scan.trackCount || state.tracks.length || 0],
        ["Ready", scan.eligibleCount || 0],
        ["Missing art", scan.missingArtworkCount || 0],
        ["Duplicates", scan.duplicateCount || 0]
      ])
      : `<p class="note">No scan yet.</p>`;
  }

  const metaStats = $("#wizardMetaStats");
  if (metaStats) {
    metaStats.innerHTML = wizardMiniStats([
      ["Status", tokenSummary.label],
      ["Checks", state.tokenHealth?.checks?.filter((item) => item.ok).length || 0],
      ["Mode", state.tokenHealth?.publishingEnabled ? "Live" : "Setup"]
    ]);
  }

  const startupStats = $("#wizardStartupStats");
  if (startupStats) {
    startupStats.innerHTML = wizardMiniStats([
      ["Installed", startupInstalled ? "Yes" : "No"],
      ["Last run", state.startupStatus?.latestRunAt ? formatSchedule(state.startupStatus.latestRunAt) : "Not yet"]
    ]);
  }

  const visualStats = $("#wizardVisualStats");
  if (visualStats) {
    const health = state.pexelsHealth;
    visualStats.innerHTML = health
      ? wizardMiniStats([
        ["Stock videos", health.ready ? "Ready" : "Missing"],
        ["Clips", health.localVideoCount || 0],
        ["Sources", health.sourceRecordCount || 0],
        ["Themes", `${health.albumThemeFilledCount || 0}/${health.albumThemeCount || 0}`]
      ])
      : `<p class="note">Not checked yet.</p>`;
  }

  const status = $("#wizardStatus");
  const title = $("#wizardFinishTitle");
  if (status && title) {
    if (requiredComplete === requiredSteps.length) {
      title.textContent = "Ready to enter the dashboard";
      status.textContent = startupInstalled
        ? "Required setup is complete and startup automation is installed. You can start generating and scheduling Reels."
        : "Required setup is complete. Startup automation can be added later from Setup.";
    } else {
      title.textContent = `${requiredComplete}/${requiredSteps.length} required checks complete`;
      const next = requiredSteps.find((step) => !step.ok);
      status.textContent = next ? `Next required step: ${next.label}.` : "Review the setup checks above.";
    }
  }
}

function renderUserConfigStatus() {
  const stats = $("#userConfigStats");
  const path = $("#userConfigPath");
  if (!stats || !path) return;
  const scan = state.setupWizard?.lastScan;
  const configKnown = Boolean(state.userConfigPath);
  stats.innerHTML = [
    ["Setup complete", state.firstRunComplete ? "Yes" : "No"],
    ["Config file", configKnown ? "Saved" : "Browser only"],
    ["Artist", state.setupWizard?.artistName || "Not set"],
    ["Tracks scanned", scan?.trackCount || state.tracks.length || 0]
  ].map(([label, value]) => `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
  path.textContent = configKnown
    ? `Saved at: ${state.userConfigPath}`
    : "The backend is not running yet, so setup is currently saved in this browser only.";
}

function wizardMiniStats(items) {
  return items.map(([label, value]) => `
    <div>
      <strong>${escapeHtml(value)}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
  `).join("");
}

function getInstagramSetup() {
  return {
    igHandle: $("#setupIgHandle")?.value || currentProfile()?.handle || "@majascoffeejazzzone",
    igType: $("#setupIgType")?.value || "creator",
    igProfessional: Boolean($("#setupIgProfessional")?.checked),
    pageName: $("#setupPageName")?.value || currentProfile()?.name || "Maja's Coffee Jazz Zone",
    pageUrl: $("#setupPageUrl")?.value || "",
    pageLinked: Boolean($("#setupPageLinked")?.checked),
    appStatus: $("#setupAppStatus")?.value || "not-created",
    appId: $("#setupAppId")?.value || "",
    backendRequired: Boolean($("#setupBackendRequired")?.checked),
    publishMode: $("#setupPublishMode")?.value || "manual",
    requireApproval: Boolean($("#setupRequireApproval")?.checked),
    noSecretsInBrowser: Boolean($("#setupNoSecretsInBrowser")?.checked),
    permissions: {
      instagramBasic: Boolean($("#permInstagramBasic")?.checked),
      instagramPublish: Boolean($("#permInstagramPublish")?.checked),
      pagesShow: Boolean($("#permPagesShow")?.checked),
      pagesEngagement: Boolean($("#permPagesEngagement")?.checked)
    }
  };
}

function loadInstagramSetup() {
  const defaults = {
    igHandle: currentProfile()?.handle || "@majascoffeejazzzone",
    igType: "creator",
    igProfessional: true,
    pageName: currentProfile()?.name || "Maja's Coffee Jazz Zone",
    pageUrl: "https://www.facebook.com/profile.php?id=61590381973296&sk=about",
    pageLinked: true,
    appStatus: "not-created",
    appId: "",
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
  const setup = { ...defaults, ...(state.instagramSetup || {}) };
  setup.permissions = { ...defaults.permissions, ...(setup.permissions || {}) };

  const fieldMap = {
    setupIgHandle: setup.igHandle,
    setupIgType: setup.igType,
    setupIgProfessional: setup.igProfessional,
    setupPageName: setup.pageName,
    setupPageUrl: setup.pageUrl,
    setupPageLinked: setup.pageLinked,
    setupAppStatus: setup.appStatus,
    setupAppId: setup.appId,
    setupBackendRequired: setup.backendRequired,
    setupPublishMode: setup.publishMode,
    setupRequireApproval: setup.requireApproval,
    setupNoSecretsInBrowser: setup.noSecretsInBrowser,
    permInstagramBasic: setup.permissions.instagramBasic,
    permInstagramPublish: setup.permissions.instagramPublish,
    permPagesShow: setup.permissions.pagesShow,
    permPagesEngagement: setup.permissions.pagesEngagement
  };

  Object.entries(fieldMap).forEach(([id, value]) => {
    const field = $(`#${id}`);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });

  renderInstagramSetup();
}

function renderInstagramSetup() {
  const setup = getInstagramSetup();
  const checks = [
    setup.igProfessional && setup.igType !== "personal",
    setup.pageLinked,
    setup.appStatus !== "not-created",
    setup.backendRequired,
    setup.requireApproval,
    setup.noSecretsInBrowser,
    setup.permissions.instagramBasic,
    setup.permissions.instagramPublish,
    setup.permissions.pagesShow,
    setup.permissions.pagesEngagement
  ];
  const ready = checks.filter(Boolean).length;
  const total = checks.length;

  const readyTarget = $("#setupReadyCount");
  if (readyTarget) readyTarget.textContent = `${ready}/${total}`;
  const modeTarget = $("#setupModeLabel");
  if (modeTarget) modeTarget.textContent = setup.publishMode === "test" ? "Test" : setup.publishMode === "live-later" ? "Live later" : "Manual";
  const approvalTarget = $("#approvalLabel");
  if (approvalTarget) approvalTarget.textContent = setup.requireApproval ? "Required" : "Off";

  const env = [
    "# Backend-only placeholders. Do not paste secrets into the browser.",
    `IG_HANDLE=${setup.igHandle}`,
    "IG_USER_ID=",
    "FACEBOOK_PAGE_ID=61590381973296",
    `FACEBOOK_PAGE_NAME=${setup.pageName}`,
    `META_APP_ID=${setup.appId || ""}`,
    "META_APP_SECRET=",
    "META_PAGE_ACCESS_TOKEN=",
    `PUBLISHING_MODE=${setup.publishMode}`,
    `REQUIRE_APPROVAL=${setup.requireApproval ? "true" : "false"}`
  ].join("\n");
  const envTarget = $("#setupEnvPreview");
  if (envTarget) envTarget.textContent = env;
  renderMetaHealthConsole();
}

function getYouTubeSetup() {
  return {
    channelLabel: $("#youtubeChannelLabel")?.value || "",
    channelId: $("#youtubeChannelId")?.value || "",
    defaultPrivacy: $("#youtubeDefaultPrivacy")?.value || "private",
    madeForKids: Boolean($("#youtubeMadeForKids")?.checked),
    uploadShorts: Boolean($("#youtubeUploadShorts")?.checked),
    backendRequired: Boolean($("#youtubeBackendRequired")?.checked)
  };
}

function getShortScheduleTimes() {
  const raw = $("#shortScheduleTimes")?.value || AUTO_APPROVED_SCHEDULE_TIMES.join(", ");
  const times = raw
    .split(/[,;\s]+/)
    .map((time) => time.trim())
    .filter((time) => /^\d{1,2}:\d{2}$/.test(time))
    .map((time) => {
      const [hour, minute] = time.split(":").map(Number);
      return `${String(Math.max(0, Math.min(23, hour))).padStart(2, "0")}:${String(Math.max(0, Math.min(59, minute))).padStart(2, "0")}`;
    });
  return [...new Set(times)].slice(0, 6);
}

function loadYouTubeSetup() {
  const defaults = {
    channelLabel: "",
    channelId: "",
    defaultPrivacy: "private",
    madeForKids: false,
    uploadShorts: true,
    backendRequired: true
  };
  const setup = { ...defaults, ...(state.youtubeSetup || {}) };
  const fieldMap = {
    youtubeChannelLabel: setup.channelLabel,
    youtubeChannelId: setup.channelId,
    youtubeDefaultPrivacy: setup.defaultPrivacy,
    youtubeMadeForKids: setup.madeForKids,
    youtubeUploadShorts: setup.uploadShorts,
    youtubeBackendRequired: setup.backendRequired
  };
  Object.entries(fieldMap).forEach(([id, value]) => {
    const field = $(`#${id}`);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });
  renderYouTubeSetup();
}

function renderYouTubeSetup() {
  const setup = getYouTubeSetup();
  const health = state.youtubeHealth;
  const checks = [
    Boolean(setup.channelLabel || setup.channelId),
    setup.uploadShorts,
    setup.backendRequired,
    Boolean(health?.credentials?.clientId),
    Boolean(health?.credentials?.clientSecret),
    Boolean(health?.credentials?.refreshToken)
  ];
  const ready = checks.filter(Boolean).length;
  const total = checks.length;

  setText("#youtubeReadyCount", `${ready}/${total}`);
  setText("#youtubeModeLabel", setup.defaultPrivacy === "public" ? "Public" : setup.defaultPrivacy === "unlisted" ? "Unlisted" : "Private");
  setText("#youtubeCredentialLabel", health?.ready ? "Ready" : health ? "Needs setup" : "Not checked");

  const stats = $("#youtubeHealthStats");
  const details = $("#youtubeHealthDetails");
  if (!stats || !details) return;

  if (!health) {
    stats.innerHTML = `<article><strong>Check</strong><span>YouTube readiness has not been checked yet</span></article>`;
    details.innerHTML = `<p class="note">Add Google OAuth values to the backend .env, then run Check YouTube readiness.</p>`;
    renderYouTubeShortSourceSelector();
    return;
  }

  stats.innerHTML = [
    ["Status", health.ready ? "Ready" : "Setup"],
    ["Credentials", `${health.presentCount || 0}/${health.requiredCount || 0}`],
    ["Channel", health.channelConfigured ? "Set" : "Missing"],
    ["Upload test", health.uploadTestAvailable ? "Next phase" : "Planned"]
  ].map(([label, value]) => `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");

  details.innerHTML = `
    <table>
      <thead><tr><th>Check</th><th>Status</th><th>What it means</th></tr></thead>
      <tbody>
        ${(health.checks || []).map((item) => `
          <tr>
            <td>${escapeHtml(item.label)}</td>
            <td>${item.ok ? "Ready" : "Missing"}</td>
            <td>${escapeHtml(item.help || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  renderYouTubeShortSourceSelector();
}

async function loadYouTubeHealth() {
  const setup = getYouTubeSetup();
  setText("#youtubeCredentialLabel", "Checking");
  try {
    const response = await fetch(`${backendUrl}/api/youtube/readiness`);
    const result = await response.json();
    state.youtubeHealth = { ...result, channelConfigured: Boolean(setup.channelId || setup.channelLabel || result.channelConfigured) };
  } catch {
    state.youtubeHealth = {
      ok: false,
      ready: false,
      message: "Backend is not running.",
      credentials: {},
      checks: [{ id: "backend", label: "Backend", ok: false, help: "Open the app with start-jazz-scheduler.bat." }]
    };
  }
  renderYouTubeSetup();
  renderHelpStatus();
}

async function startYouTubeOAuth() {
  setStatus("#youtubeSetupStatus", "Preparing Google OAuth link...");
  try {
    const response = await fetch(`${backendUrl}/api/youtube/oauth/start`);
    const result = await response.json();
    if (!result.ok || !result.authUrl) {
      setStatus("#youtubeSetupStatus", result.message || "Could not start Google OAuth.");
      return;
    }
    const fallback = $("#youtubeOAuthFallback");
    const link = $("#youtubeOAuthLink");
    if (link) link.href = result.authUrl;
    if (fallback) fallback.hidden = false;
    const opened = await openUrlInChrome(result.authUrl, "#youtubeSetupStatus");
    if (opened.ok) {
      setStatus("#youtubeSetupStatus", "Google OAuth opened in Chrome. Sign in with the YouTube channel account.");
    }
  } catch {
    setStatus("#youtubeSetupStatus", "Backend is not running. Reopen the app with the launcher, then try OAuth again.");
  }
}

async function copyYouTubeOAuthLink() {
  const link = $("#youtubeOAuthLink");
  const authUrl = link?.href;
  if (!authUrl || authUrl.endsWith("#")) {
    setStatus("#youtubeSetupStatus", "Press Start Google OAuth first, then copy the link.");
    return;
  }
  try {
    await navigator.clipboard.writeText(authUrl);
    setStatus("#youtubeSetupStatus", "Google OAuth link copied. Paste it into Chrome and sign in with the YouTube channel account.");
  } catch {
    setStatus("#youtubeSetupStatus", "Could not copy automatically. Right-click the Google OAuth link and copy it manually.");
  }
}

function renderVisualSources() {
  const health = state.pexelsHealth;
  const enabledKeys = [health?.pexelsApiKeyPresent ? "Pexels" : "", health?.pixabayApiKeyPresent ? "Pixabay" : ""].filter(Boolean);
  setText("#pexelsReadyLabel", enabledKeys.length ? enabledKeys.join(" + ") : health ? "Missing" : "Not checked");
  setText("#pexelsLocalVideoCount", String(health?.localVideoCount || 0));
  setText("#pexelsSourceRecordCount", String(health?.sourceRecordCount || 0));
  setText("#pexelsThemeCount", `${health?.albumThemeFilledCount || 0}/${health?.albumThemeCount || 0}`);
  const details = $("#pexelsReadinessDetails");
  if (details) {
    if (!health) {
      details.innerHTML = `<article><strong>Check</strong><span>Run Check sources after adding provider API keys to .env.</span></article>`;
    } else {
      details.innerHTML = [
        ["Pexels key", health.pexelsApiKeyPresent ? "Ready" : "Missing"],
        ["Pixabay key", health.pixabayApiKeyPresent ? "Ready" : "Missing"],
        ["Approved folder", health.approvedVideoDir || ""],
        ["Source records", health.sourceManifestPath || ""],
        ["Album themes", health.albumThemePath || ""]
      ].map(([label, value]) => `<article><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></article>`).join("");
    }
  }
  renderPexelsResults();
}

function renderPexelsResults() {
  const list = $("#pexelsResults");
  if (!list) return;
  if (!state.pexelsResults.length) {
    list.innerHTML = `<p class="note">Search stock sources to find atmosphere videos. Downloaded clips become approved local sources for Short 2 and Short 3.</p>`;
    return;
  }
  list.innerHTML = state.pexelsResults.map((video) => {
    const file = video.selectedFile || {};
    const provider = video.providerLabel || (video.provider === "pixabay" ? "Pixabay" : "Pexels");
    const creator = video.userName || video.user?.name || `${provider} creator`;
    const providerUrl = video.provider === "pixabay" ? "https://pixabay.com/videos/" : "https://www.pexels.com";
    return `
      <article class="visual-result-card">
        <div class="visual-thumb" style="${video.image ? `background-image:url('${video.image}')` : ""}"></div>
        <div>
          <strong>${escapeHtml(video.title || `${provider} video ${video.id}`)}</strong>
          <span>${escapeHtml(`${provider} | ${file.width || video.width || "?"}x${file.height || video.height || "?"} | ${video.duration || "?"}s | ${file.quality || "mp4"}`)}</span>
          <span>${escapeHtml(`Creator: ${creator}`)}</span>
          <a href="${escapeHtml(video.url || providerUrl)}" target="_blank" rel="noreferrer">Open on ${escapeHtml(provider)}</a>
          <button class="secondary download-pexels-video" data-video-id="${escapeHtml(String(video.id))}" data-provider="${escapeHtml(video.provider || "pexels")}">Download and approve</button>
        </div>
      </article>
    `;
  }).join("");
  list.querySelectorAll(".download-pexels-video").forEach((button) => {
    button.addEventListener("click", () => downloadPexelsVideo(button.dataset.videoId, button.dataset.provider));
  });
}

async function loadPexelsReadiness() {
  setStatus("#pexelsStatus", "Checking stock visual source setup...");
  try {
    const response = await fetch(`${backendUrl}/api/visual-sources/pexels/readiness?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const result = await response.json();
    state.pexelsHealth = result;
    const enabled = [result.pexelsApiKeyPresent ? "Pexels" : "", result.pixabayApiKeyPresent ? "Pixabay" : ""].filter(Boolean);
    setStatus("#pexelsStatus", enabled.length ? `${enabled.join(" and ")} ready. You can search and download approved clips.` : "No stock source API keys found in backend .env or the app needs restarting.");
  } catch (error) {
    state.pexelsHealth = { ok: false, apiKeyPresent: false, localVideoCount: 0, sourceRecordCount: 0 };
    setStatus("#pexelsStatus", `Could not check visual sources: ${error.message || "backend unavailable"}`);
  }
  renderVisualSources();
}

async function searchPexelsVideos() {
  const query = $("#pexelsSearchQuery")?.value || "jazz coffee shop relaxing study";
  const provider = $("#stockVideoProvider")?.value || "all";
  const breadth = $("#stockSearchBreadth")?.value || "balanced";
  const orientation = $("#pexelsOrientation")?.value || "portrait";
  const size = $("#pexelsSize")?.value || "medium";
  setStatus("#pexelsStatus", `Searching stock sources for "${query}"...`);
  try {
    const result = await postBackend("/api/visual-sources/videos/search", {
      profileId: state.activeProfileId,
      provider,
      breadth,
      query,
      orientation,
      size,
      perPage: 15
    });
    if (!result.ok) {
      setStatus("#pexelsStatus", result.message || "Pexels search failed.");
      return;
    }
    state.pexelsResults = result.videos || [];
    const remaining = (result.providers || [])
      .map((item) => item.rateLimit?.remaining ? `${item.provider}: ${item.rateLimit.remaining}` : "")
      .filter(Boolean)
      .join(" | ");
    setStatus("#pexelsStatus", `${result.message}${remaining ? ` Remaining API calls: ${remaining}.` : ""}`);
    renderPexelsResults();
  } catch (error) {
    setStatus("#pexelsStatus", `Stock video search failed: ${error.message || "backend unavailable"}`);
  }
}

async function downloadPexelsVideo(videoId, provider = "") {
  const video = state.pexelsResults.find((item) => String(item.id) === String(videoId) && (!provider || String(item.provider || "pexels") === String(provider)));
  if (!video) return;
  const providerLabel = video.providerLabel || (video.provider === "pixabay" ? "Pixabay" : "Pexels");
  setStatus("#pexelsStatus", `Downloading ${video.title || `${providerLabel} video`}...`);
  try {
    const result = await postBackend("/api/visual-sources/videos/download", { profileId: state.activeProfileId, video });
    if (!result.ok) {
      setStatus("#pexelsStatus", result.message || `Could not download ${providerLabel} video.`);
      return;
    }
    setStatus("#pexelsStatus", `${result.message}. It is now available for atmosphere Shorts.`);
    await loadPexelsReadiness();
  } catch (error) {
    setStatus("#pexelsStatus", `Download failed: ${error.message || "backend unavailable"}`);
  }
}

async function clearPexelsApprovedLibrary() {
  const confirmed = confirm("Clear all approved stock clips and source records? Your album theme CSV will be kept. The next batch will search/download fresh clips.");
  if (!confirmed) return;
  setStatus("#pexelsStatus", "Clearing approved stock clips...");
  try {
    const result = await postBackend("/api/visual-sources/pexels/clear-approved", { profileId: state.activeProfileId });
    if (!result.ok) {
      setStatus("#pexelsStatus", result.message || "Could not clear approved Pexels clips.");
      return;
    }
    state.pexelsResults = [];
    setStatus("#pexelsStatus", result.message || "Approved stock video library cleared.");
    await loadPexelsReadiness();
  } catch (error) {
    setStatus("#pexelsStatus", `Could not clear approved clips: ${error.message || "backend unavailable"}`);
  }
}

function isYouTubeShortUploaded(item) {
  return Boolean(item.youtubeShortVideoId || item.youtubeShortUrl || item.youtubeShortUploadedAt);
}

function isMetaPublished(item) {
  const instagramDone = item.status === "posted" || item.publishStatus === "published" || item.instagramMediaId;
  const facebookDone = item.facebookPublishStatus === "published" || item.facebookMediaId;
  return Boolean(instagramDone && facebookDone);
}

function youtubeCandidateTime(item, fallbackIndex = 0) {
  const raw = item.youtubeShortUploadedAt || item.approvedAt || item.renderedAt || item.createdAt || item.scheduledFor || item.publishedAt || "";
  const time = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(time) ? time : fallbackIndex;
}

function youtubeShortSourceLabel(candidate) {
  const tags = [];
  if (candidate.item.status === "approved") tags.push("approved");
  if (candidate.source === "reviews") tags.push("review");
  if (candidate.source === "publishingQueue") tags.push("queue");
  if (candidate.source === "postingPlan") tags.push("plan");
  if (candidate.youtubeUploaded) tags.push("YouTube uploaded");
  if (candidate.metaPublished) tags.push("Meta posted");
  const suffix = tags.length ? ` (${tags.join(", ")})` : "";
  return `${candidate.item.title || "Untitled Short"} - ${candidate.item.album || "Unknown album"}${suffix}`;
}

function getYouTubeShortSourceCandidates() {
  const stores = [
    ["reviews", state.reviews || []],
    ["publishingQueue", state.publishingQueue || []],
    ["postingPlan", state.postingPlan || []]
  ];
  const seen = new Set();
  const candidates = [];

  stores.forEach(([source, items]) => {
    items.forEach((item, index) => {
      if (!item?.video || !/\.mp4$/i.test(item.video)) return;
      const key = stableRenderedItemId(item);
      if (seen.has(key)) return;
      seen.add(key);

      const youtubeUploaded = isYouTubeShortUploaded(item);
      const metaPublished = isMetaPublished(item);
      const approved = item.status === "approved";
      const score = [
        youtubeUploaded ? 1 : 0,
        metaPublished ? 1 : 0,
        approved ? 0 : 1,
        source === "reviews" ? 0 : source === "publishingQueue" ? 1 : 2,
        -youtubeCandidateTime(item, index)
      ];

      candidates.push({
        key,
        source,
        item,
        approved,
        youtubeUploaded,
        metaPublished,
        score
      });
    });
  });

  return candidates.sort((a, b) => {
    for (let index = 0; index < a.score.length; index += 1) {
      if (a.score[index] !== b.score[index]) return a.score[index] - b.score[index];
    }
    return youtubeShortSourceLabel(a).localeCompare(youtubeShortSourceLabel(b));
  });
}

function renderYouTubeShortSourceSelector() {
  const select = $("#youtubeShortSource");
  if (!select) return;

  const previous = select.value;
  const candidates = getYouTubeShortSourceCandidates();
  if (!candidates.length) {
    select.innerHTML = `<option value="">No approved local Shorts found yet</option>`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  select.innerHTML = candidates.map((candidate, index) => `
    <option value="${escapeHtml(candidate.key)}">${index === 0 ? "Recommended: " : ""}${escapeHtml(youtubeShortSourceLabel(candidate))}</option>
  `).join("");

  if (previous && candidates.some((candidate) => candidate.key === previous)) {
    select.value = previous;
  }
}

function findYouTubeUploadTestItem() {
  const candidates = getYouTubeShortSourceCandidates();
  if (!candidates.length) return null;

  const selected = $("#youtubeShortSource")?.value || "";
  const chosen = selected
    ? candidates.find((candidate) => candidate.key === selected)
    : candidates[0];
  return (chosen || candidates[0]).item;
}

function markYouTubeShortUploaded(sourceItem, result) {
  const stores = [state.reviews, state.publishingQueue, state.postingPlan];
  stores.forEach((items) => {
    (items || []).forEach((item) => {
      const sameId = sourceItem.id && item.id === sourceItem.id;
      const sameVideo = sourceItem.video && item.video === sourceItem.video;
      const sourceHasVariant = hasRenderedVariantIdentity(sourceItem);
      const itemHasVariant = hasRenderedVariantIdentity(item);
      const sameIsrc = !sourceHasVariant && !itemHasVariant && sourceItem.isrc && item.isrc === sourceItem.isrc;
      if (!sameId && !sameIsrc && !sameVideo) return;
      item.youtubeShortVideoId = result.videoId || result.id || item.youtubeShortVideoId || "";
      item.youtubeShortUrl = result.url || item.youtubeShortUrl || "";
      item.youtubeShortUploadedAt = new Date().toISOString();
    });
  });
  save();
  syncPostingPlanToBackend();
  renderYouTubeSetup();
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
  return [...new Set([...campaignTags, "coffee jazz", "jazz shorts", "instrumental jazz", "shorts"])]
    .slice(0, 20);
}

function youtubeShortDescription(item = {}) {
  const keywords = item.keywords || item.Keywords || "";
  const parts = [
    item.caption || "A short instrumental jazz moment for a quieter part of the day.",
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

async function uploadYouTubeTestShort() {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#youtubeSetupStatus", "YouTube upload tests are not connected for this profile yet. Add profile-specific YouTube credentials next.");
    return;
  }
  const setup = getYouTubeSetup();
  const item = findYouTubeUploadTestItem();
  if (!item) {
    setStatus("#youtubeSetupStatus", "No local MP4 found yet. Generate a review batch first, then try the YouTube upload test.");
    return;
  }
  const privacy = setup.defaultPrivacy || "private";
  const confirmed = confirm(`Upload "${item.title || "test Short"}" to YouTube as ${privacy}? This is a real YouTube upload.`);
  if (!confirmed) return;

  setStatus("#youtubeSetupStatus", "Uploading test Short to YouTube...");
  try {
    const result = await postBackend("/api/youtube/upload-test", {
      confirmUpload: true,
      videoPath: item.video,
      title: youtubeShortTitle(item),
      description: youtubeShortDescription(item),
      privacy,
      madeForKids: setup.madeForKids,
      tags: youtubeShortTags(item)
    });
    if (result.ok) {
      setStatus("#youtubeSetupStatus", `${result.message}${result.url ? ` ${result.url}` : ""}`);
      markYouTubeShortUploaded(item, result);
      await loadYouTubeHealth();
    } else {
      setStatus("#youtubeSetupStatus", result.message || "YouTube upload test failed.");
    }
  } catch (error) {
    setStatus("#youtubeSetupStatus", `YouTube upload test failed: ${error.message || "Check OAuth credentials and backend status."}`);
  }
}

function loadPostingSettings() {
  const defaults = {
    publishMode: "approval",
    requirePreview: true,
    skipFallbackAudio: true,
    igAccount: currentProfile()?.handle || "@majascoffeejazzzone",
    defaultPostType: "reel",
    publishOriginalAudio: true,
    captionStyle: "calm",
    hashtagSet: "#coffeejazz #jazzreels #backgroundjazz #coffeeshopmusic #instrumentaljazz",
    postingTimezone: "Europe/London",
    postingWindow: "start",
    maxPostsPerDay: 1,
    shortsPerDay: 3,
    shortScheduleTimes: ["06:00", "11:00", "14:00"],
    mixReels: 100,
    mixStories: 0,
    mixFeed: 0,
    postingCooldown: 90,
    renderBatchSize: 7,
    renderPreset: "optimized",
    renderMinSeconds: 20,
    renderMaxSeconds: 30,
    renderFadeSeconds: 4
  };
  const settings = { ...defaults, ...(state.posting || {}) };
  settings.maxPostsPerDay = 1;
  if (state.posting?.renderPreset === "balanced" && !state.posting.optimizedPresetMigrationComplete) {
    settings.renderPreset = "optimized";
    state.posting = {
      ...state.posting,
      renderPreset: "optimized",
      optimizedPresetMigrationComplete: true
    };
    profileStorageSet("jazzPostingSettings", state.posting);
  }
  Object.entries(settings).forEach(([key, value]) => {
    const field = $(`#${key}`);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });
  renderPostingCommand();
}

function renderPostingCommand() {
  // Legacy command previews were removed from the GUI; publishing now runs through buttons.
}

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 1000);
}

function songFactoryPresetDetails(preset) {
  const presets = {
    "coffee-jazz": {
      style: "smooth coffee jazz",
      instruments: "soft piano, upright bass, brushed drums, muted guitar",
      scenes: ["rainy coffee shop", "quiet espresso bar", "window table", "late cafe glow"],
      moods: ["warm", "unhurried", "friendly", "low-lit"]
    },
    "lofi-coffee": {
      style: "lo-fi coffee jazz",
      instruments: "dusty electric piano, soft bass, vinyl drums, tape texture",
      scenes: ["study desk", "night bedroom studio", "steaming mug", "rain on glass"],
      moods: ["nostalgic", "soft focus", "dreamy", "cosy"]
    },
    "piano-trio": {
      style: "piano trio jazz",
      instruments: "grand piano, upright bass, brushed drums",
      scenes: ["grand piano at night", "hotel lounge", "small jazz room", "candlelit stage"],
      moods: ["classic", "elegant", "intimate", "after-hours"]
    },
    "bossa-cafe": {
      style: "bossa cafe jazz",
      instruments: "nylon guitar, soft percussion, warm bass, light piano",
      scenes: ["sunlit cafe", "terrace table", "gentle morning", "coastal coffee shop"],
      moods: ["breezy", "sunlit", "romantic", "easygoing"]
    },
    "noir-sax": {
      style: "noir sax lounge jazz",
      instruments: "tenor sax, smoky piano, upright bass, slow brushed drums",
      scenes: ["night street", "blue lounge", "rainy neon", "empty bar"],
      moods: ["moody", "cinematic", "shadowed", "late-night"]
    },
    "guitar-sunset": {
      style: "warm guitar jazz",
      instruments: "clean jazz guitar, upright bass, soft drums, subtle piano",
      scenes: ["golden-hour cafe", "balcony sunset", "quiet street", "warm wooden room"],
      moods: ["gentle", "golden", "reflective", "calm"]
    },
    "hammond-lounge": {
      style: "hammond organ lounge jazz",
      instruments: "hammond organ, jazz guitar, walking bass, brushed drums",
      scenes: ["vintage lounge", "walnut bar", "small club", "retro coffee house"],
      moods: ["groovy", "vintage", "smooth", "playful"]
    },
    "marimba-world": {
      style: "marimba world jazz",
      instruments: "marimba, soft percussion, upright bass, airy piano",
      scenes: ["open-air cafe", "morning market", "botanical courtyard", "sunlit table"],
      moods: ["bright", "organic", "light", "curious"]
    },
    majawick: {
      style: "cinematic instrumental music",
      instruments: "piano, synth texture, guitar, bass, atmospheric percussion",
      scenes: ["wide cinematic skyline", "night drive", "studio lights", "emotional close-up"],
      moods: ["emotive", "modern", "dynamic", "atmospheric"]
    }
  };
  return presets[preset] || presets["coffee-jazz"];
}

function pickRandom(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function cleanFactorySlug(value) {
  return String(value || "song-plan")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "song-plan";
}

function songFactoryTitleBank(preset) {
  const general = [
    "Moonlit Pour", "A Table Near The Window", "Blue Cup Morning", "Lanterns In The Rain",
    "Coffee Before Sunrise", "Silver Spoon Swing", "Quiet Cup Theory", "Window Seat Weather",
    "Steam On The Glass", "Notes Between Orders", "The Room Softens", "Late Table Glow"
  ];
  const byPreset = {
    "piano-trio": ["Keys After Midnight", "Brushed In Blue", "Piano At Table Four", "The Gentle Walkdown", "Pedals In The Half Light"],
    "noir-sax": ["Neon On The Pavement", "Smoke In B Flat", "The Alley Has A Melody", "Raincoat Ballad", "Blue Hour Footsteps"],
    "bossa-cafe": ["Terrace Breeze", "Sugar On The Rim", "Bossa For Two", "Sunlight Over Cups", "Postcard From The Terrace"],
    "hammond-lounge": ["Walnut Groove", "Lounge Light", "Sunday Drawbars", "Chrome Coffee Break", "Drawbars After Dark"],
    "marimba-world": ["Marimba Morning", "Courtyard Rhythm", "Wooden Sunlight", "Market Breeze", "Mallets Under Canopy"],
    majawick: ["Signal Through The City", "Glass Horizon", "A Different Weather", "Glowline", "Afterimage Avenue"]
  };
  return [...general, ...(byPreset[preset] || [])];
}

function songFactoryTitleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\b(?:chapter|part|pt)\s*\d+\b/g, "")
    .replace(/\s+\d+$/g, "")
    .replace(/^(?:the|a|an)\s+/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function songFactoryExistingTitleKeys(reference = null) {
  const values = [
    ...state.tracks.map((track) => track.title || track.Title),
    ...songFactoryAlbumsFromLibrary().flatMap((album) => album.titles || []),
    ...(reference?.titles || []),
    ...songFactoryPlanHistoryItems().flatMap((plan) => plan.tracks?.map((track) => track.title) || [])
  ];
  return new Set(values.map(songFactoryTitleKey).filter(Boolean));
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function songFactoryCueWords(...values) {
  const stop = new Set(["jazz", "coffee", "cafe", "music", "instrumental", "smooth", "soft", "warm", "style", "theme", "mood"]);
  return songFactoryUniqueList(values)
    .flatMap((value) => String(value || "").split(/[,|/;:\-]+|\band\b/i))
    .map((value) => value.replace(/[^a-zA-Z0-9\s']/g, " ").replace(/\s+/g, " ").trim())
    .filter((value) => value && value.length > 2)
    .map((value) => value.split(/\s+/).filter((word) => !stop.has(word.toLowerCase())).join(" ").trim())
    .filter(Boolean)
    .map(titleCaseWords)
    .slice(0, 20);
}

function songFactoryFreshTitle(settings, details, reference, index, usedTitleKeys, preferredTitle = "") {
  const existingTitleKeys = songFactoryExistingTitleKeys(reference);
  const cueWords = songFactoryCueWords(
    settings.albumTitle,
    settings.mood,
    settings.instruments,
    reference?.album,
    reference?.moods,
    reference?.themes,
    reference?.styles,
    reference?.scenes,
    reference?.searchTerms
  );
  const descriptors = songFactoryUniqueList(
    details.moods,
    cueWords,
    ["midnight", "window-lit", "velvet", "hidden", "after-hours", "rain-washed", "golden", "quiet", "blue", "silver", "low-lit"]
  ).map(titleCaseWords);
  const places = songFactoryUniqueList(
    details.scenes,
    reference?.scenes,
    ["window table", "side street", "corner booth", "hotel lounge", "small room", "terrace", "night kitchen", "listening room"]
  ).map(titleCaseWords);
  const nouns = songFactoryUniqueList(
    ["Glow", "Reverie", "Conversation", "Footsteps", "Weather", "Afterlight", "Drift", "Lantern", "Reflection", "Pulse", "Letters", "Signal", "Stillness", "Ritual", "Postcard", "Current"],
    /hammond|organ|drawbar/i.test(settings.instruments) ? ["Drawbars", "Leslie Glow", "Walnut Circuit", "Rotary Blue"] : [],
    /marimba|mallet|wood/i.test(settings.instruments) ? ["Mallets", "Woodgrain", "Courtyard Bells", "Canopy Rhythm"] : [],
    /piano|keys/i.test(settings.instruments) ? ["Keys", "Pedals", "Ivory Rain", "Left Hand Moon"] : [],
    /guitar|string/i.test(settings.instruments) ? ["Strings", "Fretlight", "Six String Sunset", "Golden Chords"] : [],
    /sax/i.test(settings.instruments) ? ["Blue Reed", "Saxophone Weather", "Brass Smoke", "Neon Breath"] : []
  ).map(titleCaseWords);
  const bank = songFactoryTitleBank(settings.preset);
  const candidates = [
    preferredTitle,
    ...bank,
    ...Array.from({ length: 80 }, (_, itemIndex) => {
      const descriptor = descriptors[(index + itemIndex) % descriptors.length] || "Quiet";
      const noun = nouns[(index * 3 + itemIndex) % nouns.length] || "Reverie";
      const place = places[(index * 5 + itemIndex) % places.length] || "Window Table";
      const template = itemIndex % 6;
      if (template === 0) return `${descriptor} ${noun}`;
      if (template === 1) return `${noun} At The ${place}`;
      if (template === 2) return `${place} ${noun}`;
      if (template === 3) return `${descriptor} Notes For ${place}`;
      if (template === 4) return `${noun} Between ${descriptor} Hours`;
      return `${descriptor} ${place}`;
    })
  ].map(cleanBriefTitle).filter(Boolean);
  for (const candidate of candidates) {
    const key = songFactoryTitleKey(candidate);
    if (!key || usedTitleKeys.has(key) || existingTitleKeys.has(key)) continue;
    return candidate;
  }
  return `Unwritten ${titleCaseWords(pickRandom(nouns) || "Reverie")} ${Date.now().toString().slice(-4)}`;
}

function songFactoryAlbumsFromLibrary() {
  if (state.songFactoryAlbumsProfileId === state.activeProfileId && state.songFactoryAlbums.length) {
    return state.songFactoryAlbums;
  }
  const albums = new Map();
  state.tracks.forEach((track) => {
    const album = String(track.album || track.Album || "").trim();
    if (!album) return;
    const entry = albums.get(album) || {
      album,
      count: 0,
      titles: [],
      moods: new Set(),
      instruments: new Set()
    };
    entry.count += 1;
    const title = String(track.title || track.Title || "").trim();
    if (title) entry.titles.push(title);
    const mood = String(track.mood || track.Mood || "").trim();
    if (mood) entry.moods.add(mood);
    const instrument = String(track.Instruments || track.instruments || track.albumThemeInstruments || "").trim();
    if (instrument) entry.instruments.add(instrument);
    albums.set(album, entry);
  });
  return [...albums.values()].sort((a, b) => a.album.localeCompare(b.album));
}

function songFactoryListValues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value instanceof Set) return [...value].filter(Boolean);
  return [String(value)].filter(Boolean);
}

function songFactoryUniqueList(...values) {
  const seen = new Set();
  const output = [];
  values.flatMap(songFactoryListValues).forEach((value) => {
    const text = String(value || "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    output.push(text);
  });
  return output;
}

async function loadSongFactoryAlbums(force = false) {
  if (state.songFactoryAlbumsLoading) return;
  if (!force && state.songFactoryAlbumsProfileId === state.activeProfileId && state.songFactoryAlbums.length) return;
  state.songFactoryAlbumsLoading = true;
  renderSongFactoryAlbumSelect();
  try {
    const response = await fetch(`${backendUrl}/api/catalog/albums?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const result = await response.json();
    state.songFactoryAlbums = Array.isArray(result.albums) ? result.albums : [];
    state.songFactoryAlbumsProfileId = state.activeProfileId;
    if (!state.songFactoryAlbums.length && result.catalogPath) {
      setStatus("#songFactoryStatus", `No albums found in catalogue: ${result.catalogPath}`);
    }
  } catch {
    state.songFactoryAlbums = [];
    state.songFactoryAlbumsProfileId = state.activeProfileId;
    setStatus("#songFactoryStatus", "Could not load source albums. Start the backend, then reopen Song Factory.");
  } finally {
    state.songFactoryAlbumsLoading = false;
    renderSongFactoryAlbumSelect();
  }
}

function songFactorySelectedAlbumReference() {
  const selected = $("#songFactoryBaseAlbum")?.value || "";
  if (!selected) return null;
  return songFactoryAlbumsFromLibrary().find((item) => item.album === selected) || null;
}

function buildSongFactoryAlbumBrief(reference) {
  if (!reference) return "";
  const moods = songFactoryUniqueList(reference.moods).slice(0, 4);
  const themes = songFactoryUniqueList(reference.themes).slice(0, 3);
  const styles = songFactoryUniqueList(reference.styles).slice(0, 3);
  const scenes = songFactoryUniqueList(reference.scenes).slice(0, 3);
  const instruments = songFactoryUniqueList(reference.instruments).slice(0, 8);
  const searchTerms = songFactoryUniqueList(reference.searchTerms).slice(0, 8);
  const examples = songFactoryUniqueList(reference.titles).slice(0, 6);
  const lines = [
    `Reference: ${reference.album}`,
    moods.length ? `Mood: ${moods.join(", ")}` : "",
    themes.length ? `Theme: ${themes.join(", ")}` : "",
    styles.length ? `Style: ${styles.join(", ")}` : "",
    instruments.length ? `Instruments: ${instruments.join(", ")}` : "",
    scenes.length ? `Visual / atmosphere cues: ${scenes.join(", ")}` : "",
    searchTerms.length ? `Extra search cues: ${searchTerms.join(", ")}` : "",
    examples.length ? `Existing catalogue examples to learn from: ${examples.join(", ")}` : "",
    "Creative direction: Make a new instrumental set inspired by this lane, with a fresh album title, fresh track titles, melodies, and artwork ideas."
  ].filter(Boolean);
  return lines.join("\n");
}

function stripSongFactoryGeneratedBrief(value = "") {
  return String(value || "")
    .replace(/(?:^|\n)--- Source inspiration ---[\s\S]*?(?=\n--- Your extra notes ---\n|$)/, "")
    .replace(/\n--- Your extra notes ---\n/, "\n")
    .trim();
}

function applySongFactoryAlbumBrief(reference) {
  const textarea = $("#songFactoryBrief");
  if (!textarea || !reference) return;
  const generated = buildSongFactoryAlbumBrief(reference);
  const userNotes = stripSongFactoryGeneratedBrief(textarea.value);
  textarea.value = [
    "--- Source inspiration ---",
    generated,
    userNotes ? "--- Your extra notes ---" : "",
    userNotes
  ].filter(Boolean).join("\n");
  const moods = songFactoryUniqueList(reference.moods, reference.themes, reference.styles, reference.instruments);
  const mood = $("#songFactoryMood");
  if (mood) mood.value = moods.length ? moods.slice(0, 8).join(", ") : mood.value || "warm, relaxed, cinematic";
  const titleInput = $("#songFactoryAlbumTitle");
  if (titleInput && !titleInput.value.trim()) {
    const profile = currentProfile();
    const preset = inferSongFactoryPreset(`${reference.album} ${moods.join(" ")}`);
    titleInput.value = songFactoryCreativeAlbumTitle(reference, songFactoryPresetDetails(preset), profile);
  }
}

function inferSongFactoryPreset(text = "") {
  const value = String(text || "").toLowerCase();
  if (/marimba|wooden|mallet|mahogany|world/.test(value)) return "marimba-world";
  if (/bossa|rio|brazil|samba|manha|manh/.test(value)) return "bossa-cafe";
  if (/hammond|organ|drawbar|lounge/.test(value)) return "hammond-lounge";
  if (/sax|noir|neon|rainy|smoky|smoke/.test(value)) return "noir-sax";
  if (/guitar|strings|sunset|six strings/.test(value)) return "guitar-sunset";
  if (/piano|keys|trio|grand/.test(value)) return "piano-trio";
  if (/lofi|lo-fi|tape|vinyl|study/.test(value)) return "lofi-coffee";
  if (/cinematic|majawick|soundtrack|ambient/.test(value)) return "majawick";
  return "coffee-jazz";
}

function parseSongFactoryBrief(brief = "", count = 10) {
  const text = String(brief || "").trim();
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let albumTitle = "";
  const albumPatterns = [
    /(?:album|project|release)\s+(?:called|titled|named)\s+["“]?([^"”\n.]+)/i,
    /(?:album|project|release)\s*:\s*["“]?([^"”\n]+)/i,
    /(?:called|titled|named)\s+["“]?([^"”\n.]+)/i
  ];
  for (const pattern of albumPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      albumTitle = cleanBriefTitle(match[1]);
      break;
    }
  }
  if (!albumTitle) {
    const firstLine = lines.find((line) => /album|project|release/i.test(line));
    if (firstLine) albumTitle = cleanBriefTitle(firstLine.replace(/^(album|project|release)\s*:?\s*/i, ""));
  }

  const trackNames = [];
  const inlineTrackMatch = text.match(/(?:track names|tracks|song titles|songs)\s*:\s*([\s\S]+)/i);
  if (inlineTrackMatch?.[1]) {
    inlineTrackMatch[1]
      .split(/\r?\n|,|;|\|/)
      .map(cleanBriefTitle)
      .filter((item) => item && !/^(mood|energy|length|style|instruments)\b/i.test(item))
      .forEach((item) => trackNames.push(item));
  }
  lines.forEach((line) => {
    const numbered = line.match(/^(?:track\s*)?\d+[\).\-\s]+(.+)$/i);
    if (numbered?.[1]) trackNames.push(cleanBriefTitle(numbered[1]));
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet?.[1] && !/album|mood|energy|length|style/i.test(bullet[1])) trackNames.push(cleanBriefTitle(bullet[1]));
  });

  return {
    albumTitle,
    trackNames: [...new Set(trackNames)].slice(0, Math.max(1, count))
  };
}

function cleanBriefTitle(value) {
  return String(value || "")
    .replace(/^[:"'“”]+|[:"'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.]+$/g, "")
    .slice(0, 90);
}

function sourceAlbumInstruments(reference, details) {
  const explicit = reference ? songFactoryListValues(reference.instruments).filter(Boolean).join(", ") : "";
  if (explicit) return explicit;
  const album = String(reference?.album || "").toLowerCase();
  if (/marimba|wooden/.test(album)) return "marimba, warm mallets, soft percussion, upright bass, airy piano";
  if (/bossa|manha|manh|rio|samba/.test(album)) return "nylon guitar, bossa percussion, upright bass, light piano";
  if (/hammond|lounge/.test(album)) return "hammond organ, jazz guitar, walking bass, brushed drums";
  if (/guitar|string/.test(album)) return "clean jazz guitar, upright bass, soft drums, subtle piano";
  if (/piano|keys/.test(album)) return "grand piano, upright bass, brushed drums";
  return details.instruments;
}

function sourceAlbumScene(reference, details) {
  if (!reference?.album) return pickRandom(details.scenes);
  const referenceScenes = songFactoryListValues(reference.scenes);
  if (referenceScenes.length) return pickRandom(referenceScenes);
  const text = `${reference.album} ${songFactoryListValues(reference.titles).slice(0, 8).join(" ")}`.toLowerCase();
  if (/marimba|wooden|mahogany/.test(text)) return "sunlit wooden cafe with organic percussion warmth";
  if (/bossa|rio|samba|manha|manh/.test(text)) return "bright Brazilian morning cafe";
  if (/hammond|lounge/.test(text)) return "vintage coffee lounge with walnut tones";
  if (/noir|night|city|rain/.test(text)) return "rainy night cafe window";
  if (/guitar|string|sunset/.test(text)) return "golden-hour guitar room";
  if (/zen|sacred|lotus/.test(text)) return "minimal zen coffee ritual";
  return pickRandom(details.scenes);
}

function songFactoryCreativeAlbumTitle(reference, details, profile) {
  const sourceAlbum = String(reference?.album || "").trim();
  const cueText = songFactoryUniqueList(
    sourceAlbum,
    reference?.moods,
    reference?.themes,
    reference?.styles,
    reference?.scenes,
    reference?.instruments,
    reference?.searchTerms,
    details.style,
    details.moods
  ).join(" ").toLowerCase();
  const pool = [
    "Blue Cups at Daybreak",
    "Rainlight Over Porcelain",
    "Small Hours At The Counter",
    "Lanterns Over Coffee",
    "Quiet Rooms, Warm Notes",
    "The Window Keeps The Rhythm"
  ];

  if (/marimba|wooden|mallet|mahogany|courtyard|organic/.test(cueText)) {
    pool.push("Woodgrain Mornings", "Courtyard Mallets", "Mahogany Light", "The Wooden Cup Sessions", "Sunlit Resonance");
  }
  if (/bossa|rio|brazil|samba|latin|terrace/.test(cueText)) {
    pool.push("Terrace Bossa", "Cups in the Morning Sun", "Rio Steam", "Bossa Over Breakfast", "Sugar Rim Afternoons");
  }
  if (/hammond|organ|drawbar|lounge|walnut|retro/.test(cueText)) {
    pool.push("Drawbars and Espresso", "Walnut Lounge", "Sunday Organ Roast", "The Velvet Drawbar Room", "Low Light Lounge");
  }
  if (/piano|keys|trio|grand|brush/.test(cueText)) {
    pool.push("Keys Near Midnight", "Grand Piano, Small Table", "Brushed Blue Hours", "The Window Seat Trio", "Afterglow at the Keys");
  }
  if (/sax|noir|night|rain|neon|smoke|city/.test(cueText)) {
    pool.push("Neon in the Coffee Steam", "Rain on the Night Window", "Blue Hour Noir", "City Lights, Soft Notes", "The Late Cab Sessions");
  }
  if (/guitar|string|sunset|golden/.test(cueText)) {
    pool.push("Six Strings at Sunset", "Golden Cup Guitar", "Balcony Strings", "Warm Fretboard Evenings", "The Sunset Table");
  }
  if (/lofi|lo-fi|study|tape|vinyl/.test(cueText)) {
    pool.push("Tape Hiss and Coffee Cups", "Study Room Glow", "Lo-Fi Latte Notes", "Soft Static Cafe", "Late Desk Sketches");
  }

  if (!sourceAlbum && profile?.name) {
    pool.push(`${profile.name} Sketchbook`, `${profile.name} Afterglow`, `${profile.name} New Sessions`);
  }

  const existingAlbumKeys = new Set([
    ...songFactoryAlbumsFromLibrary().map((album) => cleanFactorySlug(album.album)),
    ...songFactoryPlanHistoryItems().map((plan) => cleanFactorySlug(plan.settings?.albumTitle))
  ].filter(Boolean));
  const sourceKey = cleanFactorySlug(sourceAlbum);
  const candidates = songFactoryUniqueList(pool)
    .filter((title) => cleanFactorySlug(title) !== sourceKey)
    .filter((title) => !existingAlbumKeys.has(cleanFactorySlug(title)))
    .filter((title) => !/\b(?:ii|2|pt\.?\s*2|part\s*2)\b/i.test(title));
  return pickRandom(candidates.length ? candidates : pool);
}

function songFactoryMoodCuePool(settings, details, reference) {
  return songFactoryUniqueList(
    String(settings.mood || "").split(","),
    reference?.moods,
    reference?.themes,
    reference?.styles,
    reference?.instruments,
    details.moods
  );
}

function buildSongFactoryAlbumPrompt(settings, details, reference) {
  const referenceText = reference?.album
    ? `Inspired by the catalogue lane of "${reference.album}", but with fresh titles, melodies and arrangements.`
    : "Build a fresh original release with a clear identity across every track.";
  const sceneCues = songFactoryUniqueList(reference?.scenes, details.scenes).slice(0, 4).join(", ");
  const moodCues = songFactoryUniqueList(settings.mood, reference?.moods, reference?.themes, details.moods).slice(0, 8).join(", ");
  const userBrief = stripSongFactoryGeneratedBrief(settings.brief || "");
  return [
    `Create a cohesive ${settings.count}-track album called "${settings.albumTitle}" by ${settings.artist}.`,
    referenceText,
    `Overall sound: ${details.style}; ${settings.instrumental ? "instrumental only, no vocals, no lyrics" : "mostly instrumental"}.`,
    `Mood and atmosphere: ${moodCues}.`,
    `Core instruments: ${settings.instruments || details.instruments}.`,
    `Energy: ${settings.energy}; target track length: ${settings.length}.`,
    sceneCues ? `Visual / emotional world: ${sceneCues}.` : "",
    userBrief ? `Extra creative brief: ${userBrief}.` : "",
    "Keep the tracks varied but recognisably from the same album. Warm mix, natural dynamics, no harsh drops, no copyrighted melodies, no artist imitation."
  ].filter(Boolean).join(" ");
}

function buildSongFactoryTrackPrompt(track, settings, details) {
  const instrumental = settings.instrumental ? "instrumental only, no vocals, no lyrics" : "mostly instrumental, minimal wordless vocal texture if needed";
  const energyMap = {
    low: "slow tempo, gentle dynamics, calm background music",
    medium: "medium-slow tempo, warm groove, relaxed but present",
    high: "brighter groove, lively rhythm section, still smooth and cafe-friendly"
  };
  return [
    `${instrumental}`,
    `${details.style} for ${track.scene}`,
    `mood: ${track.mood}, ${settings.mood}`,
    `instruments: ${settings.instruments || details.instruments}`,
    energyMap[settings.energy] || energyMap.medium,
    `target length ${settings.length}`,
    "clean mix, warm room sound, no harsh drops, no copyrighted melodies, no artist imitation"
  ].join(". ");
}

function buildSongFactoryPrompt(track, settings, details, albumPrompt = "") {
  const trackPrompt = track.trackPrompt || buildSongFactoryTrackPrompt(track, settings, details);
  if (!albumPrompt) return trackPrompt;
  return [`Album prompt: ${albumPrompt}`, `Track prompt for "${track.title}": ${trackPrompt}`].join("\n\n");
}

function buildSongFactoryAlbumArtworkPrompt(settings, details, reference) {
  const referenceScenes = songFactoryUniqueList(reference?.scenes).slice(0, 3);
  const referenceThemes = songFactoryUniqueList(reference?.themes).slice(0, 3);
  const referenceSearch = songFactoryUniqueList(reference?.searchTerms).slice(0, 5);
  const visualCues = songFactoryUniqueList(
    referenceScenes,
    referenceThemes,
    referenceSearch,
    settings.mood,
    details.style
  ).slice(0, 10);
  return [
    `Create original square album artwork for "${settings.albumTitle}" by ${settings.artist}.`,
    `Include the artist name "maja's coffee jazz zone" and the album title "${settings.albumTitle}" somewhere on the cover as clean, readable typography.`,
    `${details.style}, ${settings.mood}, ${visualCues.join(", ")}.`,
    "Warm cinematic coffee-jazz atmosphere, premium independent music release, rich lighting, clean composition.",
    "No extra random text, no logos, no copyrighted characters, no artist imitation, no watermarks."
  ].join(" ");
}

function songFactoryPlanHistoryItems() {
  return Array.isArray(state.songFactoryPlanHistory) ? state.songFactoryPlanHistory.filter((plan) => plan?.tracks?.length) : [];
}

function rememberSongFactoryPlan(plan) {
  if (!plan?.tracks?.length) return;
  const existing = songFactoryPlanHistoryItems();
  const next = [
    plan,
    ...existing.filter((item) => item.id !== plan.id && item.settings?.albumTitle !== plan.settings?.albumTitle)
  ].slice(0, 5);
  state.songFactoryPlanHistory = next;
}

function songFactoryPlanRecallBrief(plan) {
  const settings = plan?.settings || {};
  if (settings.brief) return settings.brief;
  if (plan?.sourceReference) return buildSongFactoryAlbumBrief(plan.sourceReference);
  const moods = songFactoryUniqueList(settings.mood, plan?.tracks?.map((track) => track.mood)).slice(0, 8);
  const themes = songFactoryUniqueList(settings.style, settings.preset).slice(0, 4);
  const instruments = songFactoryUniqueList(settings.instruments, plan?.tracks?.map((track) => track.instruments)).slice(0, 8);
  const scenes = songFactoryUniqueList(plan?.tracks?.map((track) => track.scene)).slice(0, 6);
  const examples = songFactoryUniqueList(plan?.tracks?.map((track) => track.title)).slice(0, 8);
  return [
    settings.baseAlbum ? `Reference: ${settings.baseAlbum}` : `Reference: ${settings.albumTitle || "Saved Song Factory plan"}`,
    moods.length ? `Mood: ${moods.join(", ")}` : "",
    themes.length ? `Theme / style: ${themes.join(", ")}` : "",
    instruments.length ? `Instruments: ${instruments.join(", ")}` : "",
    scenes.length ? `Visual / atmosphere cues: ${scenes.join(", ")}` : "",
    examples.length ? `Track title direction: ${examples.join(", ")}` : "",
    plan?.albumPrompt ? `Album prompt: ${plan.albumPrompt}` : "",
    "Creative direction: Continue this album lane with matching mood, instrumentation, titles, metadata, and artwork."
  ].filter(Boolean).join("\n");
}

function restoreSongFactoryInputsFromPlan(plan) {
  if (!plan?.settings) return;
  const titleInput = $("#songFactoryAlbumTitle");
  if (titleInput) titleInput.value = plan.settings.albumTitle || "";
  const briefInput = $("#songFactoryBrief");
  if (briefInput) briefInput.value = songFactoryPlanRecallBrief(plan);
  const baseAlbumInput = $("#songFactoryBaseAlbum");
  if (baseAlbumInput) baseAlbumInput.value = plan.settings.baseAlbum || "";
  const moodInput = $("#songFactoryMood");
  if (moodInput) {
    const fallbackMood = songFactoryUniqueList(plan.tracks?.map((track) => track.mood), plan.settings.style).slice(0, 8).join(", ");
    moodInput.value = plan.settings.mood || fallbackMood || "";
  }
  const trackCountInput = $("#songFactoryTrackCount");
  if (trackCountInput) trackCountInput.value = plan.settings.count || plan.tracks?.length || 10;
  const energyInput = $("#songFactoryEnergy");
  if (energyInput) energyInput.value = plan.settings.energy || "medium";
  const lengthInput = $("#songFactoryLength");
  if (lengthInput) lengthInput.value = plan.settings.length || "2:30-3:30";
}

function songFactoryPlanMoodSummary(plan) {
  if (!plan?.settings) return "";
  return songFactoryUniqueList(
    plan.settings.mood,
    plan.tracks?.map((track) => track.mood),
    plan.settings.style,
    plan.settings.instruments
  ).slice(0, 10).join(", ");
}

function renderSongFactorySaveSummary() {
  const summary = $("#songFactorySaveSummary");
  if (!summary) return;
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    summary.innerHTML = `
      <div>
        <p class="eyebrow">Saving This Album</p>
        <h4>No active song plan</h4>
      </div>
      <p class="note">Generate or recall a plan to see the album title, mood and final album prompt before saving.</p>
    `;
    return;
  }
  const albumPrompt = plan.albumPrompt || buildSongFactoryAlbumPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), plan.sourceReference || null);
  const albumArtworkPrompt = plan.albumArtworkPrompt || buildSongFactoryAlbumArtworkPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), plan.sourceReference || null);
  const moodSummary = songFactoryPlanMoodSummary(plan) || "No mood set";
  summary.innerHTML = `
    <div class="song-factory-save-head">
      <div>
        <p class="eyebrow">Saving This Album</p>
        <h4>${escapeHtml(plan.settings.albumTitle || "Untitled album")}</h4>
      </div>
      <span>${escapeHtml(plan.tracks.length)} tracks</span>
    </div>
    <div class="song-factory-save-grid">
      <article>
        <span>Mood / atmosphere</span>
        <p>${escapeHtml(moodSummary)}</p>
      </article>
      <article>
        <span>Album prompt</span>
        <p>${escapeHtml(albumPrompt)}</p>
      </article>
      <article>
        <span>Artwork prompt</span>
        <p>${escapeHtml(albumArtworkPrompt)}</p>
      </article>
    </div>
  `;
}

function generateSongFactoryPlan() {
  const profile = currentProfile();
  const brief = $("#songFactoryBrief")?.value.trim() || "";
  const explicitAlbumTitle = $("#songFactoryAlbumTitle")?.value.trim() || "";
  const reference = songFactorySelectedAlbumReference();
  const count = Math.max(1, Math.min(24, Number($("#songFactoryTrackCount")?.value || 10)));
  const parsedBrief = parseSongFactoryBrief(brief, count);
  const preset = inferSongFactoryPreset(`${brief} ${reference?.album || ""} ${$("#songFactoryMood")?.value || ""}`);
  const details = songFactoryPresetDetails(preset);
  const albumTitle = cleanBriefTitle(explicitAlbumTitle) || parsedBrief.albumTitle || songFactoryCreativeAlbumTitle(reference, details, profile);
  const settings = {
    albumTitle,
    artist: profile?.name || "Maja's Coffee Jazz Zone",
    brief,
    baseAlbum: reference?.album || "",
    preset,
    style: details.style,
    count,
    mood: $("#songFactoryMood")?.value.trim() || details.moods.join(", "),
    instruments: sourceAlbumInstruments(reference, details),
    energy: $("#songFactoryEnergy")?.value || "medium",
    length: $("#songFactoryLength")?.value || "2:30-3:30",
    instrumental: true
  };
  const albumPrompt = buildSongFactoryAlbumPrompt(settings, details, reference);
  const albumArtworkPrompt = buildSongFactoryAlbumArtworkPrompt(settings, details, reference);
  const usedTitleKeys = new Set();
  const moodCuePool = songFactoryMoodCuePool(settings, details, reference);
  const tracks = Array.from({ length: settings.count }, (_, index) => {
    const title = songFactoryFreshTitle(settings, details, reference, index, usedTitleKeys, parsedBrief.trackNames[index] || "");
    usedTitleKeys.add(songFactoryTitleKey(title));
    const track = {
      id: `song-${Date.now()}-${index + 1}`,
      number: index + 1,
      title,
      album: settings.albumTitle,
      artist: settings.artist,
      style: details.style,
      mood: pickRandom(moodCuePool.length ? moodCuePool : details.moods),
      scene: sourceAlbumScene(reference, details),
      instruments: settings.instruments,
      energy: settings.energy,
      length: settings.length,
      status: "planned"
    };
    track.trackPrompt = buildSongFactoryTrackPrompt(track, settings, details);
    track.sunoPrompt = buildSongFactoryPrompt(track, settings, details, albumPrompt);
    track.negativePrompt = "no vocals, no lyrics, no harsh EDM drop, no distorted lead, no copyrighted melody, no artist imitation, no radio tag, no abrupt ending";
    track.hashtags = ["#coffeejazz", "#instrumentaljazz", "#jazzmusic", "#studymusic", "#relaxingmusic", "#cafemusic"].join(" ");
    return track;
  });
  state.songFactoryPlan = {
    id: `plan-${Date.now()}`,
    profileId: state.activeProfileId,
    createdAt: new Date().toISOString(),
    settings,
    sourceReference: reference ? JSON.parse(JSON.stringify(reference)) : null,
    albumPrompt,
    albumArtworkPrompt,
    tracks
  };
  rememberSongFactoryPlan(state.songFactoryPlan);
  const titleInput = $("#songFactoryAlbumTitle");
  if (titleInput) titleInput.value = settings.albumTitle || "";
  const moodInput = $("#songFactoryMood");
  if (moodInput) moodInput.value = settings.mood || "";
  save();
  renderSongFactory();
  setStatus("#songFactoryStatus", `Created ${tracks.length} Suno-ready track prompts for ${settings.albumTitle}.`);
}

function renderSongFactory() {
  if (!state.songFactoryAlbumsLoading && state.songFactoryAlbumsProfileId !== state.activeProfileId) {
    loadSongFactoryAlbums();
  }
  renderSongFactoryAlbumSelect();
  renderSongFactoryRecentPlans();
  const audioFolderInput = $("#songFactoryAudioFolder");
  if (audioFolderInput && !audioFolderInput.value.trim()) {
    audioFolderInput.value = defaultSongFactoryAudioFolder();
  }

  const plan = state.songFactoryPlan;
  const title = $("#songFactoryPlanTitle");
  const stats = $("#songFactoryStats");
  const list = $("#songFactoryList");
  if (!list) return;
  renderSongFactorySaveSummary();
  if (!plan?.tracks?.length) {
    if (title) title.textContent = "No active song plan";
    if (stats) stats.innerHTML = "";
    list.innerHTML = `<div class="empty-state">Generate an album plan to see the album name, album prompt, artwork prompt, and track titles here.</div>`;
    return;
  }
  if (title) title.textContent = `${plan.settings.albumTitle} - ${plan.tracks.length} tracks`;
  if (stats) {
    stats.innerHTML = `
      <span>${escapeHtml(plan.settings.style)}</span>
      ${plan.settings.baseAlbum ? `<span>Based on ${escapeHtml(plan.settings.baseAlbum)}</span>` : ""}
      <span>${escapeHtml(plan.settings.energy)} energy</span>
      <span>${escapeHtml(plan.settings.length)} target length</span>
    `;
  }
  const albumArtworkPrompt = plan.albumArtworkPrompt || buildSongFactoryAlbumArtworkPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), null);
  const albumPrompt = plan.albumPrompt || buildSongFactoryAlbumPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), null);
  list.innerHTML = `
    <article class="song-album-card">
      <div>
        <p class="eyebrow">Album Name</p>
        <h4>${escapeHtml(plan.settings.albumTitle || "Untitled album")}</h4>
      </div>
    </article>
    <article class="song-album-card">
      <div>
        <p class="eyebrow">Album Prompt</p>
        <h4>Use this as the shared Suno direction</h4>
      </div>
      <textarea readonly rows="6">${escapeHtml(albumPrompt)}</textarea>
      <div class="button-row tight">
        <button class="secondary copy-album-suno-prompt" type="button">Copy album prompt</button>
      </div>
    </article>
    <article class="song-album-card">
      <div>
        <p class="eyebrow">Album Artwork</p>
        <h4>One cover prompt for the whole album</h4>
      </div>
      <textarea readonly rows="4">${escapeHtml(albumArtworkPrompt)}</textarea>
      <div class="button-row tight">
        <button class="secondary copy-album-artwork-prompt" type="button">Copy artwork prompt</button>
      </div>
    </article>
    <article class="song-album-card">
      <div>
        <p class="eyebrow">Track Titles</p>
        <h4>${plan.tracks.length} planned tracks</h4>
      </div>
      <ol class="song-track-title-list">
        ${plan.tracks.map((track) => `<li>${escapeHtml(track.title || `Track ${track.number || ""}`)}</li>`).join("")}
      </ol>
    </article>`;
  list.querySelector(".copy-album-suno-prompt")?.addEventListener("click", () => {
    copySongFactoryText(albumPrompt, "Copied album prompt.");
  });
  list.querySelector(".copy-album-artwork-prompt")?.addEventListener("click", () => {
    copySongFactoryText(albumArtworkPrompt, "Copied album artwork prompt.");
  });
}

function renderSongFactoryRecentPlans() {
  const select = $("#songFactoryRecentPlans");
  if (!select) return;
  const plans = songFactoryPlanHistoryItems();
  if (!plans.length) {
    select.innerHTML = `<option value="">No recent plans yet</option>`;
    return;
  }
  const selected = select.value;
  select.innerHTML = [
    `<option value="">Recent song plans</option>`,
    ...plans.map((plan) => {
      const title = plan.settings?.albumTitle || "Untitled album";
      const date = plan.createdAt ? new Date(plan.createdAt).toLocaleDateString("en-GB") : "";
      const count = plan.tracks?.length || 0;
      return `<option value="${escapeHtml(plan.id)}">${escapeHtml(title)} (${count} tracks${date ? `, ${date}` : ""})</option>`;
    })
  ].join("");
  if (plans.some((plan) => plan.id === selected)) select.value = selected;
}

function renderSongFactoryAlbumSelect() {
  const select = $("#songFactoryBaseAlbum");
  if (!select) return;
  const selected = select.value || state.songFactoryPlan?.settings?.baseAlbum || "";
  const albums = songFactoryAlbumsFromLibrary();
  const placeholder = state.songFactoryAlbumsLoading
    ? "Loading source albums..."
    : albums.length
      ? "No source album selected"
      : "No catalogue albums found - run Setup scan";
  const hasSelectedAlbum = selected && albums.some((item) => item.album === selected);
  select.innerHTML = [
    `<option value="">${escapeHtml(placeholder)}</option>`,
    selected && !hasSelectedAlbum ? `<option value="${escapeHtml(selected)}">${escapeHtml(selected)} (saved source album)</option>` : "",
    ...albums.map((item) => `<option value="${escapeHtml(item.album)}">${escapeHtml(item.album)} (${item.count} tracks)</option>`)
  ].filter(Boolean).join("");
  if (selected && (hasSelectedAlbum || Array.from(select.options).some((option) => option.value === selected))) select.value = selected;
}

function recallSongFactoryPlan() {
  const id = $("#songFactoryRecentPlans")?.value || "";
  if (!id) {
    setStatus("#songFactoryStatus", "Choose a recent Song Factory plan to recall.");
    return;
  }
  const plan = songFactoryPlanHistoryItems().find((item) => item.id === id);
  if (!plan) {
    setStatus("#songFactoryStatus", "That recent plan is no longer available.");
    renderSongFactoryRecentPlans();
    return;
  }
  state.songFactoryPlan = plan;
  restoreSongFactoryInputsFromPlan(plan);
  rememberSongFactoryPlan(plan);
  save();
  renderSongFactory();
  setStatus("#songFactoryStatus", `Recalled ${plan.settings?.albumTitle || "Song Factory plan"}.`);
}

function downloadSongFactoryCurrentBundle() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate or recall a song plan before downloading prompts.");
    return;
  }
  copySongFactoryPrompts();
}

function songFactoryMetadataText(track) {
  return [
    `Title: ${track.title}`,
    `Album: ${track.album}`,
    `Artist: ${track.artist}`,
    `Style: ${track.style}`,
    `Mood: ${track.mood}`,
    `Instruments: ${track.instruments}`,
    "",
    track.hashtags
  ].join("\n");
}

async function copySongFactoryText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("#songFactoryStatus", successMessage);
  } catch {
    setStatus("#songFactoryStatus", "Clipboard blocked by the browser. Select the text manually and copy it.");
  }
}

function songFactoryCsvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportSongFactoryCsv() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate a song plan before exporting CSV.");
    return;
  }
  const headers = ["Album", "Album Prompt", "Track Number", "Title", "Artist", "Style", "Mood", "Instruments", "Energy", "Length Target", "Track Prompt", "Suno Prompt", "Negative Prompt", "Album Artwork Prompt", "Hashtags", "Status"];
  const albumPrompt = plan.albumPrompt || buildSongFactoryAlbumPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), null);
  const albumArtworkPrompt = plan.albumArtworkPrompt || buildSongFactoryAlbumArtworkPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), null);
  const rows = plan.tracks.map((track) => [
    track.album, albumPrompt, track.number, track.title, track.artist, track.style, track.mood, track.instruments, track.energy,
    track.length, track.trackPrompt || "", track.sunoPrompt, track.negativePrompt, albumArtworkPrompt, track.hashtags, track.status
  ]);
  const csv = [headers, ...rows].map((row) => row.map(songFactoryCsvCell).join(",")).join("\r\n");
  downloadText(`${cleanFactorySlug(plan.settings.albumTitle)}-suno-plan.csv`, csv, "text/csv");
  setStatus("#songFactoryStatus", "Exported Song Factory CSV.");
}

function exportSongFactoryJson() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate a song plan before exporting JSON.");
    return;
  }
  downloadJson(`${cleanFactorySlug(plan.settings.albumTitle)}-suno-plan.json`, plan);
  setStatus("#songFactoryStatus", "Exported Song Factory JSON.");
}

function exportSongFactoryTracklist() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate a song plan before exporting a tracklist.");
    return;
  }
  const text = plan.tracks
    .slice()
    .sort((a, b) => Number(a.number || 0) - Number(b.number || 0))
    .map((track) => String(track.title || "").trim())
    .filter(Boolean)
    .join("\r\n");
  downloadText(`${cleanFactorySlug(plan.settings.albumTitle)}-tracklist.txt`, text, "text/plain");
  setStatus("#songFactoryStatus", "Exported plain tracklist TXT.");
}

function copySongFactoryPrompts() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate a song plan before copying prompts.");
    return;
  }
  copySongFactoryText(songFactoryPromptsText(plan), "Copied all Suno prompts.");
}

function songFactoryPromptsText(plan) {
  const albumPrompt = plan.albumPrompt || buildSongFactoryAlbumPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), null);
  const albumArtworkPrompt = plan.albumArtworkPrompt || buildSongFactoryAlbumArtworkPrompt(plan.settings, songFactoryPresetDetails(plan.settings.preset), null);
  return [
    `ALBUM TITLE\n${plan.settings.albumTitle}`,
    `ALBUM PROMPT\n${albumPrompt}`,
    `ALBUM ARTWORK PROMPT\n${albumArtworkPrompt}`,
    "TRACK PROMPTS",
    plan.tracks.map((track) => `${track.number}. ${track.title}\n${track.sunoPrompt || buildSongFactoryPrompt(track, plan.settings, songFactoryPresetDetails(plan.settings.preset), albumPrompt)}`).join("\n\n")
  ].join("\n\n");
}

async function songFactoryArtworkUploadPayload() {
  const input = $("#songFactoryArtworkUpload");
  const file = input?.files?.[0];
  if (!file) return null;
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read artwork file."));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name,
    mimeType: file.type,
    dataUrl
  };
}

async function saveSongFactoryCompletedAlbum() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate or recall a Song Factory plan before saving it as a completed album.");
    return;
  }
  try {
    setStatus("#songFactoryStatus", "Saving album metadata, artwork, catalogue rows and visual themes...");
    const artworkUpload = await songFactoryArtworkUploadPayload();
    const result = await postBackend("/api/song-factory/save-completed-album", {
      profileId: state.activeProfileId,
      plan,
      artworkUpload,
      promptsText: songFactoryPromptsText(plan)
    });
    state.songFactorySavedAlbum = result;
    save();
    await loadSongFactoryAlbums(true);
    setStatus("#songFactoryStatus", `${result.message} App audio folder: ${result.audioDir}. Now pick the downloaded Suno audio folder.`);
  } catch (error) {
    setStatus("#songFactoryStatus", `Could not save completed album: ${error.message}`);
  }
}

async function pickSongFactoryAudioFolder() {
  try {
    const input = $("#songFactoryAudioFolder");
    const initialPath = input?.value.trim() || defaultSongFactoryAudioFolder();
    const result = await postBackend("/api/setup/pick-folder", {
      title: "Choose the folder containing downloaded Song Factory audio",
      initialPath
    });
    const folder = result.path || result.folder || "";
    if (folder) {
      if (input) input.value = folder;
      setStatus("#songFactoryStatus", "Downloaded audio folder selected.");
    } else {
      setStatus("#songFactoryStatus", "No folder was selected. You can also paste a folder path directly into the box.");
    }
  } catch (error) {
    setStatus("#songFactoryStatus", `Could not choose audio folder: ${error.message}`);
  }
}

async function pasteSongFactoryAudioFolder() {
  const input = $("#songFactoryAudioFolder");
  if (!input) return;
  let value = "";
  try {
    value = await navigator.clipboard.readText();
  } catch {
    value = prompt("Paste the folder path or file:/// folder link here") || "";
  }
  value = normalizeSetupFolderInput(value || defaultSongFactoryAudioFolder());
  if (!value) {
    setStatus("#songFactoryStatus", "No folder path was pasted.");
    return;
  }
  input.value = value;
  setStatus("#songFactoryStatus", "Downloaded audio folder path added.");
}

function openSongFactorySunoUrl() {
  const url = $("#songFactorySunoPlaylistUrl")?.value.trim() || "";
  if (!url) {
    setStatus("#songFactoryStatus", "Paste the Suno playlist URL first.");
    return;
  }
  openUrlInChrome(url, "#songFactoryStatus");
}

function copySongFactorySunoUrl() {
  const url = $("#songFactorySunoPlaylistUrl")?.value.trim() || "";
  if (!url) {
    setStatus("#songFactoryStatus", "Paste the Suno playlist URL first.");
    return;
  }
  copySongFactoryText(url, "Copied Suno playlist URL.");
}

async function openSongFactoryDownloader() {
  const url = $("#songFactorySunoPlaylistUrl")?.value.trim() || "";
  if (!url) {
    setStatus("#songFactoryStatus", "Paste the Suno playlist URL first.");
    return;
  }
  try {
    await navigator.clipboard.writeText(url).catch(() => {});
    const result = await postBackend("/api/song-factory/open-downloader", {
      profileId: state.activeProfileId,
      url
    });
    if (result.ok === false) {
      throw new Error(result.message || "Downloader could not be opened.");
    }
    setStatus("#songFactoryStatus", result.message || "Opened Suno downloader.");
  } catch (error) {
    setStatus("#songFactoryStatus", `Could not open downloader: ${error.message}`);
  }
}

async function convertSongFactoryAudioFiles() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate or recall a Song Factory plan before converting audio.");
    return;
  }
  const sourceFolder = $("#songFactoryAudioFolder")?.value.trim() || "";
  if (!sourceFolder) {
    setStatus("#songFactoryStatus", "Choose the folder containing the downloaded Suno audio first.");
    return;
  }
  const outputFolder = state.songFactorySavedAlbum?.audioDir || "";
  if (!outputFolder) {
    setStatus("#songFactoryStatus", "Save as completed album first, then the app can copy the converted MP3s into its own album audio folder.");
    return;
  }
  if (!confirm(`Copy and convert downloaded audio?\n\nSource folder stays unchanged:\n${sourceFolder}\n\nIn-app album audio folder:\n${outputFolder}\n\nSecond distributor copy:\n${sourceFolder}\\Ditto Ready\n\nFormat: MP3, 44.1 kHz, stereo, 320 kbps`)) return;
  try {
    setStatus("#songFactoryStatus", "Starting audio conversion...");
    setSongFactoryConvertControls(true);
    setSongFactoryConvertProgress({
      stage: "starting",
      current: 0,
      total: plan.tracks.length,
      percent: 0,
      message: "Preparing audio conversion..."
    }, { running: true, startedAt: new Date().toISOString() });
    const result = await postBackend("/api/song-factory/prepare-audio/start", {
      profileId: state.activeProfileId,
      plan,
      sourceFolder,
      outputFolder,
      mirrorToSourceFolder: true,
      artworkPath: state.songFactorySavedAlbum?.artworkPath || ""
    });
    if (result.ok === false) {
      throw new Error(result.message || "Audio conversion was not completed.");
    }
    setStatus("#songFactoryStatus", result.message || "Audio conversion started.");
    startSongFactoryConvertPolling();
  } catch (error) {
    setSongFactoryConvertControls(false);
    setSongFactoryConvertProgress({
      stage: "failed",
      current: 0,
      total: plan.tracks.length,
      percent: 0,
      message: error.message
    });
    setStatus("#songFactoryStatus", `Could not convert audio: ${error.message}`);
  }
}

function songFactoryConvertCompletionMessage(result = {}) {
  const extras = [
    result.missingAudioFiles ? `${result.missingAudioFiles} missing file${result.missingAudioFiles === 1 ? "" : "s"}` : "",
    result.extraAudioFiles ? `${result.extraAudioFiles} extra file${result.extraAudioFiles === 1 ? "" : "s"}` : "",
    result.failures?.length ? `${result.failures.length} conversion failure${result.failures.length === 1 ? "" : "s"}` : ""
  ].filter(Boolean).join("; ");
  return `${result.message || "Audio conversion finished."}${extras ? ` (${extras})` : ""}. App output: ${result.outputFolder || "not set"}. Ditto copy: ${result.mirrorFolder || "not created"}`;
}

function startSongFactoryConvertPolling() {
  if (songFactoryConvertPollTimer) clearInterval(songFactoryConvertPollTimer);
  pollSongFactoryConvertStatus();
  songFactoryConvertPollTimer = setInterval(pollSongFactoryConvertStatus, 1000);
}

async function pollSongFactoryConvertStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/song-factory/prepare-audio/status`);
    const status = await response.json();
    setSongFactoryConvertProgress(status.progress || {}, status);
    setSongFactoryConvertControls(Boolean(status.running));

    if (!status.running) {
      if (songFactoryConvertPollTimer) clearInterval(songFactoryConvertPollTimer);
      songFactoryConvertPollTimer = null;
      if (status.result?.ok) {
        setStatus("#songFactoryStatus", songFactoryConvertCompletionMessage(status.result));
      } else if (status.result?.ok === false) {
        setStatus("#songFactoryStatus", status.result.message || "Audio conversion was not completed.");
      } else if (status.error) {
        setStatus("#songFactoryStatus", `Could not convert audio: ${status.error}`);
      }
    }
  } catch (error) {
    if (songFactoryConvertPollTimer) clearInterval(songFactoryConvertPollTimer);
    songFactoryConvertPollTimer = null;
    setSongFactoryConvertControls(false);
    setStatus("#songFactoryStatus", "Lost connection to the backend while converting audio.");
  }
}

async function resumeSongFactoryConvertStatusOnLoad() {
  try {
    const response = await fetch(`${backendUrl}/api/song-factory/prepare-audio/status`);
    const status = await response.json();
    if (!status?.ok) return;
    setSongFactoryConvertProgress(status.progress || {}, status);
    setSongFactoryConvertControls(Boolean(status.running));
    if (status.running) {
      setStatus("#songFactoryStatus", "Audio conversion is currently running.");
      startSongFactoryConvertPolling();
    }
  } catch {}
}

function setSongFactoryConvertProgress(progress = {}, status = {}) {
  const bar = $("#songFactoryConvertProgressBar");
  const label = $("#songFactoryConvertProgressLabel");
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  if (bar) bar.style.width = `${percent}%`;
  if (!label) return;

  const total = Number(progress.total) || 0;
  const current = Number(progress.current) || 0;
  const startedAt = status.startedAt ? new Date(status.startedAt) : null;
  const elapsedMs = startedAt && !Number.isNaN(startedAt.getTime()) ? Date.now() - startedAt.getTime() : 0;
  const stage = progress.stage === "complete" ? "Conversion complete"
    : progress.stage === "failed" ? "Conversion failed"
    : progress.stage === "scanning" ? "Scanning files"
    : progress.stage === "saving" ? "Saving metadata"
    : progress.stage === "converting" ? "Converting audio"
    : progress.message || "No active audio conversion";
  const countText = total ? `Track ${Math.min(Math.max(current, 1), total)} of ${total}` : "No active conversion";
  const elapsedText = elapsedMs > 0 ? formatDuration(elapsedMs) : "Just started";
  const message = progress.message ? ` | ${progress.message}` : "";
  label.innerHTML = `<span>${escapeHtml(`${stage} | ${countText} | ${Math.round(percent)}% | Elapsed: ${elapsedText}${message}`)}</span>`;
}

function setSongFactoryConvertControls(isRunning) {
  const convert = $("#convertSongFactoryAudioFiles");
  const rename = $("#renameSongFactoryAudioFiles");
  if (convert) convert.disabled = isRunning;
  if (rename) rename.disabled = isRunning;
}

async function renameSongFactoryAudioFiles() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate or recall a Song Factory plan before renaming MP3s.");
    return;
  }
  const folder = $("#songFactoryAudioFolder")?.value.trim() || state.songFactorySavedAlbum?.audioDir || "";
  if (!folder) {
    setStatus("#songFactoryStatus", "Choose the folder containing downloaded MP3 files first.");
    return;
  }
  if (!confirm(`Rename audio files in this folder using the active Song Factory track order?\n\n${folder}`)) return;
  try {
    const result = await postBackend("/api/song-factory/rename-audio-files", {
      profileId: state.activeProfileId,
      plan,
      folder
    });
    const extras = [
      result.missingAudioFiles ? `${result.missingAudioFiles} missing file${result.missingAudioFiles === 1 ? "" : "s"}` : "",
      result.extraAudioFiles ? `${result.extraAudioFiles} extra file${result.extraAudioFiles === 1 ? "" : "s"}` : "",
      result.skippedAlreadyNamed ? `${result.skippedAlreadyNamed} already named` : ""
    ].filter(Boolean).join("; ");
    setStatus("#songFactoryStatus", `${result.message}${extras ? ` (${extras})` : ""}`);
  } catch (error) {
    setStatus("#songFactoryStatus", `Could not rename MP3s: ${error.message}`);
  }
}

async function openSongFactoryAlbumFolder() {
  const folder = state.songFactorySavedAlbum?.albumDir;
  if (!folder) {
    setStatus("#songFactoryStatus", "Save a completed album first, then open the saved folder.");
    return;
  }
  try {
    const result = await postBackend("/api/open-path", { path: folder });
    setStatus("#songFactoryStatus", result.message || "Opened saved album folder.");
  } catch (error) {
    setStatus("#songFactoryStatus", `Could not open saved folder: ${error.message}`);
  }
}

function exportSongFactoryPromptsTxt() {
  const plan = state.songFactoryPlan;
  if (!plan?.tracks?.length) {
    setStatus("#songFactoryStatus", "Generate or recall a song plan before exporting prompts.");
    return;
  }
  downloadText(`${cleanFactorySlug(plan.settings.albumTitle)}-prompts.txt`, songFactoryPromptsText(plan), "text/plain");
  setStatus("#songFactoryStatus", "Exported Song Factory prompts TXT.");
}

function clearSongFactoryPlan() {
  if (!state.songFactoryPlan?.tracks?.length) return;
  if (!confirm("Clear the current Song Factory plan for this profile?")) return;
  state.songFactoryPlan = null;
  const titleInput = $("#songFactoryAlbumTitle");
  if (titleInput) titleInput.value = "";
  const artworkInput = $("#songFactoryArtworkUpload");
  if (artworkInput) artworkInput.value = "";
  const sunoUrlInput = $("#songFactorySunoPlaylistUrl");
  if (sunoUrlInput) sunoUrlInput.value = "";
  const audioFolderInput = $("#songFactoryAudioFolder");
  if (audioFolderInput) audioFolderInput.value = defaultSongFactoryAudioFolder();
  state.songFactorySavedAlbum = null;
  save();
  renderSongFactory();
  setStatus("#songFactoryStatus", "Song Factory plan cleared.");
}

async function createReviewBatchFromGui() {
  const settings = getPostingSettings();
  const shortsPerTrack = Math.max(1, Number(settings.shortsPerDay) || 1);
  const expectedTotal = Math.ceil((Number(settings.renderBatchSize) || 1) / shortsPerTrack) * shortsPerTrack;
  const usePerformancePreset = Boolean(state.performanceGeneratePreset?.ok);
  setStatus("#renderBatchStatus", usePerformancePreset ? "Starting performance-led review batch..." : "Starting review batch...");
  setRenderProgress({ percent: 0, stage: "starting", message: "Preparing the render job...", current: 0, total: expectedTotal });
  setRenderControls(true);
  try {
    const result = await postBackend("/api/render/start", {
      profileId: state.activeProfileId,
      count: settings.renderBatchSize,
      renderPreset: settings.renderPreset,
      minSeconds: settings.renderMinSeconds,
      maxSeconds: settings.renderMaxSeconds,
      fadeOutSeconds: settings.renderFadeSeconds,
      renderTimeoutSeconds: 300,
      cooldownDays: settings.postingCooldown,
      shortsPerTrack: settings.shortsPerDay,
      templateMode: "rotate",
      usePerformancePreset
    });
    if (!result.ok) {
      setStatus("#renderBatchStatus", result.message || "Render could not start.");
      setRenderControls(false);
      return;
    }
    setStatus("#renderBatchStatus", result.message || "Review batch started.");
    startRenderPolling();
  } catch (error) {
    setStatus("#renderBatchStatus", "Backend is not running. Start the scheduler backend, then try again.");
    setRenderControls(false);
  }
}

function startRenderPolling() {
  if (renderPollTimer) clearInterval(renderPollTimer);
  pollRenderStatus();
  renderPollTimer = setInterval(pollRenderStatus, 1500);
}

async function pollRenderStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/render/status`);
    const status = await response.json();
    setRenderProgress(status.progress || {}, status);

    if (!status.running) {
      if (renderPollTimer) clearInterval(renderPollTimer);
      renderPollTimer = null;
      setRenderControls(false);

      if (status.result?.ok && Array.isArray(status.result.items)) {
        replaceReviews(status.result.items);
        setStatus("#renderBatchStatus", renderBatchCompletionMessage(status.result.message || "Render complete.", status.result.items));
        location.hash = "review";
      } else if (status.cancelled) {
        setStatus("#renderBatchStatus", "Render stopped. Change settings and create a new batch when ready.");
      } else if (status.error) {
        setStatus("#renderBatchStatus", `Render failed: ${status.error}`);
      }
    }
  } catch (error) {
    if (renderPollTimer) clearInterval(renderPollTimer);
    renderPollTimer = null;
    setRenderControls(false);
    setStatus("#renderBatchStatus", "Lost connection to the backend while rendering.");
  }
}

async function resumeRenderStatusOnLoad() {
  try {
    const response = await fetch(`${backendUrl}/api/render/status`);
    const status = await response.json();
    if (!status?.ok) return;
    setRenderProgress(status.progress || {}, status);
    setRenderControls(Boolean(status.running));
    if (status.running) {
      setStatus("#renderBatchStatus", "A review batch is currently rendering.");
      startRenderPolling();
    } else if (status.cancelled) {
      setStatus("#renderBatchStatus", "Previous render was stopped. You can create a new batch.");
    } else if (status.result?.ok) {
      setStatus("#renderBatchStatus", renderBatchCompletionMessage(status.result.message || "Render complete.", status.result.items || state.reviews));
    }
  } catch {}
}

function renderBatchCompletionMessage(baseMessage = "Render complete.", items = []) {
  const normalized = (Array.isArray(items) ? items : [])
    .map(normalizeReview)
    .filter(isPlayableReview);
  const trackCount = new Set(normalized.map(scheduleTrackKey)).size;
  const campaignSummary = normalized.length
    ? ` ${normalized.length} playable Short${normalized.length === 1 ? "" : "s"} from ${trackCount} track campaign${trackCount === 1 ? "" : "s"}.`
    : "";
  return `${baseMessage} Loaded into Review.${campaignSummary} Each card now shows its planned date/time if approved.`;
}

async function stopReviewBatchFromGui() {
  setStatus("#renderBatchStatus", "Stopping render...");
  setRenderProgress({ percent: 0, stage: "cancelled", message: "Stopping render job..." });
  try {
    await postBackend("/api/render/cancel", {});
    await pollRenderStatus();
  } catch (error) {
    setStatus("#renderBatchStatus", "Could not stop render. Check the backend window.");
  }
}

function setRenderProgress(progress = {}, status = {}) {
  const bars = [$("#renderProgressBar"), $("#renderStatusProgressBar")].filter(Boolean);
  const labels = [$("#renderProgressLabel"), $("#renderStatusProgressLabel")].filter(Boolean);
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const details = renderOperationProgressDetails(progress, status, percent, "render");
  bars.forEach((bar) => { bar.style.width = `${percent}%`; });
  labels.forEach((label) => { label.innerHTML = details; });
}

function renderOperationProgressDetails(progress = {}, status = {}, percent = 0, operation = "render") {
  const stage = progress.stage || "idle";
  const parsed = parseOperationMessage(progress.message || "");
  const total = Number(parsed.total || progress.total) || 0;
  const currentItem = parsed.current || inferCurrentReel(progress);
  const completed = inferCompletedReels(progress, parsed);
  const startedAt = status.startedAt ? new Date(status.startedAt) : null;
  const elapsedMs = startedAt && !Number.isNaN(startedAt.getTime()) ? Date.now() - startedAt.getTime() : 0;
  const eta = estimateRenderEta({ elapsedMs, completed, total, percent, running: status.running });
  const stageText = operationStageLabel(stage, progress.message, operation);
  const noun = operation === "upload" ? "Upload" : "Reel";
  const idleText = operation === "upload" ? "No active upload" : "No active render";
  const reelText = total ? `${noun} ${Math.min(Math.max(currentItem, 1), total)} of ${total}` : idleText;
  const etaText = eta
    ? `${formatClock(eta.finishAt)} (${formatDuration(eta.remainingMs)} left)`
    : `Calculating after the first ${operation === "upload" ? "upload" : "reel"} finishes`;
  const elapsedText = elapsedMs > 0 ? formatDuration(elapsedMs) : "Just started";
  const percentText = total || percent ? `${Math.round(percent)}%` : "0%";
  const itemText = parsed.label ? ` | ${parsed.label}` : "";

  return `
    <span>${escapeHtml(`${stageText} | ${reelText} | ${percentText}${itemText} | ETA: ${etaText} | Elapsed: ${elapsedText}`)}</span>
  `;
}

function parseOperationMessage(message) {
  const value = String(message || "");
  const match = value.match(/\b(Rendering|Finished|Skipped|Uploading|Uploaded|Prepared)\s+(\d+)\/(\d+)(?::\s*(.+))?/i);
  if (!match) return {};
  return {
    action: match[1].toLowerCase(),
    current: Number(match[2]),
    total: Number(match[3]),
    label: (match[4] || "").trim()
  };
}

function inferCurrentReel(progress) {
  const total = Number(progress.total) || 0;
  if (!total) return 0;
  const current = Number(progress.current) || 0;
  if (progress.stage === "complete") return total;
  return Math.min(current + 1, total);
}

function inferCompletedReels(progress, parsed) {
  if (parsed.action === "rendering") return Math.max(0, parsed.current - 1);
  if (parsed.action === "uploading") return Math.max(0, parsed.current - 1);
  if (["finished", "skipped", "uploaded", "prepared"].includes(parsed.action)) return parsed.current;
  return Number(progress.current) || 0;
}

function estimateRenderEta({ elapsedMs, completed, total, percent, running }) {
  if (!running || !elapsedMs || !total) return null;
  let remainingMs = 0;
  if (completed > 0) {
    remainingMs = Math.max(0, (elapsedMs / completed) * (total - completed));
  } else if (percent > 2) {
    remainingMs = Math.max(0, elapsedMs * ((100 - percent) / percent));
  } else {
    return null;
  }
  return {
    remainingMs,
    finishAt: new Date(Date.now() + remainingMs)
  };
}

function operationStageLabel(stage, message = "", operation = "render") {
  if (operation === "upload") {
    if (stage === "starting") return "Preparing video upload";
    if (stage === "uploading") {
      if (/^Uploaded/i.test(message)) return "Finished current upload";
      if (/^Skipped/i.test(message)) return "Skipping missing video and continuing";
      return "Uploading video to R2";
    }
    if (stage === "complete") return "Upload complete";
    if (stage === "cancelled") return "Upload stopped";
    if (stage === "failed") return "Upload failed";
    return message || "Idle";
  }

  if (stage === "selecting") return "Selecting tracks and checking artwork";
  if (stage === "starting") return "Starting renderer";
  if (stage === "rendering") {
    if (/^Finished/i.test(message)) return "Finishing current Reel";
    if (/^Skipped/i.test(message)) return "Skipping failed Reel and continuing";
    return "Rendering video, animation, audio and fade-out";
  }
  if (stage === "complete") return "Render complete";
  if (stage === "cancelled") return "Render stopped";
  if (stage === "failed") return "Render failed";
  return message || "Idle";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return `${hours}h ${remainder}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatClock(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function setRenderControls(isRunning) {
  const start = $("#createReviewBatchFlow");
  const stop = $("#stopReviewBatch");
  if (start) start.disabled = isRunning;
  if (stop) stop.disabled = !isRunning;
}

async function loadLatestBatchIntoReview() {
  setReviewLoadStatus("Refreshing review workspace...");
  try {
    const response = await fetch(`${backendUrl}/api/render/latest?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const result = await response.json();
    if (result.ok && Array.isArray(result.items)) {
      replaceReviews(result.items);
      setReviewLoadStatus(result.message || "Latest batch loaded.", "success");
    } else {
      setReviewLoadStatus(result.message || "No latest batch found.", "error");
    }
  } catch (error) {
    setReviewLoadStatus("Backend is not running. Start the scheduler backend, then try again.", "error");
  }
}

function setReviewLoadStatus(message, tone = "busy") {
  const target = $("#reviewLoadStatus");
  const list = $("#reviewList");
  if (!target) return;
  target.textContent = message;
  target.className = `note step-status ${tone}`;
  if (list) list.classList.toggle("refreshing", tone === "busy");
}

async function openLatestBatchFolder() {
  try {
    const result = await postBackend("/api/open-path", {
      latestRenderedBatch: true
    });
    const message = result.ok ? `Opened: ${result.path}` : result.message || "Could not open latest batch folder.";
    setStatus("#renderBatchStatus", message);
    setStatus("#apiPublishStatus", message);
  } catch (error) {
    const message = "Backend is not running. Start the scheduler backend, then try again.";
    setStatus("#renderBatchStatus", message);
    setStatus("#apiPublishStatus", message);
  }
}

async function uploadApprovedToR2FromGui() {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#apiPublishStatus", "R2 upload is not connected for this profile yet. Add profile-specific storage secrets next.");
    return;
  }
  if (!state.publishingQueue.length) {
    setStatus("#apiPublishStatus", "No approved queue items to upload.");
    return;
  }
  setStatus("#apiPublishStatus", "Starting upload...");
  setUploadProgress({ percent: 0, stage: "starting", message: "Preparing upload...", current: 0, total: state.publishingQueue.length });
  setUploadControls(true);
  try {
    const result = await postBackend("/api/r2/upload-start", {
      postingSettings: getPostingSettings(),
      items: state.publishingQueue
    });
    if (!result.ok) {
      setStatus("#apiPublishStatus", result.message || "Upload could not start.");
      setUploadControls(false);
      return;
    }
    setStatus("#apiPublishStatus", result.message || "Upload started.");
    startUploadPolling();
  } catch (error) {
    setStatus("#apiPublishStatus", "R2 upload failed. Check that the backend is running and R2 secrets are saved.");
    setUploadControls(false);
  }
}

async function syncLatestUploadedPackage() {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#apiPublishStatus", "Latest R2 upload results are not connected for this profile yet. Add profile-specific storage secrets next.");
    return;
  }
  setStatus("#apiPublishStatus", "Loading latest uploaded results...");
  try {
    const response = await fetch(`${backendUrl}/api/r2/latest-upload`);
    const result = await response.json();
    if (!result.ok || !Array.isArray(result.items)) {
      setStatus("#apiPublishStatus", result.message || "No uploaded results found yet.");
      return;
    }

    addToPostingPlan(result.items, getPostingSettings());
    state.publishingQueue = [];
    save();
    renderPublishingQueue();
    setStatus("#apiPublishStatus", `${result.message || "Latest upload results loaded."} Saved into the scheduled plan; the staging queue is clear for the next batch.`);
  } catch (error) {
    setStatus("#apiPublishStatus", "Could not refresh upload state. Make sure the backend is running.");
  }
}

function startUploadPolling() {
  if (uploadPollTimer) clearInterval(uploadPollTimer);
  pollUploadStatus();
  uploadPollTimer = setInterval(pollUploadStatus, 1500);
}

async function pollUploadStatus() {
  try {
    const response = await fetch(`${backendUrl}/api/r2/upload-status`);
    const status = await response.json();
    setUploadProgress(status.progress || {}, status);

    if (!status.running) {
      if (uploadPollTimer) clearInterval(uploadPollTimer);
      uploadPollTimer = null;
      setUploadControls(false);

      if (status.result?.ok && Array.isArray(status.result.items)) {
        addToPostingPlan(status.result.items, getPostingSettings());
        state.publishingQueue = [];
        save();
        renderPublishingQueue();
        setStatus("#apiPublishStatus", `${status.result.message || "Upload complete."} Videos are saved into the scheduled plan; the staging queue is clear for the next batch.`);
      } else if (status.cancelled) {
        setStatus("#apiPublishStatus", "Upload stopped. You can restart it when ready.");
      } else if (status.error) {
        setStatus("#apiPublishStatus", `Upload failed: ${status.error}`);
      }
    }
  } catch (error) {
    if (uploadPollTimer) clearInterval(uploadPollTimer);
    uploadPollTimer = null;
    setUploadControls(false);
    setStatus("#apiPublishStatus", "Lost connection to the backend while uploading.");
  }
}

async function stopUploadFromGui() {
  setStatus("#apiPublishStatus", "Stopping upload...");
  setUploadProgress({ percent: 0, stage: "cancelled", message: "Stopping upload..." });
  try {
    await postBackend("/api/r2/upload-cancel", {});
    await pollUploadStatus();
  } catch (error) {
    setStatus("#apiPublishStatus", "Could not stop upload. Check the backend window.");
  }
}

function setUploadProgress(progress = {}, status = {}) {
  const bars = [$("#uploadProgressBar"), $("#uploadStatusProgressBar")].filter(Boolean);
  const labels = [$("#uploadProgressLabel"), $("#uploadStatusProgressLabel")].filter(Boolean);
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const details = renderOperationProgressDetails(progress, status, percent, "upload");
  bars.forEach((bar) => { bar.style.width = `${percent}%`; });
  labels.forEach((label) => { label.innerHTML = details; });
}

function setUploadControls(isRunning) {
  const start = $("#uploadApprovedToR2");
  const stop = $("#stopR2Upload");
  if (start) start.disabled = isRunning;
  if (stop) stop.disabled = !isRunning;
}

async function createContainersFromGui() {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#apiPublishStatus", "Instagram container creation is not connected for this profile yet. Add profile-specific Meta credentials next.");
    return;
  }
  const uploaded = state.publishingQueue.filter((item) => item.publicVideoUrl);
  if (!uploaded.length) {
    setStatus("#apiPublishStatus", "Upload Reels to R2 first so each item has a public video URL.");
    return;
  }
  setStatus("#apiPublishStatus", "Creating Instagram media containers...");
  try {
    const result = await postBackend("/api/instagram/create-containers", {
      postingSettings: getPostingSettings(),
      items: uploaded
    });
    if (result.ok && Array.isArray(result.items)) {
      state.publishingQueue = result.items.map((item) => normalizePublishItem(item, getPostingSettings()));
      save();
      renderPublishingQueue();
    }
    setStatus("#apiPublishStatus", result.message || "Instagram container step finished.");
  } catch (error) {
    setStatus("#apiPublishStatus", "Instagram container creation failed. Check token, permissions, and backend status.");
  }
}

async function refreshScheduleState({ quiet = false } = {}) {
  if (!quiet) {
    setStatus("#apiPublishStatus", "Refreshing Schedule from saved local and backend plan...");
  }

  state.publishingQueue = profileStorageGet("jazzPublishingQueue", []);
  state.postingPlan = profileStorageGet("jazzPostingPlan", []);
  state.youtubeVideoReviews = profileStorageGet("jazzYouTubeVideoReviews", []);

  try {
    const planResponse = await fetch(`${backendUrl}/api/posting-plan?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const plan = await planResponse.json();
    if (plan?.ok && Array.isArray(plan.items)) {
      state.postingPlan = plan.items.map((item, index) => normalizePublishItem(item, getPostingSettings(), index));
      profileStorageSet("jazzPostingPlan", state.postingPlan);
    }

    const youtubeResponse = await fetch(`${backendUrl}/api/youtube/video-plan?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const youtubePlan = await youtubeResponse.json();
    if (youtubePlan?.ok && Array.isArray(youtubePlan.items)) {
      state.youtubeVideoReviews = youtubePlan.items.map(normalizeReview);
      profileStorageSet("jazzYouTubeVideoReviews", state.youtubeVideoReviews);
    }
  } catch {
    if (!quiet) {
      setStatus("#apiPublishStatus", "Backend is not running. Refreshed Schedule from this browser's saved local state.");
    }
  }

  save();
  renderPublishingQueue();
  renderPostingPlan();
  renderYouTubeVideoReviews();
  renderDashboard();
  renderHelpStatus();
  if (!quiet) {
    const total = state.publishingQueue.length + state.postingPlan.length;
    setStatus("#apiPublishStatus", `Schedule refreshed. ${total} scheduled/staged item${total === 1 ? "" : "s"} loaded.`);
  }
}

async function publishDueFromGui({ force = false } = {}) {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#apiPublishStatus", "Publishing for this profile is not connected yet. This workspace is separated; profile-specific backend credentials come next.");
    return;
  }
  if (publishInFlight) {
    setStatus("#apiPublishStatus", "Publishing is already running. Wait for this check to finish.");
    return;
  }
  if (!force && publishRetryReadyAt && Date.now() < publishRetryReadyAt) {
    const remaining = publishRetryReadyAt - Date.now();
    setStatus("#apiPublishStatus", `Meta is still preparing the video. Try again in ${formatDuration(remaining)}.`);
    updatePublishRetryProgress();
    return;
  }
  const sourceItems = getPublishSourceItems();
  const candidates = sourceItems.filter((item) => (
    (item.containerId || item.publicVideoUrl)
    && (item.status !== "posted" || item.facebookPublishStatus === "publish-error" || !item.facebookMediaId)
  ));
  if (!candidates.length) {
    setStatus("#apiPublishStatus", "No uploaded Reels need publishing or Facebook follow-up.");
    setPublishProgress({ mode: "idle", message: "No Reels need publishing right now.", percent: 0 });
    return;
  }
  clearPublishRetryCountdown();
  setStatus("#apiPublishStatus", force ? "Publishing all uploaded Reels now..." : "Checking for due scheduled Reels...");
  startPublishProgress(force ? "Publishing uploaded Reels now" : "Checking due Reels with Meta");
  setPublishControls(true);
  try {
    const result = await postBackend("/api/publish/all-due", {
      profileId: state.activeProfileId,
      postingSettings: getPostingSettings(),
      items: sourceItems,
      youtubeVideoItems: applyScheduleToYouTubeVideos(state.youtubeVideoReviews),
      force
    });
    if (Array.isArray(result.items)) {
      mergePublishResultsIntoStores(result.items);
      if (Array.isArray(result.youtubeVideoItems)) {
        mergeYouTubeVideoPublishResults(result.youtubeVideoItems);
      }
      save();
      renderPublishingQueue();
      renderPostingPlan();
      renderYouTubeVideoReviews();
      loadPublishingHistory();
    }
    setStatus("#apiPublishStatus", publishResultMessage(result));
    handlePublishResultProgress(result);
  } catch (error) {
    const detail = error?.message ? ` ${error.message}` : "";
    setStatus("#apiPublishStatus", `Publish check failed.${detail}`);
    setPublishProgress({ mode: "error", message: `Publish check failed.${detail}`, percent: 100 });
  } finally {
    stopPublishProgressTimer();
    setPublishControls(false);
  }
}

async function resendDueFromGui(destination, itemId = "", options = {}) {
  if (state.activeProfileId !== DEFAULT_PROFILE_ID) {
    setStatus("#apiPublishStatus", "Re-send is not connected for this profile yet. Switch to the Coffee Jazz profile or complete profile-specific backend setup next.");
    return;
  }
  if (publishInFlight) {
    setStatus("#apiPublishStatus", "Publishing is already running. Wait for this check to finish.");
    return;
  }
  const labels = {
    meta: "Meta/Instagram",
    youtubeShorts: "YouTube Shorts",
    youtubeVideo: "YouTube full video"
  };
  const label = labels[destination] || "selected store";
  const sourceItems = getPublishSourceItems();
  const youtubeVideoItems = applyScheduleToYouTubeVideos(state.youtubeVideoReviews);
  if (!sourceItems.length && destination !== "youtubeVideo") {
    setStatus("#apiPublishStatus", "No saved schedule items were found to re-send.");
    return;
  }
  if (destination === "youtubeVideo" && !sourceItems.length && !youtubeVideoItems.length) {
    setStatus("#apiPublishStatus", "No scheduled videos were found to re-send to YouTube.");
    return;
  }
  const selectedItem = itemId
    ? sourceItems.find((item) => [item.id, item.video].some((value) => String(value || "") === String(itemId)))
    : null;
  if (itemId && !selectedItem) {
    await refreshScheduleState({ quiet: true });
  }
  const refreshedSourceItems = itemId && !selectedItem ? getPublishSourceItems() : sourceItems;
  const refreshedYouTubeVideoItems = itemId && !selectedItem ? applyScheduleToYouTubeVideos(state.youtubeVideoReviews) : youtubeVideoItems;
  const refreshedSelectedItem = itemId
    ? refreshedSourceItems.find((item) => [item.id, item.video].some((value) => String(value || "") === String(itemId)))
    : null;
  if (itemId && !refreshedSelectedItem) {
    setStatus("#apiPublishStatus", `Could not find the selected scheduled item (${itemId}) to re-send after refreshing. Use Refresh Schedule, then try the button on the visible item again.`);
    return;
  }
  const selectedLabel = refreshedSelectedItem?.title ? `"${refreshedSelectedItem.title}"` : "the selected item";
  const targetText = itemId ? selectedLabel : options.limit > 1 ? `up to ${options.limit} failed or due items` : "the next failed or due item";
  if (!options.skipConfirm) {
    const confirmed = confirm(`Re-send ${targetText} to ${label}? This may create another public post on that store.`);
    if (!confirmed) return;
  }

  clearPublishRetryCountdown();
  setStatus("#apiPublishStatus", `Re-sending to ${label}...`);
  startPublishProgress(`Re-sending to ${label}`);
  setPublishControls(true);
  publishInFlight = true;
  try {
    const result = await postBackend("/api/publish/resend", {
      profileId: state.activeProfileId,
      destination,
      postingSettings: getPostingSettings(),
      items: refreshedSourceItems,
      youtubeVideoItems: refreshedYouTubeVideoItems,
      itemId,
      limit: options.limit || 1
    });
    if (Array.isArray(result.items)) {
      mergePublishResultsIntoStores(result.items);
    }
    if (Array.isArray(result.youtubeVideoItems)) {
      mergeYouTubeVideoPublishResults(result.youtubeVideoItems);
    }
    save();
    renderPublishingQueue();
    renderPostingPlan();
    renderYouTubeVideoReviews();
    loadPublishingHistory();
    setStatus("#apiPublishStatus", publishResultMessage(result));
    handlePublishResultProgress(result);
  } catch (error) {
    const detail = error?.message ? ` ${error.message}` : "";
    setStatus("#apiPublishStatus", `Re-send failed.${detail}`);
    setPublishProgress({ mode: "error", message: `Re-send failed.${detail}`, percent: 100 });
  } finally {
    publishInFlight = false;
    stopPublishProgressTimer();
    setPublishControls(false);
  }
}

async function retryFailedShortsFromGui() {
  const failedDueShorts = getPublishSourceItems()
    .filter((item) => isFailedYouTubeShortItem(item))
    .filter((item) => item.publicVideoUrl && isDueNow(item));
  if (!failedDueShorts.length) {
    setStatus("#apiPublishStatus", "No failed YouTube Shorts are due right now. Fix/reset the failed items, or change their scheduled time to now.");
    return;
  }
  const limit = Math.min(failedDueShorts.length, 10);
  const confirmed = confirm(`Retry ${limit} failed due YouTube Short${limit === 1 ? "" : "s"} now? This may create public YouTube Shorts.`);
  if (!confirmed) return;
  await resendDueFromGui("youtubeShorts", "", { limit, skipConfirm: true });
}

function resetFailedShortsStatus(itemId = "") {
  const resetItem = (item) => {
    const itemKey = item.id || stableRenderedItemId(item);
    if (itemId && itemKey !== itemId && item.id !== itemId) return item;
    if (!isFailedYouTubeShortItem(item)) return item;
    return {
      ...item,
      youtubeShortPublishStatus: "",
      youtubeShortPublishError: ""
    };
  };
  state.publishingQueue = state.publishingQueue.map(resetItem);
  state.postingPlan = state.postingPlan.map(resetItem);
  save();
  syncPostingPlanToBackend();
  renderPublishingQueue();
  renderPostingPlan();
  renderPublishTimeline();
  renderMetaQueueSummary();
  renderDashboard();
  const message = itemId ? "Reset the selected failed Shorts status. It can be retried when due." : "Reset failed Shorts statuses. Due items can be retried by the normal publisher.";
  setStatus("#apiPublishStatus", message);
}

function getPublishSourceItems() {
  const merged = new Map();
  state.postingPlan.map((item, index) => normalizePublishItem(item, getPostingSettings(), index)).forEach((item) => {
    merged.set(item.id, item);
  });
  state.publishingQueue.map((item, index) => normalizePublishItem(item, getPostingSettings(), index)).forEach((item) => {
    merged.set(item.id, { ...merged.get(item.id), ...item });
  });
  return [...merged.values()];
}

function mergePublishResultsIntoStores(items) {
  const settings = getPostingSettings();
  const byId = new Map(items.map((item, index) => [item.id, normalizePublishItem(item, settings, index)]));
  state.publishingQueue = state.publishingQueue
    .map((item) => byId.get(item.id) || item)
    .filter((item) => item.status !== "posted" && item.publishStatus !== "published");
  const existingPlan = new Map(state.postingPlan.map((item) => [item.id, item]));
  byId.forEach((item, id) => {
    existingPlan.set(id, { ...existingPlan.get(id), ...item });
  });
  state.postingPlan = [...existingPlan.values()].sort((a, b) => new Date(a.scheduledFor || 0) - new Date(b.scheduledFor || 0));
  syncPostingPlanToBackend();
}

function mergeYouTubeVideoPublishResults(items) {
  const byId = new Map(items.map((item) => [item.id, normalizeReview(item)]));
  state.youtubeVideoReviews = state.youtubeVideoReviews.map((item) => byId.get(item.id) || item);
  byId.forEach((item, id) => {
    if (!state.youtubeVideoReviews.some((entry) => entry.id === id)) {
      state.youtubeVideoReviews.push(item);
    }
  });
  syncYouTubeVideoPlanToBackend();
}

async function syncPostingPlanToBackend() {
  try {
    const result = await postBackend("/api/posting-plan", {
      profileId: state.activeProfileId,
      items: state.postingPlan
    });
    if (result.guarded && Array.isArray(result.items)) {
      state.postingPlan = result.items.map((item) => normalizePublishItem(item, getPostingSettings()));
      save();
      renderPostingPlan();
      renderPublishingQueue();
      renderDashboard();
    }
    await syncYouTubeVideoPlanToBackend();
  } catch {
    // The backend may be closed; local browser storage still keeps the plan.
  }
}

function applyScheduleToYouTubeVideos(items) {
  const scheduleByKey = new Map();
  state.postingPlan.forEach((item) => {
    const keys = [
      item.id,
      item.isrc,
      `${item.title || ""}|${item.album || ""}`.toLowerCase()
    ].filter(Boolean);
    keys.forEach((key) => scheduleByKey.set(key, {
      scheduledFor: item.scheduledFor || "",
      destinations: normalizeDestinations(item.destinations)
    }));
  });

  return items.filter(isYouTubeFullTrackReview).map((item) => {
    const key = [item.id, item.isrc, `${item.title || ""}|${item.album || ""}`.toLowerCase()]
      .find((candidate) => candidate && scheduleByKey.has(candidate));
    if (!key) return { ...item, destinations: normalizeDestinations(item.destinations) };
    const source = scheduleByKey.get(key);
    return {
      ...item,
      scheduledFor: source.scheduledFor || item.scheduledFor || "",
      destinations: source.destinations
    };
  });
}

function isYouTubeFullTrackReview(item = {}) {
  const video = String(item.video || item.Video || "").replace(/\\/g, "/").toLowerCase();
  const template = String(item.template || item.Template || "").toLowerCase();
  return video.includes("/rendered-youtube-videos/")
    && (!template || ["youtube-full-track", "youtube-full-album"].includes(template));
}

async function syncYouTubeVideoPlanToBackend() {
  try {
    const items = applyScheduleToYouTubeVideos(state.youtubeVideoReviews);
    state.youtubeVideoReviews = items;
    const result = await postBackend("/api/youtube/video-plan", { profileId: state.activeProfileId, items });
    if (result.guarded && Array.isArray(result.items)) {
      state.youtubeVideoReviews = result.items.map((item) => normalizeReview(item));
      save();
    }
  } catch {
    // The backend may be closed; local browser storage still keeps the YouTube plan.
  }
}

function setPublishControls(isRunning) {
  publishInFlight = isRunning;
  const dueButton = $("#publishDueContainers");
  const autoButton = $("#toggleAutoPublisher");
  const resendButtons = [
    "#resendMeta",
    "#resendYouTubeShorts",
    "#resendYouTubeVideo",
    ".resend-item"
  ].flatMap((selector) => [...document.querySelectorAll(selector)]);
  const coolingDown = publishRetryReadyAt && Date.now() < publishRetryReadyAt;
  if (dueButton) dueButton.disabled = isRunning || coolingDown;
  if (autoButton) autoButton.disabled = isRunning;
  resendButtons.forEach((button) => {
    button.disabled = isRunning;
  });
}

function publishResultMessage(result) {
  if (!result) return "Publish check finished.";
  const base = result.message || "Publish check finished.";
  if (result.outcomeSummary) return `${base.replace(/\s*First skip:.*$/i, "")} ${result.outcomeSummary}`.trim();
  const errors = collectPublishErrors(result);
  if (errors.length) {
    const first = errors[0];
    return `${base} Fix this first: ${first.reason}`;
  }
  if (result.publishedCount > 0) return base;
  if (Array.isArray(result.skipReasons) && result.skipReasons.length) {
    const first = result.skipReasons[0];
    if (/still processing/i.test(first.reason)) {
      return `${base} ${first.item}: ${first.reason}`;
    }
    return `${base} ${first.item}: ${first.reason}.`;
  }
  if (result.youtubeVideoResult || /YouTube full video|full-track YouTube/i.test(base)) return base;
  return `${base} Check the first queue item has a public video URL and a scheduled time in the past.`;
}

function collectPublishErrors(result = {}) {
  return [
    ...(Array.isArray(result.errors) ? result.errors : []),
    ...(Array.isArray(result.metaResult?.errors) ? result.metaResult.errors : []),
    ...(Array.isArray(result.shortsResult?.errors) ? result.shortsResult.errors : []),
    ...(Array.isArray(result.youtubeVideoResult?.errors) ? result.youtubeVideoResult.errors : [])
  ].filter((entry) => entry && entry.reason);
}

function publishPlatformProgressSummary(result = {}) {
  const summaries = [];
  const addSummary = (label, destinationResult) => {
    if (!destinationResult) return;
    const published = Number(destinationResult.publishedCount) || 0;
    const skipped = Number(destinationResult.skippedCount) || 0;
    const failed = Number(destinationResult.errorCount) || (Array.isArray(destinationResult.errors) ? destinationResult.errors.length : 0);
    const bits = [`${published} pushed`];
    if (skipped) bits.push(`${skipped} skipped`);
    if (failed) bits.push(`${failed} failed`);
    summaries.push(`${label}: ${bits.join(", ")}`);
  };

  addSummary("Instagram/Facebook", result.metaResult);
  addSummary("YouTube Shorts", result.shortsResult);
  addSummary("YouTube full", result.youtubeVideoResult);

  if (summaries.length) return summaries.join(" | ");

  const published = Number(result.publishedCount) || 0;
  const skipped = Number(result.skippedCount) || (Array.isArray(result.skipReasons) ? result.skipReasons.length : 0);
  const failed = Number(result.errorCount) || collectPublishErrors(result).length;
  if (published || skipped || failed) {
    const bits = [`${published} pushed`];
    if (skipped) bits.push(`${skipped} skipped`);
    if (failed) bits.push(`${failed} failed`);
    return bits.join(", ");
  }

  return "No due uploads were ready to publish.";
}

function totalPublishedAcrossDestinations(result = {}) {
  return [
    result.publishedCount,
    result.metaResult?.publishedCount,
    result.shortsResult?.publishedCount,
    result.youtubeVideoResult?.publishedCount
  ].reduce((total, value) => total + (Number(value) || 0), 0);
}

function startPublishProgress(message) {
  publishStartedAt = Date.now();
  setPublishProgress({ mode: "running", message, percent: 8 });
  if (publishProgressTimer) clearInterval(publishProgressTimer);
  publishProgressTimer = setInterval(() => {
    const elapsedMs = Date.now() - publishStartedAt;
    const percent = Math.min(88, 8 + Math.floor(elapsedMs / 1200) * 4);
    setPublishProgress({
      mode: "running",
      message,
      percent,
      elapsedMs
    });
  }, 1000);
}

function stopPublishProgressTimer() {
  if (publishProgressTimer) clearInterval(publishProgressTimer);
  publishProgressTimer = null;
}

function handlePublishResultProgress(result = {}) {
  const processing = findProcessingOutcome(result);
  const elapsedMs = publishStartedAt ? Date.now() - publishStartedAt : 0;
  if (processing) {
    startPublishRetryCountdown(processing.item || "Current Reel", 3 * 60 * 1000, elapsedMs);
    return;
  }

  clearPublishRetryCountdown();
  const errors = collectPublishErrors(result);
  if (result.errorCount > 0 || errors.length) {
    const first = errors[0];
    setPublishProgress({
      mode: "error",
      message: `${publishPlatformProgressSummary(result)}${first ? ` | Fix: ${first.reason}` : ""}`,
      percent: 100,
      elapsedMs
    });
    return;
  }

  const published = totalPublishedAcrossDestinations(result);
  setPublishProgress({
    mode: published > 0 ? "complete" : "idle",
    message: publishPlatformProgressSummary(result),
    percent: published > 0 ? 100 : 0,
    elapsedMs
  });
}

function findProcessingOutcome(result = {}) {
  const all = [
    ...(Array.isArray(result.skipReasons) ? result.skipReasons : []),
    ...(Array.isArray(result.outcomes) ? result.outcomes.map((entry) => ({ item: entry.item, reason: entry.result })) : [])
  ];
  return all.find((entry) => /still processing|try publish due now again|media id is not available/i.test(entry.reason || ""));
}

function startPublishRetryCountdown(item, waitMs, elapsedMs = 0) {
  publishRetryReadyAt = Date.now() + waitMs;
  updatePublishRetryProgress(item, elapsedMs);
  if (publishRetryTimer) clearInterval(publishRetryTimer);
  publishRetryTimer = setInterval(() => updatePublishRetryProgress(item, elapsedMs), 1000);
}

function updatePublishRetryProgress(item = "Current Reel", elapsedMs = 0) {
  const remaining = Math.max(0, publishRetryReadyAt - Date.now());
  if (remaining <= 0) {
    clearPublishRetryCountdown(false);
    setPublishProgress({
      mode: "ready",
      message: `${item} should be ready to try again.`,
      percent: 100,
      elapsedMs
    });
    setPublishControls(false);
    return;
  }

  const total = 3 * 60 * 1000;
  const percent = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
  setPublishProgress({
    mode: "waiting",
    message: `${item} is processing at Meta. Try again in ${formatDuration(remaining)}.`,
    percent,
    elapsedMs
  });
  setPublishControls(false);
}

function clearPublishRetryCountdown(resetProgress = true) {
  if (publishRetryTimer) clearInterval(publishRetryTimer);
  publishRetryTimer = null;
  publishRetryReadyAt = 0;
  if (resetProgress) setPublishControls(false);
}

function setPublishProgress({ mode = "idle", message = "Publisher idle", percent = 0, elapsedMs = 0 } = {}) {
  const bar = $("#publishProgressBar");
  const label = $("#publishProgressLabel");
  const button = $("#publishDueContainers");
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (bar) {
    bar.style.width = `${safePercent}%`;
    bar.dataset.mode = mode;
  }
  if (label) {
    const elapsed = elapsedMs > 0 ? ` | Elapsed: ${formatDuration(elapsedMs)}` : "";
    label.textContent = `${message}${elapsed}`;
  }
  if (button) {
    if (mode === "waiting") {
      button.textContent = "Waiting for Meta";
      button.classList.add("cooldown");
      button.classList.remove("ready");
    } else if (mode === "ready") {
      button.textContent = "Publish due now";
      button.classList.add("ready");
      button.classList.remove("cooldown");
    } else {
      button.textContent = publishInFlight ? "Publishing..." : "Publish due now";
      button.classList.remove("cooldown", "ready");
    }
  }
}

function getNextPublishItem(items = state.publishingQueue) {
  return items
    .filter((item) => (item.containerId || item.publicVideoUrl) && item.status !== "posted" && item.status !== "held" && item.publishStatus !== "published")
    .sort((a, b) => new Date(a.scheduledFor || 0).getTime() - new Date(b.scheduledFor || 0).getTime())[0] || null;
}

function getDuePublishItems(items = state.publishingQueue) {
  const now = Date.now();
  return items.filter((item) => {
    if (!(item.containerId || item.publicVideoUrl)) return false;
    if (item.status === "posted" || item.status === "held" || item.publishStatus === "published") return false;
    const scheduled = new Date(item.scheduledFor || 0).getTime();
    return scheduled && scheduled <= now;
  });
}

function mergePublishingResults(items) {
  const byId = new Map(items.map((item) => [item.id, normalizePublishItem(item, getPostingSettings())]));
  state.publishingQueue = state.publishingQueue.map((item) => byId.get(item.id) || item);
  for (const [id, item] of byId) {
    if (!state.publishingQueue.some((entry) => entry.id === id)) {
      state.publishingQueue.push(item);
    }
  }
  save();
  renderPublishingQueue();
}

function toggleAutoPublisher() {
  const button = $("#toggleAutoPublisher");
  if (autoPublisherTimer) {
    clearInterval(autoPublisherTimer);
    autoPublisherTimer = null;
    if (button) button.textContent = "Start auto publisher";
    setStatus("#apiPublishStatus", "Auto publisher stopped.");
    renderPublishTimeline();
    return;
  }

  autoPublisherTimer = setInterval(() => publishDueFromGui(), 3 * 60 * 60 * 1000);
  if (button) button.textContent = "Stop auto publisher";
  setStatus("#apiPublishStatus", "Auto publisher running every 3 hours. Keep this dashboard and backend open.");
  renderPublishTimeline();
  publishDueFromGui();
}

async function postBackend(path, payload) {
  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let result = {};
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      result = { message: text.slice(0, 600) || "Backend returned an unreadable response." };
    }
    if (!response.ok || result.error) {
      const error = new Error(result.message || result.error || "Backend request failed.");
      logAppEvent("error", error.message, { path, status: response.status, result });
      error.logged = true;
      throw error;
    }
    return result;
  } catch (error) {
    if (!error.logged) logAppEvent("error", error.message || "Backend request failed.", { path, error });
    throw error;
  }
}

async function openUrlInChrome(url, statusSelector = "") {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target)) {
    if (target.startsWith("#")) location.hash = target.slice(1);
    return { ok: false, message: "Only web links are opened through Chrome." };
  }
  try {
    const result = await postBackend("/api/open-url", { url: target });
    if (statusSelector) setStatus(statusSelector, result.message || "Opened in Chrome.");
    return result;
  } catch (error) {
    try {
      await navigator.clipboard.writeText(target);
      if (statusSelector) setStatus(statusSelector, `Could not open Chrome automatically. Link copied: paste it into Chrome. ${error.message || ""}`.trim());
    } catch {
      if (statusSelector) setStatus(statusSelector, `Could not open Chrome automatically. Copy this link into Chrome: ${target}`);
    }
    return { ok: false, message: error.message || "Could not open Chrome.", url: target };
  }
}

function bindChromeOpeners(root = document) {
  root.querySelectorAll(".open-chrome-link").forEach((button) => {
    if (button.dataset.chromeBound === "true") return;
    button.dataset.chromeBound = "true";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      openUrlInChrome(button.dataset.url || button.href || "", button.dataset.statusSelector || "#metaHealthSummary");
    });
  });
}

function installExternalChromeLinkHandler() {
  document.addEventListener("click", (event) => {
    const link = event.target?.closest?.("a");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (!/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    openUrlInChrome(href, link.dataset.statusSelector || "");
  });
}

function setStatus(selector, message) {
  const target = $(selector);
  if (target) target.textContent = message;
  if (shouldLogStatus(message)) {
    logAppEvent("warn", message, { selector });
  }
}

function setText(selector, message) {
  const target = $(selector);
  if (target) target.textContent = message;
}

function formatMetricNumber(value) {
  return Number(value || 0).toLocaleString();
}

function renderYouTubePerformance() {
  const snapshot = state.youtubePerformance || {};
  const insights = snapshot.insights || {};
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const status = $("#performanceStatus");
  if (status) {
    status.textContent = state.youtubePerformanceLoading
      ? "Syncing YouTube stats from the local published history..."
      : snapshot.message || "Sync uploaded Shorts and YouTube videos to see what is working.";
  }
  setText("#performanceVideoCount", formatMetricNumber(insights.totalVideos || items.length));
  setText("#performanceTotalViews", formatMetricNumber(insights.totalViews || 0));
  setText("#performanceAverageViews", formatMetricNumber(insights.averageViews || 0));
  setText("#performanceLastSync", snapshot.syncedAt ? formatSchedule(snapshot.syncedAt) : "Never");

  const top = $("#performanceTopVideos");
  if (top) {
    const videos = Array.isArray(insights.topVideos) ? insights.topVideos : [];
    top.innerHTML = videos.length ? videos.map((item, index) => `
      <article class="performance-row">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.title || "Untitled upload")}</strong>
          <small>${escapeHtml(performanceSubtitle(item))}</small>
        </div>
        <em>${formatMetricNumber(item.views)} views</em>
      </article>
    `).join("") : `<p class="note">No YouTube stats synced yet.</p>`;
  }

  const recommendations = $("#performanceRecommendations");
  if (recommendations) {
    const notes = Array.isArray(insights.recommendations) ? insights.recommendations : [];
    recommendations.innerHTML = notes.length ? notes.map((note) => `
      <article class="performance-note">${escapeHtml(note)}</article>
    `).join("") : `<p class="note">Recommendations appear after YouTube stats are synced.</p>`;
  }

  renderPerformanceAggregate("#performanceByContentFormat", insights.byContentFormat, "format");
  renderPerformanceAggregate("#performanceByCreativeSource", insights.byCreativeSource, "creative source");
  renderPerformanceAggregate("#performanceByVisual", insights.byVisual, "visual type");
  renderPerformanceAggregate("#performanceByPexelsTerm", insights.byPexelsTerm, "Pexels/search cue");
  renderPerformanceAggregate("#performanceByAlbum", insights.byAlbum, "album");
  renderPerformanceAggregate("#performanceByStyle", insights.byStyle, "style");
  renderPerformanceAggregate("#performanceByInstrument", insights.byInstrument, "instrument");
  renderPerformanceAggregate("#performanceByDescription", insights.byDescriptionMode, "description mode");
  renderPerformanceUploadDetail(items);
}

function performanceSubtitle(item = {}) {
  return [
    item.album,
    item.contentFormat || item.platform,
    item.creativeSource,
    item.variantLabel || item.variantRole
  ].filter(Boolean).join(" | ") || "YouTube";
}

function renderPerformanceUploadDetail(items = []) {
  const target = $("#performanceUploadDetail");
  if (!target) return;
  const rows = Array.isArray(items) ? items.slice(0, 40) : [];
  if (!rows.length) {
    target.innerHTML = `<p class="note">Detailed upload metadata appears after a stats sync.</p>`;
    return;
  }
  target.innerHTML = rows.map((item) => `
    <article class="performance-detail-card">
      <div class="performance-detail-head">
        <div>
          <strong>${escapeHtml(item.title || "Untitled upload")}</strong>
          <small>${escapeHtml(performanceSubtitle(item))}</small>
        </div>
        <em>${formatMetricNumber(item.views)} views</em>
      </div>
      <div class="performance-tags">
        ${performanceTag(item.contentFormat)}
        ${performanceTag(item.creativeSource)}
        ${performanceTag(item.albumThemeStyle)}
        ${performanceTag(item.shortTypeLabel)}
        ${performanceTag(item.descriptionModeLabel)}
      </div>
      <dl>
        <div><dt>Pexels/search terms</dt><dd>${escapeHtml(item.pexelsSearchTerms || item.visualSearchTerms || item.albumThemeSearchTerms || "Not recorded")}</dd></div>
        <div><dt>Visual source</dt><dd>${escapeHtml(item.pexelsSourceUrl || item.visualSourceUrl || item.visualSourceName || item.visualSourceStatus || "Not recorded")}</dd></div>
        <div><dt>Theme basis</dt><dd>${escapeHtml(item.visualThemeBasis || [item.albumThemeMood, item.albumTheme, item.albumThemeScene, item.albumThemeInstruments].filter(Boolean).join(" | ") || "Not recorded")}</dd></div>
      </dl>
      ${item.youtubeUrl ? `<a href="${escapeHtml(item.youtubeUrl)}" target="_blank" rel="noreferrer">Open YouTube upload</a>` : ""}
    </article>
  `).join("");
}

function performanceTag(value) {
  return value ? `<span>${escapeHtml(value)}</span>` : "";
}

function renderPerformanceAggregate(selector, rows = [], label = "group") {
  const target = $(selector);
  if (!target) return;
  if (!Array.isArray(rows) || !rows.length) {
    target.innerHTML = `<p class="note">No ${escapeHtml(label)} data yet.</p>`;
    return;
  }
  target.innerHTML = rows.slice(0, 8).map((item) => `
    <article class="performance-row compact">
      <div>
        <strong>${escapeHtml(item.label || "Unknown")}</strong>
        <small>${formatMetricNumber(item.count)} upload${Number(item.count || 0) === 1 ? "" : "s"}</small>
      </div>
      <em>${formatMetricNumber(item.averageViews)} avg</em>
    </article>
  `).join("");
}

async function loadYouTubePerformance(showStatus = true) {
  state.youtubePerformanceLoading = true;
  if (showStatus) setStatus("#performanceStatus", "Loading saved YouTube performance snapshot...");
  renderYouTubePerformance();
  try {
    const response = await fetch(`${backendUrl}/api/performance/youtube?profileId=${encodeURIComponent(state.activeProfileId)}`);
    const result = await response.json();
    state.youtubePerformance = result;
    setStatus("#performanceStatus", result.message || "Loaded YouTube performance snapshot.");
  } catch (error) {
    state.youtubePerformance = {
      ok: false,
      message: "Backend is not running. Reopen the app with the launcher, then try Performance again.",
      items: [],
      insights: {}
    };
    setStatus("#performanceStatus", state.youtubePerformance.message);
  } finally {
    state.youtubePerformanceLoading = false;
    renderYouTubePerformance();
  }
}

async function syncYouTubePerformanceFromGui() {
  state.youtubePerformanceLoading = true;
  setStatus("#performanceStatus", "Syncing YouTube stats. If this is the first sync, Google may ask you to reconnect OAuth once.");
  renderYouTubePerformance();
  try {
    const result = await postBackend("/api/performance/youtube/sync", {
      profileId: state.activeProfileId
    });
    state.youtubePerformance = result;
    setStatus("#performanceStatus", result.message || (result.ok ? "YouTube stats synced." : "YouTube stats sync failed."));
  } catch (error) {
    state.youtubePerformance = {
      ok: false,
      message: `YouTube stat sync failed: ${error.message || "Check OAuth credentials and backend status."}`,
      items: [],
      insights: {}
    };
    setStatus("#performanceStatus", state.youtubePerformance.message);
  } finally {
    state.youtubePerformanceLoading = false;
    renderYouTubePerformance();
  }
}

function renderPerformanceGeneratePreset() {
  const preset = state.performanceGeneratePreset;
  const summary = $("#performanceGeneratePresetSummary");
  const status = $("#performanceGeneratePresetStatus");
  const clearButton = $("#clearPerformanceGeneratePreset");
  if (!summary) return;

  if (!preset?.ok) {
    summary.innerHTML = `
      <div class="empty-state compact">
        <strong>No stats preset active</strong>
        <span>Sync Performance, then use this preset to bias the next batch toward what is already working.</span>
      </div>
    `;
    if (status) status.textContent = "Normal generation is active.";
    if (clearButton) clearButton.disabled = true;
    return;
  }

  if (clearButton) clearButton.disabled = false;
  const basis = Array.isArray(preset.basisVideos) ? preset.basisVideos.slice(0, 3) : [];
  const albums = Array.isArray(preset.preferredAlbums) ? preset.preferredAlbums.slice(0, 4) : [];
  const terms = Array.isArray(preset.preferredSearchTerms)
    ? preset.preferredSearchTerms.slice(0, 5).map((item) => item.label || item)
    : [];
  const focus = Array.isArray(preset.focusList) ? preset.focusList.slice(0, 6) : [];
  if (status) {
    status.textContent = `${preset.presetName || "Active preset"} created ${formatSchedule(preset.createdAt)}. Next Generate batch will be performance-led.`;
  }
  summary.innerHTML = `
    <div class="preset-active-head">
      <strong>${escapeHtml(preset.presetName || "Performance preset")}</strong>
      <span>${escapeHtml(preset.mode || "performance-led")}</span>
    </div>
    <div class="preset-pill-row">
      ${albums.map((album) => `<span>${escapeHtml(album)}</span>`).join("")}
      ${terms.map((term) => `<span>${escapeHtml(term)}</span>`).join("")}
    </div>
    ${focus.length ? `
      <div class="preset-focus-list">
        <strong>Keep Shorts focused on</strong>
        <div>${focus.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      </div>
    ` : ""}
    <div class="preset-basis-list">
      ${basis.map((item) => `
        <article>
          <strong>${escapeHtml(item.title || "Untitled upload")}</strong>
          <span>${formatMetricNumber(item.views)} views${item.viewsPerDay ? ` | ${Number(item.viewsPerDay).toFixed(1)}/day` : ""}${item.album ? ` | ${escapeHtml(item.album)}` : ""}</span>
        </article>
      `).join("")}
    </div>
    <p>${escapeHtml(preset.metricsBasis || "Currently weighted by views, views/day, likes, and comments.")}</p>
  `;
}

async function applyPerformanceGeneratePresetFromGui() {
  setStatus("#performanceGeneratePresetStatus", "Reading Performance stats and building a generate preset...");
  try {
    const settings = getPostingSettings();
    const result = await postBackend("/api/performance/generate-preset", {
      profileId: state.activeProfileId,
      count: settings.renderBatchSize,
      mode: "best-performing"
    });
    if (!result.ok) {
      setStatus("#performanceGeneratePresetStatus", result.message || "Could not create a performance preset.");
      return;
    }
    state.performanceGeneratePreset = result;
    applyPerformanceRecommendedSettings(result.recommendedSettings || {});
    save();
    renderPerformanceGeneratePreset();
    setStatus("#renderBatchStatus", `${result.presetName || "Best Performing preset"} is active. Create batch will now use the current top Shorts as its basis.`);
  } catch (error) {
    setStatus("#performanceGeneratePresetStatus", `Performance preset failed: ${error.message || "Check backend and YouTube stats sync."}`);
  }
}

function applyPerformanceRecommendedSettings(recommended = {}) {
  if ($("#renderPreset") && recommended.renderPreset) $("#renderPreset").value = recommended.renderPreset;
  if ($("#renderBatchSize") && recommended.renderBatchSize) $("#renderBatchSize").value = recommended.renderBatchSize;
  if ($("#shortsPerDay") && recommended.shortsPerTrack) $("#shortsPerDay").value = recommended.shortsPerTrack;
  savePosting();
}

async function refreshBestPerformingPresetOnStartup() {
  const today = toLocalDateTime(new Date()).slice(0, 10);
  const lastRefresh = profileStorageGet("jazzBestPerformingPresetLastRefresh", "");
  if (lastRefresh === today && state.performanceGeneratePreset?.mode === "best-performing" && state.performanceGeneratePreset?.presetDate === today) {
    renderPerformanceGeneratePreset();
    return;
  }

  try {
    const settings = getPostingSettings();
    const syncResult = await postBackend("/api/performance/youtube/sync", {
      profileId: state.activeProfileId
    });
    if (syncResult?.ok) state.youtubePerformance = syncResult;

    const result = await postBackend("/api/performance/generate-preset", {
      profileId: state.activeProfileId,
      count: settings.renderBatchSize,
      mode: "best-performing"
    });
    if (!result?.ok) return;

    state.performanceGeneratePreset = result;
    applyPerformanceRecommendedSettings(result.recommendedSettings || {});
    profileStorageSet("jazzBestPerformingPresetLastRefresh", today);
    save();
    renderPerformanceGeneratePreset();
    renderYouTubePerformance();
    setStatus("#performanceGeneratePresetStatus", `${result.presetName || "Best Performing preset"} refreshed automatically from today's YouTube stats.`);
  } catch (error) {
    logAppEvent("warning", "Best Performing preset auto-refresh failed", { message: error?.message || "" });
    renderPerformanceGeneratePreset();
  }
}

function scheduleBestPerformingPresetRefresh() {
  if (bestPerformanceRefreshTimer) clearInterval(bestPerformanceRefreshTimer);
  bestPerformanceRefreshTimer = setInterval(() => {
    refreshBestPerformingPresetOnStartup();
  }, 60 * 60 * 1000);
}

function clearPerformanceGeneratePresetFromGui() {
  state.performanceGeneratePreset = null;
  save();
  renderPerformanceGeneratePreset();
  setStatus("#renderBatchStatus", "Performance-led preset cleared. Generate is back to normal rotation.");
}

function syncView() {
  const defaultView = state.firstRunComplete ? "dashboard" : "firstRunSetup";
  let requested = (location.hash || `#${defaultView}`).slice(1);
  if (legacyViewRedirects[requested]) {
    requested = legacyViewRedirects[requested];
    history.replaceState(null, "", `#${requested}`);
  }
  if (state.firstRunComplete && requested && !mainViews.has(requested)) {
    requested = defaultView;
    history.replaceState(null, "", `#${requested}`);
  }
  const view = state.firstRunComplete ? (requested || "dashboard") : requested === "settingsSetup" ? "settingsSetup" : requested === "youtubeSetup" ? "youtubeSetup" : requested === "visualSources" ? "visualSources" : requested === "helpStatus" ? "helpStatus" : requested === "firstRunSetup" ? "firstRunSetup" : "firstRunSetup";
  document.querySelectorAll(".view-section").forEach((section) => {
    const sectionView = section.dataset.view;
    if (!sectionView) {
      section.hidden = view !== "posting";
      return;
    }
    section.hidden = sectionView !== view;
  });

  document.querySelectorAll("nav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === `#${view}`);
  });

  if (!mainViews.has(view)) {
    const settings = $("#settingsSetup");
    if (settings) settings.hidden = false;
  }
  renderFirstRunWizard();
  renderHelpStatus();
  if (view === "albumVideos" && !state.albumVideoAlbums.length) {
    loadAlbumVideoAlbums();
  }
  if (view === "performance" && !state.youtubePerformance && !state.youtubePerformanceLoading) {
    loadYouTubePerformance(false);
  }
}

function renderAll(options = {}) {
  loadBackendHealth();
  renderProfileSelector();
  renderStats();
  renderReviews();
  renderYouTubeVideoReviews();
  renderAlbumVideos();
  renderSongFactory();
  renderPublishingQueue();
  renderPostingPlan();
  renderPostingCommand();
  renderSetupLibrarySummary();
  renderInstagramSetup();
  renderYouTubeSetup();
  renderVisualSources();
  renderYouTubePerformance();
  renderPerformanceGeneratePreset();
  renderTokenHealth();
  renderStartupStatus();
  renderUserConfigStatus();
  renderHelpStatus();
  renderProfileWorkspaceStatus();
  if (options.syncBackend !== false) {
    syncPostingPlanToBackend();
  }
  loadPublishingHistory();
  syncView();
}

on("#profileSelector", "change", (event) => {
  switchProfile(event.target.value);
});

$("#manifestInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text);
    importReviews(Array.isArray(parsed) ? parsed : parsed.items || []);
  } else {
    const rows = parseCsv(text);
    const headers = rows[0] || [];
    const items = rows.slice(1).filter((row) => row.some(Boolean)).map((row) =>
      headers.reduce((record, header, index) => {
        record[header] = row[index] || "";
        return record;
      }, {})
    );
    importReviews(items);
  }
});

document.querySelectorAll("[data-review-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-review-filter]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.reviewFilter = button.dataset.reviewFilter;
    renderReviews();
  });
});

document.querySelectorAll("[data-library-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-library-filter]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.libraryIssueFilter = button.dataset.libraryFilter || "all";
    renderLibraryIssues();
  });
});

on("#exportApproved", "click", exportApproved);
on("#loadLatestBatchFlow", "click", loadLatestBatchIntoReview);
on("#restoreReviewCache", "click", () => loadReviewCacheFromBackend({ silent: false, replaceExisting: true }));
on("#sendApprovedToQueueFlow", "click", sendApprovedToPublishingQueue);
on("#approveVisibleReviews", "click", () => updateVisibleReviewStatuses("approved"));
on("#rejectVisibleReviews", "click", () => updateVisibleReviewStatuses("rejected"));
on("#clearReviews", "click", () => {
  if (!confirm("Clear imported review items from this browser?")) return;
  state.reviews = [];
  save();
  renderReviews();
  syncReviewCacheToBackend("clear-review");
});

on("#savePosting", "click", () => {
  state.posting = getPostingSettings();
  savePosting();
  renderPostingCommand();
});

on("#exportPosting", "click", () => {
  downloadJson("posting-settings.json", getPostingSettings());
});

on("#createReviewBatchFlow", "click", createReviewBatchFromGui);
on("#stopReviewBatch", "click", stopReviewBatchFromGui);
on("#generateSongFactoryPlan", "click", generateSongFactoryPlan);
on("#copySongFactoryPrompts", "click", copySongFactoryPrompts);
on("#exportSongFactoryPromptsTxt", "click", exportSongFactoryPromptsTxt);
on("#exportSongFactoryTracklist", "click", exportSongFactoryTracklist);
on("#exportSongFactoryCsv", "click", exportSongFactoryCsv);
on("#exportSongFactoryJson", "click", exportSongFactoryJson);
on("#recallSongFactoryPlan", "click", recallSongFactoryPlan);
on("#saveSongFactoryCompletedAlbum", "click", saveSongFactoryCompletedAlbum);
on("#openSongFactoryAlbumFolder", "click", openSongFactoryAlbumFolder);
on("#openSongFactorySunoUrl", "click", openSongFactorySunoUrl);
on("#openSongFactoryDownloader", "click", openSongFactoryDownloader);
on("#copySongFactorySunoUrl", "click", copySongFactorySunoUrl);
on("#pickSongFactoryAudioFolder", "click", pickSongFactoryAudioFolder);
on("#pasteSongFactoryAudioFolder", "click", pasteSongFactoryAudioFolder);
on("#convertSongFactoryAudioFiles", "click", convertSongFactoryAudioFiles);
on("#renameSongFactoryAudioFiles", "click", renameSongFactoryAudioFiles);
on("#clearSongFactoryPlan", "click", clearSongFactoryPlan);
on("#songFactoryBaseAlbum", "change", () => {
  const reference = songFactorySelectedAlbumReference();
  if (reference) applySongFactoryAlbumBrief(reference);
});

on("#pickAudioRoot", "click", () => pickSetupFolder("audio"));
on("#pickArtworkRoot", "click", () => pickSetupFolder("artwork"));
on("#pasteAudioRoot", "click", () => pasteFolderPath("audio", false));
on("#pasteArtworkRoot", "click", () => pasteFolderPath("artwork", false));
on("#scanSetupLibrary", "click", scanSetupLibrary);
on("#mergeFolderCatalog", "click", mergeFolderCatalogFromSetup);
on("#saveProfileWorkspace", "click", saveProfileWorkspace);
on("#addProfileWorkspace", "click", addProfileWorkspace);
on("#wizardPickAudioRoot", "click", () => pickFirstRunFolder("audio"));
on("#wizardPickArtworkRoot", "click", () => pickFirstRunFolder("artwork"));
on("#wizardPasteAudioRoot", "click", () => pasteFolderPath("audio", true));
on("#wizardPasteArtworkRoot", "click", () => pasteFolderPath("artwork", true));
on("#wizardScanLibrary", "click", scanFirstRunLibrary);
on("#wizardCheckMeta", "click", checkFirstRunMeta);
on("#wizardCheckVisualSources", "click", checkFirstRunVisualSources);
on("#wizardInstallStartupPublisher", "click", installFirstRunStartupPublisher);
on("#wizardFinishSetup", "click", () => finishFirstRunSetup(false));
on("#wizardSkipSetup", "click", () => finishFirstRunSetup(true));
on("#saveYouTubeSetup", "click", () => {
  state.youtubeSetup = getYouTubeSetup();
  saveYouTubeSetup();
  renderYouTubeSetup();
});
on("#youtubeHealthCheck", "click", loadYouTubeHealth);
on("#startYouTubeOAuth", "click", startYouTubeOAuth);
on("#copyYouTubeOAuthLink", "click", copyYouTubeOAuthLink);
on("#youtubeOAuthLink", "click", (event) => {
  event.preventDefault();
  const authUrl = event.currentTarget?.href || "";
  if (!authUrl || authUrl.endsWith("#")) {
    setStatus("#youtubeSetupStatus", "Press Start Google OAuth first, then open the generated link.");
    return;
  }
  openUrlInChrome(authUrl, "#youtubeSetupStatus");
});
on("#youtubeUploadTest", "click", uploadYouTubeTestShort);
on("#syncYouTubePerformance", "click", syncYouTubePerformanceFromGui);
on("#refreshYouTubePerformance", "click", () => loadYouTubePerformance(true));
on("#applyPerformanceGeneratePreset", "click", applyPerformanceGeneratePresetFromGui);
on("#clearPerformanceGeneratePreset", "click", clearPerformanceGeneratePresetFromGui);
on("#checkPexelsReadiness", "click", loadPexelsReadiness);
on("#searchPexelsVideos", "click", searchPexelsVideos);
on("#clearPexelsApproved", "click", clearPexelsApprovedLibrary);
["setupArtistName", "setupAudioRoot", "setupArtworkRoot"].forEach((id) => {
  const field = $(`#${id}`);
  if (field) field.addEventListener("input", () => {
    state.setupWizard = getSetupWizard();
    saveSetupWizard();
    syncFirstRunFieldsFromSetup();
    renderFirstRunWizard();
  });
});

["wizardArtistName", "wizardAudioRoot", "wizardArtworkRoot"].forEach((id) => {
  const field = $(`#${id}`);
  if (field) field.addEventListener("input", syncSetupFieldsFromFirstRun);
});

["youtubeChannelLabel", "youtubeChannelId", "youtubeDefaultPrivacy", "youtubeMadeForKids", "youtubeUploadShorts", "youtubeBackendRequired"].forEach((id) => {
  const field = $(`#${id}`);
  if (field) field.addEventListener("input", () => {
    state.youtubeSetup = getYouTubeSetup();
    saveYouTubeSetup();
    renderYouTubeSetup();
  });
});

$("#approvedInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  importPublishingQueue(parsed.items || [], parsed.postingSettings || getPostingSettings());
});

on("#loadApprovedFromReview", "click", sendApprovedToPublishingQueue);
on("#uploadApprovedToR2", "click", uploadApprovedToR2FromGui);
on("#stopR2Upload", "click", stopUploadFromGui);
on("#refreshScheduleState", "click", () => refreshScheduleState());
on("#publishDueContainers", "click", () => publishDueFromGui());
on("#resendMeta", "click", () => resendDueFromGui("meta"));
on("#resendYouTubeShorts", "click", () => resendDueFromGui("youtubeShorts"));
on("#resendYouTubeVideo", "click", () => resendDueFromGui("youtubeVideo"));
on("#toggleAutoPublisher", "click", toggleAutoPublisher);
on("#syncLatestUpload", "click", syncLatestUploadedPackage);
on("#autoFillApprovedSchedule", "click", autoFillApprovedSchedule);
on("#cleanupR2Uploads", "click", cleanupUnusedR2Uploads);
on("#refreshAlbumVideos", "click", loadAlbumVideoAlbums);
on("#albumVideoAlbumSelect", "change", (event) => {
  setAlbumVideoActiveAlbum(event.target.value);
  renderAlbumVideos();
});
on("#renderAlbumVideoTest", "click", startAlbumVideoTestRenderFromGui);
on("#renderSelectedAlbumVideos", "click", startAlbumVideoRenderFromGui);
on("#stopAlbumVideoRender", "click", stopAlbumVideoRenderFromGui);
on("#uploadAlbumVideos", "click", uploadAlbumVideosFromGui);
on("#compileFullAlbumVideo", "click", compileFullAlbumVideoFromGui);
on("#approveAllAlbumVideos", "click", () => updateAllAlbumVideoStatuses("approved"));
on("#rejectAllAlbumVideos", "click", () => updateAllAlbumVideoStatuses("rejected"));
on("#cleanupPartialAlbumVideos", "click", cleanupPartialAlbumVideosFromGui);
on("#clearAlbumVideos", "click", () => {
  const album = state.albumVideoActiveAlbum || selectedAlbumVideoAlbum()?.album || "this album";
  if (!confirm(`Clear the album-video review queue for "${album}" from this browser? Rendered MP4 files will stay on disk.`)) return;
  state.albumVideoItems = [];
  saveCurrentAlbumVideoQueue();
  renderAlbumVideos();
  setStatus("#albumVideoStatus", `Album-video review queue cleared for ${album}.`);
});
$("#clearPublishingQueue").addEventListener("click", () => {
  if (!confirm("Clear the publishing queue from this browser?")) return;
  state.publishingQueue = [];
  save();
  renderPublishingQueue();
  renderDashboard();
  setStatus("#apiPublishStatus", "Active staging queue cleared. Saved schedule and history were kept.");
});
on("#resetSchedulePipeline", "click", resetSchedulePipeline);

on("#clearPostingPlan", "click", async () => {
  if (!confirm("Clear the saved posting plan from this browser?")) return;
  state.postingPlan = [];
  save();
  renderPostingPlan();
  renderPublishingQueue();
  renderDashboard();
  try {
    await postBackend("/api/posting-plan", {
      profileId: state.activeProfileId,
      items: [],
      allowEmpty: true,
      reason: "clear"
    });
    await postBackend("/api/youtube/video-plan", {
      profileId: state.activeProfileId,
      items: [],
      allowEmpty: true,
      reason: "clear"
    });
  } catch {
    // Local schedule was cleared; backend may be closed.
  }
  setStatus("#apiPublishStatus", "Saved schedule cleared. Published history was kept.");
});
on("#refreshPublishingHistory", "click", loadPublishingHistory);
on("#refreshMetaHistory", "click", loadMetaHistory);
on("#clearPublishingHistory", "click", clearPublishingHistory);
on("#refreshTokenHealth", "click", loadTokenHealth);
on("#instagramSetupHealthCheck", "click", loadTokenHealth);
on("#startMetaOAuth", "click", startMetaOAuth);
on("#saveMetaEnvFromApp", "click", saveMetaEnvFromApp);
on("#refreshHelpStatus", "click", async () => {
  setText("#helpOverallTitle", "Refreshing status...");
  await Promise.allSettled([loadBackendHealth(), loadTokenHealth(), loadYouTubeHealth(), loadStartupStatus(), loadPublishingHistory()]);
  renderHelpStatus();
});
on("#exportErrorReport", "click", exportErrorReport);
on("#clearErrorLog", "click", clearErrorLog);
on("#previewLocalCleanup", "click", previewLocalCleanup);
on("#runLocalCleanup", "click", runLocalCleanup);
on("#installStartupPublisher", "click", () => runStartupAction("install"));
on("#uninstallStartupPublisher", "click", () => runStartupAction("uninstall"));
on("#runStartupPublisherTest", "click", () => runStartupAction("test"));
on("#installStartupDashboard", "click", () => runStartupAction("dashboardInstall"));
on("#uninstallStartupDashboard", "click", () => runStartupAction("dashboardUninstall"));
on("#dashboardDoToday", "click", () => {
  location.hash = "publishingQueue";
  publishDueFromGui();
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.(".dashboard-open-local");
  if (!button) return;
  const path = button.dataset.openPath || "";
  if (!path) return;
  button.disabled = true;
  try {
    await postBackend("/api/open-path", { path });
  } catch (error) {
    alert(`Could not open file. ${error?.message || ""}`.trim());
  } finally {
    button.disabled = false;
  }
});
on("#restartFirstRunSetup", "click", () => {
  saveFirstRunComplete(false);
  syncFirstRunFieldsFromSetup();
  location.hash = "firstRunSetup";
  syncView();
});
on("#saveUserConfigNow", "click", async () => {
  setStatus("#userConfigPath", "Saving local user config...");
  await persistUserConfigToBackend();
  renderUserConfigStatus();
});

[
  "publishMode",
  "requirePreview",
  "skipFallbackAudio",
  "igAccount",
  "defaultPostType",
  "publishOriginalAudio",
  "captionStyle",
  "hashtagSet",
  "postingTimezone",
  "postingWindow",
  "maxPostsPerDay",
  "shortsPerDay",
  "shortScheduleTimes",
  "mixReels",
  "mixStories",
  "mixFeed",
  "postingCooldown",
  "renderBatchSize",
  "renderPreset",
  "renderMinSeconds",
  "renderMaxSeconds",
  "renderFadeSeconds"
].forEach((id) => {
  const field = $(`#${id}`);
  if (field) {
    field.addEventListener("input", () => {
      savePosting();
      renderPostingCommand();
    });
  }
});

$("#saveInstagramSetup").addEventListener("click", () => {
  state.instagramSetup = getInstagramSetup();
  saveInstagramSetup();
  renderInstagramSetup();
});

$("#exportInstagramSetup").addEventListener("click", () => {
  downloadJson("instagram-setup-config.json", getInstagramSetup());
});

window.addEventListener("hashchange", syncView);
window.addEventListener("error", (event) => {
  logAppEvent("error", event.message || "Browser error", {
    source: event.filename || "",
    line: event.lineno || 0,
    column: event.colno || 0,
    error: event.error || null
  });
});
window.addEventListener("unhandledrejection", (event) => {
  logAppEvent("error", "Unhandled promise rejection", {
    reason: event.reason instanceof Error ? event.reason : String(event.reason || "")
  });
});

[
  "setupIgHandle",
  "setupIgType",
  "setupIgProfessional",
  "setupPageName",
  "setupPageUrl",
  "setupPageLinked",
  "setupAppStatus",
  "setupAppId",
  "setupBackendRequired",
  "setupPublishMode",
  "setupRequireApproval",
  "setupNoSecretsInBrowser",
  "permInstagramBasic",
  "permInstagramPublish",
  "permPagesShow",
  "permPagesEngagement"
].forEach((id) => {
  const field = $(`#${id}`);
  if (field) field.addEventListener("input", renderInstagramSetup);
});

async function bootApp() {
  installExternalChromeLinkHandler();
  loadPostingSettings();
  loadSetupWizard();
  loadInstagramSetup();
  loadYouTubeSetup();
  loadProfileWorkspaceSetup();
  await loadUserConfigFromBackend();
  renderAll();
  setAlbumVideoRenderControls(false);
  loadReviewCacheFromBackend({ silent: true });
  loadTokenHealth();
  loadStartupStatus();
  resumeRenderStatusOnLoad();
  resumeYouTubeVideoRenderStatusOnLoad();
  resumeSongFactoryConvertStatusOnLoad();
  refreshBestPerformingPresetOnStartup();
  scheduleBestPerformingPresetRefresh();
}

bootApp();
