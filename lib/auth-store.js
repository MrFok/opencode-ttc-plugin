import { readFile, writeFile, rename, mkdir, rm, chmod, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { randomBytes } from "node:crypto";

export const AUTH_PROVIDER_ID = "opencode-ttc-plugin";
export const LEGACY_AUTH_PROVIDER_IDS = ["the-token-company-plugin"];
const AUTH_FILE_MODE = 0o600;
const AUTH_DIR_MODE = 0o700;

export function getAuthStorePath(env = process.env) {
  const raw = String(env.XDG_DATA_HOME ?? "").trim();
  if (raw && isAbsolute(raw)) {
    return join(raw, "opencode", "auth.json");
  }
  return join(homedir(), ".local", "share", "opencode", "auth.json");
}

export async function readAuthStore({
  authFilePath = getAuthStorePath(),
  readFileImpl = readFile,
  lstatImpl = lstat
} = {}) {
  let stats;
  try {
    stats = await lstatImpl(authFilePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { parsed: {}, source: "missing" };
    throw error;
  }
  if (!stats.isFile()) {
    const err = new Error("auth store path is not a regular file");
    err.code = "AUTH_STORE_NOT_REGULAR_FILE";
    throw err;
  }

  const content = await readFileImpl(authFilePath, "utf8");
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return { parsed: {}, source: "empty" };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const err = new Error("auth store JSON is corrupt and cannot be parsed");
    err.code = "AUTH_STORE_CORRUPT";
    err.cause = error;
    err.rawContent = trimmed;
    throw err;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const err = new Error("auth store JSON is not an object");
    err.code = "AUTH_STORE_NOT_OBJECT";
    throw err;
  }
  return { parsed, source: "parsed" };
}

export function findAuthEntry(parsed, providerIDs = [AUTH_PROVIDER_ID, ...LEGACY_AUTH_PROVIDER_IDS]) {
  if (!parsed || typeof parsed !== "object") return null;
  for (const candidateID of providerIDs) {
    const auth = parsed[candidateID];
    if (auth && typeof auth === "object" && auth.type === "api" && String(auth.key ?? "").trim()) {
      return { providerID: candidateID, key: String(auth.key).trim() };
    }
  }
  return null;
}

export async function hasAuthEntry({
  authFilePath = getAuthStorePath(),
  providerIDs = [AUTH_PROVIDER_ID, ...LEGACY_AUTH_PROVIDER_IDS],
  env = process.env,
  readFileImpl = readFile,
  lstatImpl = lstat
} = {}) {
  // TTC_API_KEY in env is a supported first-class auth source
  if (String(env.TTC_API_KEY ?? "").trim()) {
    return { hasKey: true, providerID: "env" };
  }
  try {
    const { parsed } = await readAuthStore({ authFilePath, readFileImpl, lstatImpl });
    const entry = findAuthEntry(parsed, providerIDs);
    return { hasKey: Boolean(entry), providerID: entry?.providerID ?? null };
  } catch {
    return { hasKey: false, providerID: null };
  }
}

async function atomicWriteJson(authFilePath, parsed, {
  writeFileImpl = writeFile,
  renameImpl = rename,
  mkdirImpl = mkdir,
  chmodImpl = chmod,
  rmImpl = rm
} = {}) {
  await mkdirImpl(dirname(authFilePath), { recursive: true, mode: AUTH_DIR_MODE });
  try {
    await chmodImpl(dirname(authFilePath), AUTH_DIR_MODE);
  } catch {
    // best-effort; some filesystems ignore directory chmod
  }

  const suffix = `${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}`;
  const tempPath = `${authFilePath}.${suffix}.tmp`;
  const body = `${JSON.stringify(parsed, null, 2)}\n`;
  try {
    await writeFileImpl(tempPath, body, { encoding: "utf8", mode: AUTH_FILE_MODE });
    await chmodImpl(tempPath, AUTH_FILE_MODE);
    await renameImpl(tempPath, authFilePath);
    try {
      await chmodImpl(authFilePath, AUTH_FILE_MODE);
    } catch {
      // best-effort; rename may have already applied the mode from the temp file
    }
  } finally {
    await rmImpl(tempPath, { force: true }).catch(() => {});
  }
}

export async function writeAuthEntry({
  apiKey,
  providerID = AUTH_PROVIDER_ID,
  legacyProviderIDs = LEGACY_AUTH_PROVIDER_IDS,
  authFilePath = getAuthStorePath(),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  renameImpl = rename,
  mkdirImpl = mkdir,
  chmodImpl = chmod,
  rmImpl = rm,
  lstatImpl = lstat
} = {}) {
  const trimmed = String(apiKey ?? "").trim();
  if (!trimmed) return { ok: false, reason: "empty_key", authFilePath };

  let parsed;
  try {
    const result = await readAuthStore({ authFilePath, readFileImpl, lstatImpl });
    parsed = result.parsed;
  } catch (error) {
    if (error?.code === "AUTH_STORE_CORRUPT" || error?.code === "AUTH_STORE_NOT_OBJECT") {
      return { ok: false, reason: "auth_store_corrupt", authFilePath, error };
    }
    if (error?.code === "AUTH_STORE_NOT_REGULAR_FILE") {
      return { ok: false, reason: "auth_store_not_regular_file", authFilePath, error };
    }
    return { ok: false, reason: "auth_store_read_failed", authFilePath, error };
  }

  const removedLegacyIDs = [];
  for (const candidateID of legacyProviderIDs) {
    if (candidateID === providerID) continue;
    if (Object.prototype.hasOwnProperty.call(parsed, candidateID)) {
      delete parsed[candidateID];
      removedLegacyIDs.push(candidateID);
    }
  }

  parsed[providerID] = { type: "api", key: trimmed };

  try {
    await atomicWriteJson(authFilePath, parsed, { writeFileImpl, renameImpl, mkdirImpl, chmodImpl, rmImpl });
  } catch (error) {
    return { ok: false, reason: "auth_store_write_failed", authFilePath, error };
  }

  return { ok: true, authFilePath, providerID, removedLegacyIDs };
}

export async function removeAuthEntry({
  providerIDs = [AUTH_PROVIDER_ID, ...LEGACY_AUTH_PROVIDER_IDS],
  authFilePath = getAuthStorePath(),
  readFileImpl = readFile,
  writeFileImpl = writeFile,
  renameImpl = rename,
  mkdirImpl = mkdir,
  chmodImpl = chmod,
  rmImpl = rm,
  lstatImpl = lstat
} = {}) {
  let parsed;
  try {
    const result = await readAuthStore({ authFilePath, readFileImpl, lstatImpl });
    parsed = result.parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: true, authFilePath, removedAny: false };
    }
    if (error?.code === "AUTH_STORE_NOT_REGULAR_FILE") {
      return { ok: false, reason: "auth_store_not_regular_file", authFilePath, error };
    }
    if (error?.code === "AUTH_STORE_CORRUPT" || error?.code === "AUTH_STORE_NOT_OBJECT") {
      return { ok: false, reason: "auth_store_corrupt", authFilePath, error };
    }
    return { ok: false, reason: "auth_store_read_failed", authFilePath, error };
  }

  let removedAny = false;
  for (const candidateID of providerIDs) {
    if (Object.prototype.hasOwnProperty.call(parsed, candidateID)) {
      delete parsed[candidateID];
      removedAny = true;
    }
  }

  if (!removedAny) return { ok: true, authFilePath, removedAny: false };

  try {
    await atomicWriteJson(authFilePath, parsed, { writeFileImpl, renameImpl, mkdirImpl, chmodImpl, rmImpl });
  } catch (error) {
    return { ok: false, reason: "auth_store_write_failed", authFilePath, error };
  }

  return { ok: true, authFilePath, removedAny: true };
}
