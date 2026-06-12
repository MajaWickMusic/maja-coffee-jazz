const state = {
  tracks: JSON.parse(localStorage.getItem("jazzTracks") || "[]"),
  queue: JSON.parse(localStorage.getItem("jazzQueue") || "[]"),
  used: JSON.parse(localStorage.getItem("jazzUsed") || "{}"),
  reviews: JSON.parse(localStorage.getItem("jazzReviews") || "[]"),
  publishingQueue: JSON.parse(localStorage.getItem("jazzPublishingQueue") || "[]"),
  reviewFilter: "all",
  posting: JSON.parse(localStorage.getItem("jazzPostingSettings") || "null"),
  instagramSetup: JSON.parse(localStorage.getItem("jazzInstagramSetup") || "null")
};

const backendUrl = "http://127.0.0.1:8787";
const mainViews = new Set(["posting", "review", "publishingQueue", "settingsSetup"]);
let autoPublisherTimer = null;

const sampleRows = [
  "Midnight Espresso,Willow Room Trio,Steam Notes,https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=600,masters/midnight-espresso.wav,https://open.spotify.com/track/example-1,late night,82,DEMO00000001",
  "Rain on the Window,Willow Room Trio,Steam Notes,https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600,masters/rain-on-the-window.wav,https://music.youtube.com/watch/example-2,rainy,74,DEMO00000002",
  "Sunday Grinder,Willow Room Trio,Bean Counter Ballads,https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600,masters/sunday-grinder.wav,https://soundcloud.com/example/sunday-grinder,coffee shop,96,DEMO00000003",
  "Soft Vinyl Morning,Willow Room Trio,Bean Counter Ballads,https://images.unsplash.com/photo-1461988320302-91bde64fc8e4?w=600,masters/soft-vinyl-morning.wav,https://open.spotify.com/track/example-4,warm,88,DEMO00000004",
  "Blue Cup Bossa,Willow Room Trio,Late Table Sessions,https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600,masters/blue-cup-bossa.wav,https://music.apple.com/example/blue-cup-bossa,bossa,104,DEMO00000005",
  "After Hours Latte,Willow Room Trio,Late Table Sessions,https://images.unsplash.com/photo-1511920170033-f8396924c348?w=600,masters/after-hours-latte.wav,https://open.spotify.com/track/example-6,nocturne,68,DEMO00000006"
].join("\n");

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
}

function savePosting() {
  localStorage.setItem("jazzPostingSettings", JSON.stringify(getPostingSettings()));
}

function saveInstagramSetup() {
  localStorage.setItem("jazzInstagramSetup", JSON.stringify(getInstagramSetup()));
}

function parseCatalog(input) {
  const rows = parseCsv(input).filter((row) => row.some(Boolean));
  if (!rows.length) return [];

  const firstRow = rows[0].map(normalizeHeader);
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

function normalizeHeader(header) {
  return String(header || "").trim().replace(/^\uFEFF/, "").toLowerCase();
}

function fromHeaderRow(headers, row, index) {
  const values = headers.reduce((record, header, headerIndex) => {
    record[normalizeHeader(header)] = row[headerIndex] || "";
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
  const reviews = state.reviewFilter === "all" ? state.reviews : state.reviews.filter((item) => item.status === state.reviewFilter);
  list.innerHTML = "";

  if (!reviews.length) {
    list.innerHTML = `<p class="note">No rendered Reels loaded yet. Import a review manifest from a rendered batch.</p>`;
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

function updateReviewStatus(id, status) {
  const item = state.reviews.find((review) => review.id === id);
  if (!item) return;
  item.status = status;
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
  importPublishingQueue(approved, getPostingSettings());
  location.hash = "publishingQueue";
}

function normalizePublishItem(item, settings = getPostingSettings(), index = 0) {
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + index + 1);
  const hour = settings.postingWindow === "morning" ? 9 : settings.postingWindow === "lunch" ? 12 : settings.postingWindow === "late" ? 22 : 18;
  baseDate.setHours(hour, 30, 0, 0);

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

function renderPublishingQueue() {
  const list = $("#publishingQueueList");
  if (!list) return;
  list.innerHTML = "";

  if (!state.publishingQueue.length) {
    list.innerHTML = `<p class="note">No approved Reels loaded yet. Go to Review, approve the Reels you like, then use Load approved here.</p>`;
    renderPublishTimeline();
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
    const statusInput = node.querySelector(".publish-status-input");
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
    statusInput.value = item.status;
    caption.value = item.caption;
    hashtags.value = item.hashtags;
    publicVideoUrl.value = item.publicVideoUrl || "";
    apiResult.textContent = item.apiMessage || publishItemApiSummary(item);
    openVideo.href = pathToFileUrl(item.video);

    platformInput.addEventListener("input", () => updatePublishItem(item.id, "platform", platformInput.value));
    scheduledInput.addEventListener("input", () => updatePublishItem(item.id, "scheduledFor", scheduledInput.value));
    statusInput.addEventListener("input", () => updatePublishItem(item.id, "status", statusInput.value));
    caption.addEventListener("input", () => updatePublishItem(item.id, "caption", caption.value));
    hashtags.addEventListener("input", () => updatePublishItem(item.id, "hashtags", hashtags.value));
    publicVideoUrl.addEventListener("input", () => updatePublishItem(item.id, "publicVideoUrl", publicVideoUrl.value));
    node.querySelector(".mark-ready").addEventListener("click", () => updatePublishItem(item.id, "status", "ready", true));
    node.querySelector(".mark-scheduled").addEventListener("click", () => updatePublishItem(item.id, "status", "scheduled", true));
    node.querySelector(".mark-held").addEventListener("click", () => updatePublishItem(item.id, "status", "held", true));
    node.querySelector(".prepare-instagram").addEventListener("click", () => prepareInstagramItem(item.id));

    list.appendChild(node);
  });
  renderPublishTimeline();
}

function updatePublishItem(id, field, value, rerender = false) {
  const item = state.publishingQueue.find((entry) => entry.id === id);
  if (!item) return;
  item[field] = value;
  save();
  renderPublishTimeline();
  if (rerender) renderPublishingQueue();
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
    postingWindow: $("#postingWindow")?.value || "evening",
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
    postingWindow: "evening",
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
  setStatus("#renderBatchStatus", "Creating review batch. This can take a few minutes...");
  try {
    const result = await postBackend("/api/render/batch", {
      count: settings.renderBatchSize,
      renderPreset: settings.renderPreset,
      minSeconds: settings.renderMinSeconds,
      maxSeconds: settings.renderMaxSeconds,
      fadeOutSeconds: settings.renderFadeSeconds,
      renderTimeoutSeconds: 300,
      cooldownDays: settings.postingCooldown,
      templateMode: "rotate"
    });
    if (result.ok && Array.isArray(result.items) && result.items.length) {
      importReviews(result.items);
      location.hash = "review";
    }
    setStatus("#renderBatchStatus", result.ok
      ? `${result.message} Loaded into Review.`
      : result.message || "Render failed.");
  } catch (error) {
    setStatus("#renderBatchStatus", "Backend is not running. Start the scheduler backend, then try again.");
  }
}

async function loadLatestBatchIntoReview() {
  setStatus("#reviewStatus", "Loading latest rendered batch...");
  try {
    const response = await fetch(`${backendUrl}/api/render/latest`);
    const result = await response.json();
    if (result.ok && Array.isArray(result.items)) {
      importReviews(result.items);
      setStatus("#reviewStatus", result.message || "Latest batch loaded.");
    } else {
      setStatus("#reviewStatus", result.message || "No latest batch found.");
    }
  } catch (error) {
    setStatus("#reviewStatus", "Backend is not running. Start the scheduler backend, then try again.");
  }
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
  setStatus("#apiPublishStatus", "Uploading approved Reel MP4s to R2...");
  try {
    const result = await postBackend("/api/r2/upload-package", {
      postingSettings: getPostingSettings(),
      items: state.publishingQueue
    });
    if (result.ok && Array.isArray(result.items)) {
      state.publishingQueue = result.items.map((item) => normalizePublishItem(item, getPostingSettings()));
      save();
      renderPublishingQueue();
    }
    setStatus("#apiPublishStatus", result.message || "R2 upload finished.");
  } catch (error) {
    setStatus("#apiPublishStatus", "R2 upload failed. Check that the backend is running and R2 secrets are saved.");
  }
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
  const candidates = state.publishingQueue.filter((item) => (item.containerId || item.publicVideoUrl) && item.status !== "posted");
  if (!candidates.length) {
    setStatus("#apiPublishStatus", "No unpublished uploaded Reels are ready.");
    return;
  }
  setStatus("#apiPublishStatus", force ? "Publishing all uploaded Reels now..." : "Checking for due scheduled Reels...");
  try {
    const result = await postBackend("/api/instagram/publish-due", {
      postingSettings: getPostingSettings(),
      items: state.publishingQueue,
      force
    });
    if (result.ok && Array.isArray(result.items)) {
      state.publishingQueue = result.items.map((item) => normalizePublishItem(item, getPostingSettings()));
      save();
      renderPublishingQueue();
    }
    setStatus("#apiPublishStatus", result.message || "Publish check finished.");
  } catch (error) {
    setStatus("#apiPublishStatus", "Publish check failed. Check token, container status, and backend.");
  }
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

function syncView() {
  const requested = (location.hash || "#posting").slice(1);
  const view = requested || "posting";
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
}

function renderAll() {
  renderStats();
  renderTracks();
  renderQueue();
  renderReviews();
  renderPublishingQueue();
  renderPostingCommand();
  renderInstagramSetup();
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

on("#exportApproved", "click", exportApproved);
on("#loadLatestBatchFlow", "click", loadLatestBatchIntoReview);
on("#sendApprovedToQueueFlow", "click", sendApprovedToPublishingQueue);
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

$("#approvedInput").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  const parsed = JSON.parse(await file.text());
  importPublishingQueue(parsed.items || [], parsed.postingSettings || getPostingSettings());
});

on("#loadApprovedFromReview", "click", sendApprovedToPublishingQueue);
on("#uploadApprovedToR2", "click", uploadApprovedToR2FromGui);
on("#publishDueContainers", "click", () => publishDueFromGui());
on("#toggleAutoPublisher", "click", toggleAutoPublisher);
$("#clearPublishingQueue").addEventListener("click", () => {
  if (!confirm("Clear the publishing queue from this browser?")) return;
  state.publishingQueue = [];
  save();
  renderPublishingQueue();
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

loadPostingSettings();
loadInstagramSetup();
renderAll();
