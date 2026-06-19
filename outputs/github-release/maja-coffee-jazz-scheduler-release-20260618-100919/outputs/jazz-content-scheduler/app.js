const state = {
  tracks: JSON.parse(localStorage.getItem("jazzTracks") || "[]"),
  queue: JSON.parse(localStorage.getItem("jazzQueue") || "[]"),
  used: JSON.parse(localStorage.getItem("jazzUsed") || "{}"),
  reviews: JSON.parse(localStorage.getItem("jazzReviews") || "[]"),
  publishingQueue: JSON.parse(localStorage.getItem("jazzPublishingQueue") || "[]"),
  postingPlan: JSON.parse(localStorage.getItem("jazzPostingPlan") || "[]"),
  publishingHistory: [],
  metaHistory: [],
  tokenHealth: null,
  startupStatus: null,
  userConfigPath: "",
  reviewFilter: "all",
  libraryIssueFilter: "all",
  posting: JSON.parse(localStorage.getItem("jazzPostingSettings") || "null"),
  instagramSetup: JSON.parse(localStorage.getItem("jazzInstagramSetup") || "null"),
  setupWizard: JSON.parse(localStorage.getItem("jazzSetupWizard") || "null"),
  firstRunComplete: localStorage.getItem("jazzFirstRunComplete") === "true"
};

const backendUrl = "http://127.0.0.1:8787";
const mainViews = new Set(["firstRunSetup", "dashboard", "posting", "review", "publishingQueue", "postingPlan", "settingsSetup"]);
let autoPublisherTimer = null;
let renderPollTimer = null;
let uploadPollTimer = null;
let publishProgressTimer = null;
let publishRetryTimer = null;
let publishStartedAt = null;
let publishRetryReadyAt = 0;
let publishInFlight = false;

const sampleRows = [
  "Midnight Espresso,Willow Room Trio,Steam Notes,https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600,masters/midnight-espresso.wav,https://open.spotify.com/track/example-1,late night,82,DEMO00000001",
  "Rain on the Window,Willow Room Trio,Steam Notes,https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600,masters/rain-on-the-window.wav,https://music.youtube.com/watch/example-2,rainy,74,DEMO00000002",
  "Sunday Grinder,Willow Room Trio,Bean Counter Ballads,https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600,masters/sunday-grinder.wav,https://soundcloud.com/example/sunday-grinder,coffee shop,96,DEMO00000003",
  "Soft Vinyl Morning,Willow Room Trio,Bean Counter Ballads,https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?w=600,masters/soft-vinyl-morning.wav,https://open.spotify.com/track/example-4,warm,88,DEMO00000004",
  "Blue Cup Bossa,Willow Room Trio,Late Table Sessions,https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600,masters/blue-cup-bossa.wav,https://music.apple.com/example/blue-cup-bossa,bossa,104,DEMO00000005",
  "After Hours Latte,Willow Room Trio,Late Table Sessions,https://images.unsplash.com/photo-1511920170033-f8396924c348?w=600,masters/after-hours-latte.wav,https://open.spotify.com/track/example-6,nocturne,68,DEMO00000006"
].join("\n");

if (!state.firstRunComplete && (state.tracks.length || state.setupWizard?.lastScan)) {
  state.firstRunComplete = true;
  localStorage.setItem("jazzFirstRunComplete", "true");
}

const $ = (selector) => document.querySelector(selector);
const on = (selector, event, handler) => {
  const element = $(selector);
  if (element) element.addEventListener(event, handler);
};

function save() {
  localStorage.setItem("jazzTracks", JSON.stringify(state.tracks));
  localStorage.setItem("jazzQueue", JSON.stringify(state.queue));
  localStorage.setItem("jazzUsed", JSON.stringify(state.used));
  localStorage.setItem("jazzReviews", JSON.stringify(state.reviews));
  localStorage.setItem("jazzPublishingQueue", JSON.stringify(state.publishingQueue));
  localStorage.setItem("jazzPostingPlan", JSON.stringify(state.postingPlan));
}

function saveSetupWizard() {
  localStorage.setItem("jazzSetupWizard", JSON.stringify(getSetupWizard()));
  persistUserConfigToBackend();
}

function saveFirstRunComplete(value) {
  state.firstRunComplete = Boolean(value);
  localStorage.setItem("jazzFirstRunComplete", state.firstRunComplete ? "true" : "false");
  persistUserConfigToBackend();
}

function savePosting() {
  localStorage.setItem("jazzPostingSettings", JSON.stringify(getPostingSettings()));
  persistUserConfigToBackend();
}

function saveInstagramSetup() {
  localStorage.setItem("jazzInstagramSetup", JSON.stringify(getInstagramSetup()));
  persistUserConfigToBackend();
}

function userConfigPayload() {
  return {
    firstRunComplete: Boolean(state.firstRunComplete),
    setupWizard: {
      artistName: state.setupWizard?.artistName || $("#setupArtistName")?.value || "Maja's Coffee Jazz Zone",
      audioRoot: state.setupWizard?.audioRoot || $("#setupAudioRoot")?.value || "",
      artworkRoot: state.setupWizard?.artworkRoot || $("#setupArtworkRoot")?.value || "",
      lastScan: state.setupWizard?.lastScan || null
    },
    postingSettings: getPostingSettings(),
    instagramSetup: getInstagramSetup()
  };
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
  if (typeof config.firstRunComplete === "boolean") {
    state.firstRunComplete = config.firstRunComplete;
    localStorage.setItem("jazzFirstRunComplete", state.firstRunComplete ? "true" : "false");
  }
  if (config.setupWizard) {
    state.setupWizard = {
      ...(state.setupWizard || {}),
      ...config.setupWizard
    };
    localStorage.setItem("jazzSetupWizard", JSON.stringify(state.setupWizard));
  }
  if (config.postingSettings) {
    state.posting = {
      ...(state.posting || {}),
      ...config.postingSettings
    };
    localStorage.setItem("jazzPostingSettings", JSON.stringify(state.posting));
  }
  if (config.instagramSetup) {
    state.instagramSetup = {
      ...(state.instagramSetup || {}),
      ...config.instagramSetup
    };
    localStorage.setItem("jazzInstagramSetup", JSON.stringify(state.instagramSetup));
  }
  loadPostingSettings();
  loadSetupWizard();
  loadInstagramSetup();
  renderUserConfigStatus();
}

function parseCatalog(input) {
  const rows = parseCsv(input).filter((row) => row.some(Boolean));
  if (!rows.length) return [];

  const firstRow = rows[0].map((cell) => cell.toLowerCase());
  const hasHeader =
    firstRow.includes("title") ||
    firstRow.includes("track title") ||
    firstRow.includes("album title") ||
    firstRow.includes("isrc");

  if (hasHeader) {
    return rows.slice(1).map((row, index) => fromHeaderRow(rows[0], row, index));
  }

  return rows.map((row, index) => fromLooseRow(row, index));
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

function fromHeaderRow(headers, row, index) {
  const values = headers.reduce((record, header, headerIndex) => {
    record[header.trim().toLowerCase()] = row[headerIndex] || "";
    return record;
  }, {});

  return {
    id: crypto.randomUUID(),
    title: values.title || values["track title"] || `Untitled ${index + 1}`,
    artist: values.artist || values.artists || values["track artists"] || values["album artists"] || "Unknown artist",
    album: values.album || values["album title"] || "Unknown album",
    artworkUrl: values["artwork url"] || values.artwork || "",
    audioUrl: values["audio file or url"] || values["audio url"] || values.audio || "",
    storeUrl: values["store url"] || values.spotify || values.soundcloud || values["spotify artist url"] || "",
    mood: values.mood || values.genres || "un tagged",
    bpm: Number(values.bpm) || null,
    isrc: values.isrc || "",
    importedAt: new Date().toISOString()
  };
}

function fromLooseRow(row, index) {
  const [title, artist, album, artworkUrl, audioUrl, storeUrl, mood, bpm, isrc] = row.map((part) => part?.trim() || "");
  return {
    id: crypto.randomUUID(),
    title: title || `Untitled ${index + 1}`,
    artist: artist || "Unknown artist",
    album: album || "Unknown album",
    artworkUrl,
    audioUrl,
    storeUrl,
    mood: mood || "un tagged",
    bpm: Number(bpm) || null,
    isrc: isrc || "",
    importedAt: new Date().toISOString()
  };
}

function renderStats() {
  const albums = new Set(state.tracks.map((track) => track.album));
  $("#trackCount").textContent = state.tracks.length;
  $("#albumCount").textContent = albums.size;
  $("#queueCount").textContent = state.queue.length;
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
  const last = [...state.publishingHistory].sort((a, b) => {
    const first = new Date(b.instagramPublishedAt || b.facebookPublishedAt || b.lastSeenAt || 0).getTime();
    const second = new Date(a.instagramPublishedAt || a.facebookPublishedAt || a.lastSeenAt || 0).getTime();
    return first - second;
  })[0];
  const tokenSummary = summarizeTokenHealth();
  const nextStep = dashboardNextStep({ pending, ready, next, tokenSummary });

  setText("#dashboardReadyCount", ready.length);
  setText("#dashboardDaysScheduled", days.size);
  setText("#dashboardTokenState", tokenSummary.label);
  setText("#dashboardNextReel", next ? next.title || "Untitled Reel" : "No Reel scheduled");
  setText("#dashboardNextTime", next ? `${formatSchedule(next.scheduledFor)} | ${next.publicVideoUrl ? "video uploaded" : "needs upload"}` : "Build a batch and upload it to start the plan.");
  setText("#dashboardLastPost", last ? last.title || "Untitled Reel" : "No local history yet");
  setText("#dashboardLastPostTime", last ? formatSchedule(last.instagramPublishedAt || last.facebookPublishedAt || last.lastSeenAt) : "Published posts from this scheduler appear here.");
  setText("#dashboardNextStep", nextStep.title);
  setText("#dashboardNextStepText", nextStep.text);
  setText("#dashboardHeadline", next ? `${next.title} is next in the publishing plan.` : "Daily coffee jazz publishing at a glance.");
  setText("#dashboardSubline", nextStep.text);
}

function dashboardNextStep({ pending, ready, next, tokenSummary }) {
  if (tokenSummary.status === "bad") {
    return { title: "Fix Meta token", text: "Open Settings & Setup and refresh the Meta token before publishing." };
  }
  if (tokenSummary.status === "soon") {
    return { title: "Refresh token soon", text: "Meta token is valid, but it is close to expiry. Refresh before it blocks publishing." };
  }
  if (!state.tracks.length) {
    return { title: "Scan library", text: "Open Settings & Setup, choose the audio/artwork folders, then scan." };
  }
  if (!state.reviews.length && !state.publishingQueue.length && !state.postingPlan.length) {
    return { title: "Generate review batch", text: "Create fresh Reel drafts, then approve the best ones in Review." };
  }
  if (state.reviews.some((item) => item.status === "new" || item.status === "ready")) {
    return { title: "Review drafts", text: "Approve or reject the newly generated Reels." };
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

function renderTracks() {
  const container = $("#trackTable");
  if (!state.tracks.length) {
    container.innerHTML = "";
    return;
  }

  const rows = state.tracks
    .slice(0, 80)
    .map(
      (track) => `
        <tr>
          <td>${escapeHtml(track.title)}</td>
          <td>${escapeHtml(track.album)}</td>
          <td>${escapeHtml(track.mood)}</td>
          <td>${track.bpm || ""}</td>
          <td>${escapeHtml(track.isrc || "")}</td>
          <td>${shortSource(track.storeUrl)}</td>
        </tr>`
    )
    .join("");

  const capped = state.tracks.length > 80 ? `<p class="note">Showing first 80 of ${state.tracks.length} tracks.</p>` : "";

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Track</th>
          <th>Album</th>
          <th>Mood</th>
          <th>BPM</th>
          <th>ISRC</th>
          <th>Store</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${capped}
  `;
}

function shortSource(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return escapeHtml(url.slice(0, 24));
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function pathToFileUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  if (/^[A-Z]:\\/i.test(path)) return `file:///${path.replaceAll("\\", "/").replaceAll(" ", "%20")}`;
  return path;
}

function getScheduleSettings() {
  return {
    reels: {
      enabled: $("#reelsEnabled").checked,
      every: Number($("#reelsEvery").value) || 1,
      time: $("#reelsTime").value || "18:30"
    },
    stories: {
      enabled: $("#storiesEnabled").checked,
      every: Number($("#storiesEvery").value) || 3,
      time: $("#storiesTime").value || "12:00"
    },
    posts: {
      enabled: $("#postsEnabled").checked,
      every: Number($("#postsEvery").value) || 7,
      time: $("#postsTime").value || "09:00"
    }
  };
}

function dateWithTime(startDate, offsetDays, time) {
  const date = new Date(startDate);
  date.setDate(date.getDate() + offsetDays);
  const [hours, minutes] = time.split(":").map(Number);
  date.setHours(hours || 0, minutes || 0, 0, 0);
  return date;
}

function buildSlots(count) {
  const settings = getScheduleSettings();
  const slots = [];
  const now = new Date();
  let day = 1;

  while (slots.length < count && day < 365) {
    if (settings.reels.enabled && (day - 1) % settings.reels.every === 0) {
      slots.push({ type: "Reel", scheduledFor: dateWithTime(now, day, settings.reels.time).toISOString() });
    }
    if (settings.stories.enabled && (day - 1) % settings.stories.every === 0) {
      slots.push({ type: "Story", scheduledFor: dateWithTime(now, day, settings.stories.time).toISOString() });
    }
    if (settings.posts.enabled && (day - 1) % settings.posts.every === 0) {
      slots.push({ type: "Image/Text Post", scheduledFor: dateWithTime(now, day, settings.posts.time).toISOString() });
    }
    day += 1;
  }

  return slots.slice(0, count).sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));
}

function chooseTrack(context) {
  const cooldownDays = Number($("#cooldownDays").value) || 0;
  const albumLimit = Number($("#albumLimit").value) || 1;
  const biasMode = $("#biasMode").value;
  const cutoff = Date.now() - cooldownDays * 24 * 60 * 60 * 1000;
  const albumCounts = context.selected.reduce((counts, track) => {
    counts[track.album] = (counts[track.album] || 0) + 1;
    return counts;
  }, {});

  let eligible = state.tracks.filter((track) => {
    const lastUsed = state.used[track.id] ? new Date(state.used[track.id]).getTime() : 0;
    return lastUsed < cutoff && (albumCounts[track.album] || 0) < albumLimit;
  });

  if (!eligible.length) eligible = [...state.tracks];

  const sorted = [...eligible].sort((a, b) => {
    if (biasMode === "fresh") return (state.used[a.id] ? 1 : -1) - (state.used[b.id] ? 1 : -1) || Math.random() - 0.5;
    if (biasMode === "new") return new Date(b.importedAt) - new Date(a.importedAt) || Math.random() - 0.5;
    if (biasMode === "mood") return moodScore(a, context.selected) - moodScore(b, context.selected) || Math.random() - 0.5;
    return Math.random() - 0.5;
  });

  const poolSize = Math.max(1, Math.ceil(sorted.length * 0.25));
  return sorted[Math.floor(Math.random() * poolSize)];
}

function moodScore(track, selected) {
  return selected.filter((item) => item.mood === track.mood).length;
}

function generateQueue() {
  if (!state.tracks.length) {
    alert("Import tracks first.");
    return;
  }

  const count = Number($("#draftCount").value) || 14;
  const slots = buildSlots(count);
  const selected = [];

  state.queue = slots.map((slot) => {
    const track = chooseTrack({ selected });
    selected.push(track);
    state.used[track.id] = slot.scheduledFor;
    return {
      id: crypto.randomUUID(),
      ...slot,
      trackId: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.artworkUrl,
      audioUrl: track.audioUrl,
      storeUrl: track.storeUrl,
      mood: track.mood,
      isrc: track.isrc,
      concept: conceptFor(slot.type, track)
    };
  });

  save();
  renderAll();
}

function conceptFor(type, track) {
  if (type === "Reel") {
    return `Animate the ${track.album} artwork with coffee steam, soft camera drift, and baked-in track audio.`;
  }
  if (type === "Story") {
    return `Use album art with a short mood caption and a link sticker target for ${track.title}.`;
  }
  return `Post artwork with a calm coffee-jazz caption focused on the ${track.mood} mood.`;
}

function renderQueue() {
  const list = $("#queueList");
  list.innerHTML = "";

  if (!state.queue.length) {
    list.innerHTML = `<p class="note">No drafts yet. Generate a queue after loading your catalog.</p>`;
    return;
  }

  const template = $("#queueTemplate");
  state.queue.forEach((item) => {
    const node = template.content.cloneNode(true);
    const art = node.querySelector(".art");
    const title = node.querySelector("h4");
    const description = node.querySelector("p");
    const small = node.querySelector("small");
    const type = node.querySelector(".type");
    const date = node.querySelector(".date");

    if (item.artworkUrl) art.style.backgroundImage = `url("${item.artworkUrl}")`;
    title.textContent = `${item.title} - ${item.album}`;
    description.textContent = item.concept;
    small.textContent = `${item.artist} • ${item.mood} • source: ${shortSource(item.storeUrl) || "local catalog"}`;
    type.textContent = item.type;
    date.textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(item.scheduledFor));

    list.appendChild(node);
  });
}

function exportQueue() {
  if (!state.queue.length) {
    alert("Generate a queue first.");
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    note: "Draft content plan. Publishing is intentionally not enabled in this prototype.",
    items: state.queue
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "jazz-content-queue.json";
  link.click();
  URL.revokeObjectURL(url);
}

function normalizeReview(item) {
  return {
    id: item.id || item.ID || item.ISRC || crypto.randomUUID(),
    status: (item.Status || item.status || "draft").toLowerCase(),
    title: item.Title || item.title || "Untitled",
    album: item.Album || item.album || "Unknown album",
    isrc: item.ISRC || item.isrc || "",
    video: item.Video || item.video || "",
    preview: item.Preview || item.preview || "",
    audio: item.Audio || item.audio || "",
    artwork: item.Artwork || item.artwork || "",
    template: item.Template || item.template || "unknown",
    caption: item.Caption || item.caption || "",
    hashtags: item.Hashtags || item.hashtags || ""
  };
}

function renderReviews() {
  const list = $("#reviewList");
  if (!list) return;
  const reviews = getVisibleReviews();
  list.innerHTML = "";

  if (!reviews.length) {
    const message = state.reviews.length
      ? "No Reels match this filter."
      : "No rendered Reels loaded yet. Load the latest batch or create a new one from Generate.";
    list.innerHTML = `<p class="note">${message}</p>`;
    return;
  }

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
    caption.value = item.caption;
    hashtags.value = item.hashtags;
    openVideo.href = pathToFileUrl(item.video);

    node.querySelector(".approve").addEventListener("click", () => updateReviewStatus(item.id, "approved"));
    node.querySelector(".reject").addEventListener("click", () => updateReviewStatus(item.id, "rejected"));
    node.querySelector(".posted").addEventListener("click", () => updateReviewStatus(item.id, "posted"));
    caption.addEventListener("input", () => updateReviewText(item.id, "caption", caption.value));
    hashtags.addEventListener("input", () => updateReviewText(item.id, "hashtags", hashtags.value));

    list.appendChild(node);
  });
}

function getVisibleReviews() {
  if (state.reviewFilter === "all") {
    return state.reviews.filter((item) => item.status === "draft" || item.status === "render_failed");
  }
  return state.reviews.filter((item) => item.status === state.reviewFilter);
}

function updateReviewStatus(id, status) {
  const item = state.reviews.find((review) => review.id === id);
  if (!item) return;
  item.status = status;
  save();
  renderReviews();
}

function updateVisibleReviewStatuses(status) {
  const visibleIds = new Set(getVisibleReviews().map((item) => item.id));
  if (!visibleIds.size) return;
  state.reviews = state.reviews.map((item) => (
    visibleIds.has(item.id) && item.status !== "render_failed"
      ? { ...item, status }
      : item
  ));
  save();
  renderReviews();
}

function updateReviewText(id, field, value) {
  const item = state.reviews.find((review) => review.id === id);
  if (!item) return;
  item[field] = value;
  save();
}

function importReviews(items) {
  const existing = new Map(state.reviews.map((item) => [item.id, item]));
  items.map(normalizeReview).forEach((item) => {
    existing.set(item.id, { ...existing.get(item.id), ...item });
  });
  state.reviews = [...existing.values()];
  save();
  renderReviews();
}

function replaceReviews(items) {
  state.reviews = items.map(normalizeReview);
  state.reviewFilter = "all";
  save();
  document.querySelectorAll("[data-review-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reviewFilter === "all");
  });
  renderReviews();
}

function exportApproved() {
  const approved = state.reviews.filter((item) => item.status === "approved");
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
  return state.reviews.filter((item) => item.status === "approved");
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
  const baseDate = defaultPublishDate(index);

  return {
    id: item.id || item.isrc || item.ISRC || crypto.randomUUID(),
    status: item.status || item.Status || item.publishStatus || "ready",
    platform: settings.defaultPostType === "story" ? "instagram-story" : settings.defaultPostType === "feed" ? "instagram-feed" : "instagram-reel",
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
    preview: item.preview || item.Preview || "",
    audio: item.audio || item.Audio || "",
    artwork: item.artwork || item.Artwork || "",
    template: item.template || item.Template || "",
    caption: item.caption || item.Caption || "",
    hashtags: item.hashtags || item.Hashtags || ""
  };
}

function defaultPublishDate(index = 0) {
  const date = new Date();
  date.setHours(1, 0, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  date.setDate(date.getDate() + index);
  return date;
}

function toLocalDateTime(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function importPublishingQueue(items, settings) {
  const existing = new Map(state.publishingQueue.map((item) => [item.id, item]));
  items.map((item, index) => normalizePublishItem(item, settings, index)).forEach((item) => {
    existing.set(item.id, { ...existing.get(item.id), ...item });
  });
  state.publishingQueue = [...existing.values()];
  save();
  renderPublishingQueue();
}

function addToPostingPlan(items, settings = getPostingSettings()) {
  const existing = new Map(state.postingPlan.map((item) => [item.id, item]));
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
    list.innerHTML = `<p class="note">No approved Reels loaded yet. Go to Review, approve the Reels you like, then use Load approved here.</p>`;
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
    const platformInput = node.querySelector(".publish-platform-input");
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
    platform.textContent = item.platform;
    title.textContent = item.title;
    album.textContent = `${item.album} - ${item.account || "No account set"}`;
    platformInput.value = item.platform;
    scheduledInput.value = item.scheduledFor;
    caption.value = item.caption;
    hashtags.value = item.hashtags;
    publicVideoUrl.value = item.publicVideoUrl || "";
    apiResult.textContent = item.apiMessage || publishItemApiSummary(item);
    openVideo.href = pathToFileUrl(item.video);

    platformInput.addEventListener("input", () => updatePublishItem(item.id, "platform", platformInput.value));
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

function setDailyStartSchedule() {
  if (!state.publishingQueue.length) {
    setStatus("#apiPublishStatus", "No queue items to schedule yet.");
    return;
  }
  let scheduleIndex = 0;
  state.publishingQueue = state.publishingQueue.map((item) => {
    if (item.status === "posted" || item.publishStatus === "published") return item;
    const scheduledFor = toLocalDateTime(defaultPublishDate(scheduleIndex));
    scheduleIndex += 1;
    return { ...item, scheduledFor };
  });
  save();
  renderPublishingQueue();
  setStatus("#apiPublishStatus", `Set ${scheduleIndex} unpublished Reel${scheduleIndex === 1 ? "" : "s"} to 01:00, one per day.`);
}

function renderPublishTimeline() {
  const panel = $("#finalPublisherPanel");
  const title = $("#finalPublishTitle");
  const dialogue = $("#finalPublishDialogue");
  const stats = $("#finalPublishStats");
  const list = $("#publishTimelineList");
  if (!panel || !title || !dialogue || !stats || !list) return;

  const items = [...state.publishingQueue].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const uploaded = items.filter((item) => item.publicVideoUrl).length;
  const scheduled = items.filter((item) => item.status === "scheduled" || item.scheduledFor).length;
  const posted = items.filter((item) => item.status === "posted" || item.publishStatus === "published").length;
  const held = items.filter((item) => item.status === "held").length;
  const readyToPublish = items.filter((item) => item.publicVideoUrl && item.status !== "posted" && item.status !== "held").length;
  const nextItem = items.find((item) => item.status !== "posted" && item.status !== "held");

  stats.innerHTML = [
    ["Queued", items.length],
    ["Videos uploaded", uploaded],
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

  panel.classList.toggle("committed", Boolean(autoPublisherTimer));
  const missingUploads = items.length - uploaded;
  if (autoPublisherTimer) {
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
    const stateLabel = isPosted ? "Posted" : item.status === "held" ? "Held" : item.publicVideoUrl ? "Video uploaded" : "Needs upload";
    return `
      <article class="timeline-card ${isPosted ? "posted" : item.status === "held" ? "held" : ""}">
        <span>${index + 1}</span>
        <strong>${escapeHtml(item.title || "Untitled Reel")}</strong>
        <small>${escapeHtml(item.album || "Unknown album")}</small>
        <time>${formatSchedule(item.scheduledFor)}</time>
        <em>${stateLabel}</em>
      </article>
    `;
  }).join("");
}

function renderMetaQueueSummary() {
  const label = $("#metaQueueSummaryLabel");
  const stats = $("#metaQueueStats");
  const list = $("#metaQueueList");
  if (!label || !stats || !list) return;

  const items = [...state.publishingQueue].sort((a, b) => {
    const first = new Date(a.scheduledFor || 0).getTime();
    const second = new Date(b.scheduledFor || 0).getTime();
    return first - second;
  });
  const uploaded = items.filter((item) => Boolean(item.publicVideoUrl));
  const posted = items.filter((item) => item.status === "posted" || item.publishStatus === "published");
  const metaReady = items.filter((item) => item.publicVideoUrl && item.status !== "held" && item.status !== "posted" && item.publishStatus !== "published");
  const dueNow = getDuePublishItems(items);
  const needsUpload = items.filter((item) => !item.publicVideoUrl && item.status !== "held" && item.status !== "posted");
  const nextItem = getNextPublishItem(items);

  label.textContent = metaReady.length
    ? dueNow.length
      ? `${dueNow.length} due now`
      : `${metaReady.length} uploaded and waiting`
    : items.length ? "Nothing ready for Meta yet" : "No queue loaded";

  stats.innerHTML = [
    ["Needs upload", needsUpload.length],
    ["Uploaded", uploaded.length],
    ["Due now", dueNow.length],
    ["Posted", posted.length]
  ].map(([statLabel, value]) => `<div><strong>${value}</strong><span>${statLabel}</span></div>`).join("");

  if (!items.length) {
    list.innerHTML = `<p class="note">Load approved Reels first. This panel will show what is ready for Meta.</p>`;
    return;
  }

  list.innerHTML = items.slice(0, 12).map((item, index) => {
    const isPosted = item.status === "posted" || item.publishStatus === "published";
    const isHeld = item.status === "held";
    const isDue = dueNow.some((dueItem) => dueItem.id === item.id);
    const stateLabel = isPosted
      ? "Posted"
      : isHeld
        ? "Held"
        : isDue
          ? "Due now"
          : item.publicVideoUrl && nextItem?.id === item.id
            ? "Next"
            : item.publicVideoUrl
            ? "Waiting"
            : "Needs upload";

    return `
      <article class="${isDue ? "due" : isPosted ? "posted" : isHeld ? "held" : ""}">
        <span>${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.title || "Untitled Reel")}</strong>
          <small>${formatSchedule(item.scheduledFor)}</small>
        </div>
        <em>${stateLabel}</em>
      </article>
    `;
  }).join("");
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
    list.innerHTML = `<p class="note">Uploaded Reels will appear here after the Publish Queue upload step completes.</p>`;
    return;
  }

  list.innerHTML = items.map((item, index) => {
    const instagramDone = item.status === "posted" || item.publishStatus === "published";
    const facebookDone = item.facebookPublishStatus === "published" || item.facebookMediaId;
    const label = instagramDone && facebookDone
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
        <small>${escapeHtml(item.album || "Unknown album")}</small>
        <time>${formatSchedule(item.scheduledFor)}</time>
        <em>${label}</em>
      </article>
    `;
  }).join("");
  renderPublishingHistory();
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

async function loadTokenHealth() {
  renderTokenHealth("Checking Meta connection...");
  try {
    const response = await fetch(`${backendUrl}/api/readiness`);
    const result = await response.json();
    state.tokenHealth = result;
    renderTokenHealth();
    renderDashboard();
    renderFirstRunWizard();
  } catch {
    state.tokenHealth = null;
    renderTokenHealth("Backend is not running. Start the scheduler app, then check again.");
    renderDashboard();
    renderFirstRunWizard();
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
    actions.innerHTML = metaActionItems(["Run a Meta health check."]);
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

  if (!appOk) actions.push("Add META_APP_ID and META_APP_SECRET in the backend .env file.");
  if (!tokenOk) actions.push("Add a valid long-lived META_ACCESS_TOKEN, then restart the backend.");
  if (tokenExpiry.status === "soon") actions.push("Refresh the Meta access token soon before it expires.");
  if (!pageTokenOk) actions.push("Add META_PAGE_ACCESS_TOKEN so Facebook Page publishing works reliably.");
  if (!pageOk) actions.push("Confirm FACEBOOK_PAGE_ID is the linked Maja page and the token has Page access.");
  if (!instagramOk) actions.push("Confirm IG_USER_ID is the professional Instagram account connected to the Page.");
  requiredPermissions.filter((item) => !item.ok).forEach((item) => actions.push(`Grant ${item.label} permission in Meta.`));
  if (!health.publishingEnabled) actions.push("Set publishing mode to test/live when you are ready to use API publishing.");
  if (!actions.length) actions.push("No action needed. Meta publishing is ready.");

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
      <span>${escapeHtml(item)}</span>
    </article>
  `).join("");
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
    renderFirstRunWizard();
  } catch {
    state.startupStatus = null;
    renderStartupStatus("Backend is not running. Startup status will appear when the app is open.");
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
  stats.innerHTML = [
    ["Silent publisher", info?.installed ? "Yes" : "No"],
    ["Dashboard opens", info?.dashboardInstalled ? "Yes" : "No"],
    ["Last run", info?.latestRunAt ? formatSchedule(info.latestRunAt) : latest?.checkedAt ? formatSchedule(latest.checkedAt) : "Not yet"],
    ["Published", latest?.publishedCount ?? latest?.published?.length ?? 0],
    ["Errors", latest?.errorCount ?? latest?.errors?.length ?? 0]
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");
  status.textContent = latestMessage;
}

async function runStartupAction(action) {
  const labels = {
    install: "Installing startup publisher...",
    uninstall: "Removing startup publisher...",
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
    setStatus("#startupAutomationStatus", result.message || "Startup action finished.");
    if (result.items) {
      mergePublishResultsIntoStores(result.items);
      save();
      renderPostingPlan();
      renderDashboard();
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
    const label = item.instagramDone && item.facebookDone
      ? "Instagram + Facebook"
      : item.instagramDone
        ? "Instagram only"
        : "Facebook only";
    const postedAt = item.instagramPublishedAt || item.facebookPublishedAt || item.lastSeenAt;
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
    igAccount: $("#igAccount")?.value || "",
    defaultPostType: $("#defaultPostType")?.value || "reel",
    publishOriginalAudio: Boolean($("#publishOriginalAudio")?.checked),
    captionStyle: $("#captionStyle")?.value || "calm",
    hashtagSet: $("#hashtagSet")?.value || "",
    postingTimezone: $("#postingTimezone")?.value || "Europe/London",
    postingWindow: $("#postingWindow")?.value || "start",
    maxPostsPerDay: Number($("#maxPostsPerDay")?.value) || 1,
    mixReels: Number($("#mixReels")?.value) || 0,
    mixStories: Number($("#mixStories")?.value) || 0,
    mixFeed: Number($("#mixFeed")?.value) || 0,
    postingCooldown: Number($("#postingCooldown")?.value) || 90,
    renderBatchSize: Number($("#renderBatchSize")?.value) || 7,
    renderPreset: $("#renderPreset")?.value || "balanced",
    renderMinSeconds: Number($("#renderMinSeconds")?.value) || 20,
    renderMaxSeconds: Number($("#renderMaxSeconds")?.value) || 30,
    renderFadeSeconds: Number($("#renderFadeSeconds")?.value) || 4
  };
}

function getSetupWizard() {
  return {
    artistName: $("#setupArtistName")?.value || "Maja's Coffee Jazz Zone",
    audioRoot: $("#setupAudioRoot")?.value || "",
    artworkRoot: $("#setupArtworkRoot")?.value || "",
    lastScan: state.setupWizard?.lastScan || null
  };
}

function loadSetupWizard() {
  const setup = {
    artistName: "Maja's Coffee Jazz Zone",
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
    audioRoot: $("#wizardAudioRoot")?.value || "",
    artworkRoot: $("#wizardArtworkRoot")?.value || "",
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
    const result = await postBackend("/api/setup/pick-folder", { title });
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
    const result = await postBackend("/api/setup/pick-folder", { title });
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
  setStatus("#wizardStatus", tokenSummary.status === "bad" ? "Meta needs attention. Check Settings & Setup for details." : "Meta connection looks ready.");
}

async function installFirstRunStartupPublisher() {
  await runStartupAction("install");
  renderFirstRunWizard();
  setStatus("#wizardStatus", state.startupStatus?.installed ? "Startup publisher installed." : "Startup publisher needs attention.");
}

function finishFirstRunSetup(skip = false) {
  syncSetupFieldsFromFirstRun();
  if (!skip) {
    const scanReady = Boolean(state.setupWizard?.lastScan?.eligibleCount || state.tracks.length);
    const tokenSummary = summarizeTokenHealth();
    if (!scanReady || tokenSummary.status === "bad") {
      setStatus("#wizardStatus", "Finish the library scan and Meta check first, or choose Skip for now.");
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
  const list = $("#libraryIssueList");
  if (!stats || !list) return;

  if (!scan) {
    stats.innerHTML = "";
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
  const steps = [
    { label: "Artist", ok: Boolean($("#wizardArtistName")?.value || state.setupWizard?.artistName) },
    { label: "Music folder", ok: Boolean($("#wizardAudioRoot")?.value || state.setupWizard?.audioRoot) },
    { label: "Library scan", ok: Boolean(scan?.eligibleCount || state.tracks.length) },
    { label: "Meta check", ok: tokenSummary.status === "good" || tokenSummary.status === "soon" },
    { label: "Startup publisher", ok: startupInstalled }
  ];
  const complete = steps.filter((step) => step.ok).length;
  const percent = Math.round((complete / steps.length) * 100);
  const bar = $("#wizardProgressBar");
  if (bar) bar.style.width = `${percent}%`;

  const summary = $("#wizardStepSummary");
  if (summary) {
    summary.innerHTML = steps.map((step) => `
      <article class="${step.ok ? "done" : ""}">
        <strong>${step.ok ? "Done" : "Next"}</strong>
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

  const status = $("#wizardStatus");
  const title = $("#wizardFinishTitle");
  if (status && title) {
    if (complete === steps.length) {
      title.textContent = "Ready to enter the dashboard";
      status.textContent = "Setup is complete. You can start generating and scheduling Reels.";
    } else {
      title.textContent = `${complete}/${steps.length} setup checks complete`;
      const next = steps.find((step) => !step.ok);
      status.textContent = next ? `Next: complete ${next.label}.` : "Review the setup checks above.";
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
    igHandle: $("#setupIgHandle")?.value || "@majascoffeejazzzone",
    igType: $("#setupIgType")?.value || "creator",
    igProfessional: Boolean($("#setupIgProfessional")?.checked),
    pageName: $("#setupPageName")?.value || "Maja's Coffee Jazz Zone",
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
    igHandle: "@majascoffeejazzzone",
    igType: "creator",
    igProfessional: true,
    pageName: "Maja's Coffee Jazz Zone",
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

function loadPostingSettings() {
  const defaults = {
    publishMode: "approval",
    requirePreview: true,
    skipFallbackAudio: true,
    igAccount: "@majascoffeejazzzone",
    defaultPostType: "reel",
    publishOriginalAudio: true,
    captionStyle: "calm",
    hashtagSet: "#coffeejazz #jazzreels #backgroundjazz #coffeeshopmusic #instrumentaljazz",
    postingTimezone: "Europe/London",
    postingWindow: "start",
    maxPostsPerDay: 1,
    mixReels: 70,
    mixStories: 20,
    mixFeed: 10,
    postingCooldown: 90,
    renderBatchSize: 7,
    renderPreset: "balanced",
    renderMinSeconds: 20,
    renderMaxSeconds: 30,
    renderFadeSeconds: 4
  };
  const settings = { ...defaults, ...(state.posting || {}) };
  Object.entries(settings).forEach(([key, value]) => {
    const field = $(`#${key}`);
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value;
  });
  renderPostingCommand();
}

function renderPostingCommand() {
  const settings = getPostingSettings();
  const command = `powershell -ExecutionPolicy Bypass -File outputs\\jazz-content-scheduler\\render-next-draft-reels.ps1 -Count ${settings.renderBatchSize} -MinSeconds ${settings.renderMinSeconds} -MaxSeconds ${settings.renderMaxSeconds} -FadeOutSeconds ${settings.renderFadeSeconds} -RenderTimeoutSeconds 300 -CooldownDays ${settings.postingCooldown} -RenderPreset ${settings.renderPreset} -TemplateMode rotate`;
  const target = $("#renderCommand");
  if (target) target.textContent = command;
  const manualTarget = $("#manualPackageCommand");
  if (manualTarget) {
    manualTarget.textContent = "powershell -ExecutionPolicy Bypass -File outputs\\jazz-content-scheduler\\package-manual-posting.ps1 -FromClipboard";
  }
  const r2Target = $("#r2UploadCommand");
  if (r2Target) {
    r2Target.textContent = "powershell -ExecutionPolicy Bypass -File outputs\\jazz-content-scheduler\\upload-reels-to-r2.ps1 -FromClipboard";
  }
  const instagramContainerTarget = $("#instagramContainerCommand");
  if (instagramContainerTarget) {
    instagramContainerTarget.textContent = "powershell -ExecutionPolicy Bypass -File outputs\\jazz-content-scheduler\\create-instagram-containers.ps1";
  }
  const nextManualTarget = $("#nextManualPostCommand");
  if (nextManualTarget) {
    nextManualTarget.textContent = "powershell -ExecutionPolicy Bypass -File outputs\\jazz-content-scheduler\\open-next-manual-post.ps1 -OpenMetaBusinessSuite";
  }
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

async function createReviewBatchFromGui() {
  const settings = getPostingSettings();
  setStatus("#renderBatchStatus", "Starting review batch...");
  setRenderProgress({ percent: 0, stage: "starting", message: "Preparing the render job...", current: 0, total: settings.renderBatchSize });
  setRenderControls(true);
  try {
    const result = await postBackend("/api/render/start", {
      count: settings.renderBatchSize,
      renderPreset: settings.renderPreset,
      minSeconds: settings.renderMinSeconds,
      maxSeconds: settings.renderMaxSeconds,
      fadeOutSeconds: settings.renderFadeSeconds,
      renderTimeoutSeconds: 300,
      cooldownDays: settings.postingCooldown,
      templateMode: "rotate"
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
        setStatus("#renderBatchStatus", `${status.result.message || "Render complete."} Loaded into Review.`);
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
      setStatus("#renderBatchStatus", `${status.result.message || "Render complete."} Loaded into Review.`);
    }
  } catch {}
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
  const total = Number(progress.total) || 0;
  const parsed = parseOperationMessage(progress.message || "");
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

  return `
    <span>${escapeHtml(`${stageText} | ${reelText} | ETA: ${etaText} | Elapsed: ${elapsedText}`)}</span>
  `;
}

function parseOperationMessage(message) {
  const match = String(message || "").match(/\b(Rendering|Finished|Skipped|Uploading|Uploaded|Prepared)\s+(\d+)\/(\d+)/i);
  if (!match) return {};
  return {
    action: match[1].toLowerCase(),
    current: Number(match[2]),
    total: Number(match[3])
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
    const response = await fetch(`${backendUrl}/api/render/latest`);
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
    setStatus("#apiPublishStatus", `${result.message || "Latest upload results loaded."} Saved in Posting Plan and cleared from the active queue.`);
  } catch (error) {
    setStatus("#apiPublishStatus", "Could not load latest upload results. Make sure the backend is running.");
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
        setStatus("#apiPublishStatus", `${status.result.message || "Upload complete."} The active queue has been cleared and the schedule is saved in Posting Plan.`);
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

async function publishDueFromGui({ force = false } = {}) {
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
    const result = await postBackend("/api/instagram/publish-due", {
      postingSettings: getPostingSettings(),
      items: sourceItems,
      force
    });
    if (result.ok && Array.isArray(result.items)) {
      mergePublishResultsIntoStores(result.items);
      save();
      renderPublishingQueue();
      renderPostingPlan();
      loadPublishingHistory();
    }
    setStatus("#apiPublishStatus", publishResultMessage(result));
    handlePublishResultProgress(result);
  } catch (error) {
    setStatus("#apiPublishStatus", "Publish check failed. Check token, container status, and backend.");
    setPublishProgress({ mode: "error", message: "Publish check failed.", percent: 100 });
  } finally {
    stopPublishProgressTimer();
    setPublishControls(false);
  }
}

function getPublishSourceItems() {
  const merged = new Map();
  state.postingPlan.forEach((item) => merged.set(item.id, item));
  state.publishingQueue.forEach((item) => merged.set(item.id, { ...merged.get(item.id), ...item }));
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

async function syncPostingPlanToBackend() {
  try {
    await postBackend("/api/posting-plan", {
      items: state.postingPlan
    });
  } catch {
    // The backend may be closed; local browser storage still keeps the plan.
  }
}

function setPublishControls(isRunning) {
  publishInFlight = isRunning;
  const dueButton = $("#publishDueContainers");
  const autoButton = $("#toggleAutoPublisher");
  const coolingDown = publishRetryReadyAt && Date.now() < publishRetryReadyAt;
  if (dueButton) dueButton.disabled = isRunning || coolingDown;
  if (autoButton) autoButton.disabled = isRunning;
}

function publishResultMessage(result) {
  if (!result) return "Publish check finished.";
  const base = result.message || "Publish check finished.";
  if (result.outcomeSummary) return `${base.replace(/\s*First skip:.*$/i, "")} ${result.outcomeSummary}`.trim();
  if (Array.isArray(result.errors) && result.errors.length) {
    const first = result.errors[0];
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
  return `${base} Check the first queue item has a public video URL and a scheduled time in the past.`;
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
  if (result.errorCount > 0 || (Array.isArray(result.errors) && result.errors.length)) {
    setPublishProgress({
      mode: "error",
      message: "Publisher needs attention before retrying.",
      percent: 100,
      elapsedMs
    });
    return;
  }

  const published = Number(result.publishedCount) || 0;
  setPublishProgress({
    mode: published > 0 ? "complete" : "idle",
    message: published > 0 ? `Published ${published} Reel${published === 1 ? "" : "s"}.` : "No due Reels were ready to publish.",
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

  autoPublisherTimer = setInterval(() => publishDueFromGui(), 5 * 60 * 1000);
  if (button) button.textContent = "Stop auto publisher";
  setStatus("#apiPublishStatus", "Auto publisher running. Keep this dashboard and backend open.");
  renderPublishTimeline();
  publishDueFromGui();
}

async function postBackend(path, payload) {
  const response = await fetch(`${backendUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    throw new Error(result.message || result.error || "Backend request failed.");
  }
  return result;
}

function setStatus(selector, message) {
  const target = $(selector);
  if (target) target.textContent = message;
}

function setText(selector, message) {
  const target = $(selector);
  if (target) target.textContent = message;
}

function syncView() {
  const defaultView = state.firstRunComplete ? "dashboard" : "firstRunSetup";
  const requested = (location.hash || `#${defaultView}`).slice(1);
  const view = state.firstRunComplete ? (requested || "dashboard") : requested === "settingsSetup" ? "settingsSetup" : requested === "firstRunSetup" ? "firstRunSetup" : "firstRunSetup";
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
}

function renderAll() {
  renderStats();
  renderTracks();
  renderQueue();
  renderReviews();
  renderPublishingQueue();
  renderPostingPlan();
  renderPostingCommand();
  renderSetupLibrarySummary();
  renderInstagramSetup();
  renderTokenHealth();
  renderStartupStatus();
  renderUserConfigStatus();
  syncPostingPlanToBackend();
  loadPublishingHistory();
  syncView();
}

$("#loadSample").addEventListener("click", () => {
  $("#catalogInput").value = sampleRows;
});

$("#importCatalog").addEventListener("click", () => {
  const imported = parseCatalog($("#catalogInput").value);
  state.tracks = [...state.tracks, ...imported];
  save();
  renderAll();
});

$("#fileInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  $("#catalogInput").value = await file.text();
});

$("#clearCatalog").addEventListener("click", () => {
  if (!confirm("Clear the local catalog and queue in this browser?")) return;
  state.tracks = [];
  state.queue = [];
  state.used = {};
  save();
  renderAll();
});

$("#generateQueue").addEventListener("click", generateQueue);
$("#exportQueue").addEventListener("click", exportQueue);

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
on("#sendApprovedToQueueFlow", "click", sendApprovedToPublishingQueue);
on("#approveVisibleReviews", "click", () => updateVisibleReviewStatuses("approved"));
on("#rejectVisibleReviews", "click", () => updateVisibleReviewStatuses("rejected"));
on("#clearReviews", "click", () => {
  if (!confirm("Clear imported review items from this browser?")) return;
  state.reviews = [];
  save();
  renderReviews();
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

on("#pickAudioRoot", "click", () => pickSetupFolder("audio"));
on("#pickArtworkRoot", "click", () => pickSetupFolder("artwork"));
on("#scanSetupLibrary", "click", scanSetupLibrary);
on("#wizardPickAudioRoot", "click", () => pickFirstRunFolder("audio"));
on("#wizardPickArtworkRoot", "click", () => pickFirstRunFolder("artwork"));
on("#wizardScanLibrary", "click", scanFirstRunLibrary);
on("#wizardCheckMeta", "click", checkFirstRunMeta);
on("#wizardInstallStartupPublisher", "click", installFirstRunStartupPublisher);
on("#wizardFinishSetup", "click", () => finishFirstRunSetup(false));
on("#wizardSkipSetup", "click", () => finishFirstRunSetup(true));

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

$("#approvedInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  importPublishingQueue(parsed.items || [], parsed.postingSettings || getPostingSettings());
});

on("#loadApprovedFromReview", "click", sendApprovedToPublishingQueue);
on("#uploadApprovedToR2", "click", uploadApprovedToR2FromGui);
on("#stopR2Upload", "click", stopUploadFromGui);
on("#publishDueContainers", "click", () => publishDueFromGui());
on("#toggleAutoPublisher", "click", toggleAutoPublisher);
on("#syncLatestUpload", "click", syncLatestUploadedPackage);
on("#setDailyStartSchedule", "click", setDailyStartSchedule);
$("#clearPublishingQueue").addEventListener("click", () => {
  if (!confirm("Clear the publishing queue from this browser?")) return;
  state.publishingQueue = [];
  save();
  renderPublishingQueue();
});

on("#clearPostingPlan", "click", () => {
  if (!confirm("Clear the saved posting plan from this browser?")) return;
  state.postingPlan = [];
  save();
  renderPostingPlan();
  syncPostingPlanToBackend();
});
on("#refreshPublishingHistory", "click", loadPublishingHistory);
on("#refreshMetaHistory", "click", loadMetaHistory);
on("#refreshTokenHealth", "click", loadTokenHealth);
on("#instagramSetupHealthCheck", "click", loadTokenHealth);
on("#installStartupPublisher", "click", () => runStartupAction("install"));
on("#uninstallStartupPublisher", "click", () => runStartupAction("uninstall"));
on("#runStartupPublisherTest", "click", () => runStartupAction("test"));
on("#installStartupDashboard", "click", () => runStartupAction("dashboardInstall"));
on("#uninstallStartupDashboard", "click", () => runStartupAction("dashboardUninstall"));
on("#dashboardDoToday", "click", () => {
  location.hash = "publishingQueue";
  publishDueFromGui();
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
  loadPostingSettings();
  loadSetupWizard();
  loadInstagramSetup();
  await loadUserConfigFromBackend();
  renderAll();
  loadTokenHealth();
  loadStartupStatus();
  resumeRenderStatusOnLoad();
}

bootApp();
