import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const env = await loadEnv(join(rootDir, ".env"));
const args = parseArgs(process.argv.slice(2));

const packagePath = args.package || join(process.env.USERPROFILE || ".", "Downloads", "posting-package.json");
const outPath = args.out || packagePath.replace(/\.json$/i, "-uploaded.json");
const dryRun = Boolean(args["dry-run"]);
const fromClipboard = Boolean(args["from-clipboard"]);

const required = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_PUBLIC_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const missing = required.filter((key) => !env[key]);
if (missing.length) {
  throw new Error(`Missing R2 settings in backend .env: ${missing.join(", ")}`);
}

const packageText = fromClipboard ? readClipboard() : await readFile(packagePath, "utf8");
let payload;
try {
  payload = JSON.parse(packageText);
} catch (error) {
  throw new Error(
    "Package data is not valid JSON. In the app, click Export package, click Copy package JSON, then run the upload command with -FromClipboard."
  );
}
const items = Array.isArray(payload.items) ? payload.items : [];
if (!items.length) throw new Error(`No items found in ${packagePath}`);

const uploaded = [];
for (const item of items) {
  if (!item.video || !existsSync(item.video)) {
    uploaded.push({ ...item, uploadStatus: "missing-video" });
    continue;
  }

  const key = objectKey(item);
  const publicVideoUrl = `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;

  if (!dryRun) {
    const bytes = await readFile(item.video);
    await putObject({
      key,
      bytes,
      contentType: "video/mp4"
    });
  }

  uploaded.push({
    ...item,
    publicVideoUrl,
    uploadStatus: dryRun ? "dry-run" : "uploaded",
    uploadedAt: new Date().toISOString()
  });

  console.log(`${dryRun ? "Prepared" : "Uploaded"} ${basename(item.video)} -> ${publicVideoUrl}`);
}

const result = {
  ...payload,
  uploadedAt: new Date().toISOString(),
  r2Bucket: env.R2_BUCKET,
  items: uploaded
};

await writeFile(outPath, JSON.stringify(result, null, 2), "utf8");
console.log(`Wrote ${outPath}`);

async function putObject({ key, bytes, contentType }) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const path = `/${env.R2_BUCKET}/${key}`;
  const endpoint = `https://${host}${path}`;
  const now = new Date();
  const amzDate = isoAmz(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = hashHex(bytes);

  const headers = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };

  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");

  const canonicalRequest = [
    "PUT",
    encodePath(path),
    "",
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

  const signingKey = getSigningKey(env.R2_SECRET_ACCESS_KEY, dateStamp, "auto", "s3");
  const signature = hmacHex(signingKey, stringToSign);

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${env.R2_ACCESS_KEY_ID}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ");

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      ...headers,
      authorization
    },
    body: bytes
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`R2 upload failed ${response.status}: ${body.slice(0, 500)}`);
  }
}

function objectKey(item) {
  const scheduled = String(item.scheduledFor || new Date().toISOString()).slice(0, 10);
  const title = slug(item.title || "untitled");
  const id = slug(item.isrc || item.id || Date.now());
  return `reels/${scheduled}/${title}-${id}.mp4`;
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled";
}

function encodePath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
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

function getSigningKey(secret, dateStamp, region, service) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function isoAmz(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
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

function readClipboard() {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", "Get-Clipboard -Raw"], {
      encoding: "utf8",
      windowsHide: true
    });
  } catch (error) {
    throw new Error("Could not read clipboard. Copy the package JSON from the app, then run this command again.");
  }
}
