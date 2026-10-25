import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve, basename } from "node:path";

// Mirrors db.ts's dataDir without a cross-extension TS import (ocr-worker.mjs
// runs under plain node, which cannot load .ts files).
const dataDir = resolve(/* turbopackIgnore: true */ process.env.HUMETO_DATA_DIR || ".data");

// Dual-backend object storage for uploaded documents and OCR previews.
// Supabase Storage is used when configured (required in production, since
// Vercel's serverless filesystem is ephemeral and does not persist
// HUMETO_DATA_DIR between invocations). Falls back to local disk for
// development/testing when Supabase env vars are not set. Shared as a
// plain .mjs module so both the Next.js app (TypeScript) and the standalone
// worker scripts (plain .mjs, run directly by node) use one implementation.

let client;

function supabase() {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client =
    url && key
      ? createClient(url, key, { auth: { persistSession: false } })
      : null;
  return client;
}

export function storageBackend() {
  return supabase() ? "supabase" : "local";
}

function bucket() {
  const b = process.env.SUPABASE_STORAGE_BUCKET;
  if (!b) throw Error("SUPABASE_STORAGE_BUCKET is not configured.");
  return b;
}

// key is a relative path, e.g. "uploads/<stored-name>" or "ocr/<job>/<file>".
function assertSafeKey(key) {
  if (key.includes("..") || key.startsWith("/"))
    throw Error("Invalid storage key.");
}

export async function putObject(key, bytes, contentType) {
  assertSafeKey(key);
  const sb = supabase();
  if (sb) {
    const { error } = await sb.storage
      .from(bucket())
      .upload(key, bytes, { upsert: true, contentType });
    if (error) throw Error("Storage write failed: " + error.message);
    return;
  }
  const path = resolve(dataDir, key);
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600 });
}

export async function getObject(key) {
  assertSafeKey(key);
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb.storage.from(bucket()).download(key);
    if (error || !data)
      throw Error("Storage read failed: " + (error?.message || "not found"));
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(resolve(dataDir, key));
}

// A signed, one-time upload URL the browser can PUT a file to directly,
// bypassing the Next.js server entirely for the file bytes. This is required
// for large files in production: Vercel serverless functions reject request
// bodies above ~4.5 MB with a plain-text "Request Entity Too Large" error
// (not JSON), which breaks a normal FormData upload through an API route
// long before reaching our own 15 MB document-size limit. Returns null when
// Supabase isn't configured (local dev), so callers fall back to posting the
// file through the API route as before — body size isn't a constraint
// outside of Vercel's serverless runtime.
export async function createUploadTarget(key) {
  assertSafeKey(key);
  const sb = supabase();
  if (!sb) return null;
  const { data, error } = await sb.storage
    .from(bucket())
    .createSignedUploadUrl(key);
  if (error) throw Error("Could not prepare an upload slot: " + error.message);
  return { path: data.path, token: data.token };
}

export async function deleteObject(key) {
  assertSafeKey(key);
  const sb = supabase();
  if (sb) {
    const { error } = await sb.storage.from(bucket()).remove([key]);
    if (error) throw Error("Storage delete failed: " + error.message);
    return;
  }
  await unlink(resolve(dataDir, key)).catch(() => {});
}

// Validates a stored filename has no path-traversal component, matching the
// checks already performed at call sites before this module existed.
export function assertStoredName(name) {
  if (basename(name) !== name)
    throw Error("The stored source path is invalid.");
}
