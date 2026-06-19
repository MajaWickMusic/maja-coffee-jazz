import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const env = await loadEnv(join(rootDir, ".env"));
const args = parseArgs(process.argv.slice(2));

const packagePath = args.package || join(process.env.USERPROFILE || ".", "Downloads", "posting-package-uploaded.json");
const outPath = args.out || packagePath.replace(/\.json$/i, "-containers.json");
const dryRun = Boolean(args["dry-run"]) || env.PUBLISHING_MODE !== "test";
const graphVersion = env.META_GRAPH_VERSION || "v23.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;

const required = ["IG_USER_ID", "META_ACCESS_TOKEN"];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  throw new Error(`Missing Meta settings in backend .env: ${missing.join(", ")}`);
}

const payload = JSON.parse(await readFile(packagePath, "utf8"));
const items = Array.isArray(payload.items) ? payload.items : [];
if (!items.length) throw new Error(`No items found in ${packagePath}`);

const results = [];
for (const item of items) {
  const caption = compactCaption(item.caption, item.hashtags);
  const publicVideoUrl = String(item.publicVideoUrl || "").trim();

  if (!/^https:\/\//i.test(publicVideoUrl)) {
    results.push({ ...item, containerStatus: "missing-public-video-url" });
    continue;
  }

  if (!caption) {
    results.push({ ...item, containerStatus: "missing-caption" });
    continue;
  }

  if (dryRun) {
    results.push({
      ...item,
      containerStatus: "dry-run",
      containerRequest: {
        media_type: "REELS",
        video_url: publicVideoUrl,
        caption,
        share_to_feed: true
      }
    });
    console.log(`Prepared container request for ${item.title}`);
    continue;
  }

  const response = await graphPost(`/${env.IG_USER_ID}/media`, {
    media_type: "REELS",
    video_url: publicVideoUrl,
    caption,
    share_to_feed: "true"
  });

  results.push({
    ...item,
    containerStatus: response.ok ? "container-created" : "container-error",
    containerId: response.body?.id || "",
    containerCreatedAt: response.ok ? new Date().toISOString() : "",
    containerError: response.ok ? "" : response.body || response.error || response.status
  });

  console.log(`${response.ok ? "Created" : "Failed"} container for ${item.title}${response.body?.id ? `: ${response.body.id}` : ""}`);
}

const resultPayload = {
  ...payload,
  containerRunAt: new Date().toISOString(),
  dryRun,
  items: results
};

await writeFile(outPath, JSON.stringify(resultPayload, null, 2), "utf8");
console.log(`Wrote ${outPath}`);

async function graphPost(path, params) {
  const body = new URLSearchParams({
    ...params,
    access_token: env.META_ACCESS_TOKEN
  });

  try {
    const result = await fetch(`${graphBase}${path}`, {
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
      body: redact(payload)
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

function compactCaption(caption = "", hashtags = "") {
  return [caption, hashtags]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 2200);
}

function redact(value) {
  if (!value || typeof value !== "object") return value;
  const clone = structuredClone(value);
  if (clone.access_token) clone.access_token = "[redacted]";
  return clone;
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

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const arg = values[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
