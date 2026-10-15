import { cleanName, MIME, validateImportSize } from "./model.js";
import {
  usingHost,
  libraryDir,
  listLibrary,
  removeFromLibrary,
  readPath,
  writeToPath,
  saveToLibrary,
  importFiles,
  saveFileAs as saveLocalFileAs,
  downloadBlob as browserDownloadBlob,
  localUser,
  dedupeName,
  opfsList,
  opfsRead,
  opfsWrite,
  opfsRemove,
} from "./otools/local.js";

export const FOLDER = "Presentations";
const OPFS_PREFIX = "opfs:";
const movedPaths = new Map();

export const isApp = () => usingHost();
export const canSignOut = () => false;
export async function user() {
  return localUser();
}
export async function profilePicture() {
  return null;
}
export async function signIn() {
  return localUser();
}
export async function signOut() {}

const authHandlers = new Set();
export function onAuth(handler) {
  if (typeof handler !== "function") return () => {};
  authHandlers.add(handler);
  return () => authHandlers.delete(handler);
}

const opfsName = (path) =>
  String(path || "").startsWith(OPFS_PREFIX)
    ? String(path).slice(OPFS_PREFIX.length)
    : null;
const pathName = (path) => String(path || "").split(/[\\/]/).pop();
const seconds = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? (n >= 1e12 ? n / 1000 : n) : undefined;
};
const localItem = (item, overrides = {}) => {
  const path = String(overrides.path || item?.path || "");
  const name = String(overrides.name || item?.name || pathName(path));
  return {
    ...item,
    ...overrides,
    path,
    name,
    uid: overrides.uid || item?.uid || path,
    is_dir: false,
    isDirectory: false,
    modified: seconds(overrides.modified ?? item?.modified),
  };
};
const samePath = (a, b) =>
  String(a || "").replaceAll("\\", "/").toLowerCase() ===
  String(b || "").replaceAll("\\", "/").toLowerCase();
const childPath = (path, name) => {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash < 0 ? name : path.slice(0, slash + 1) + name;
};
const hostBridge = () => globalThis.otoolsPuterPresentation || null;

export async function listFiles() {
  const items = usingHost() ? await listLibrary() : await opfsList();
  return items
    .filter((item) => !item.isDir && isPptxName(item.name))
    .map((item) => {
      const path = usingHost()
        ? item.path
        : String(item.path || "").startsWith(OPFS_PREFIX)
          ? item.path
          : `${OPFS_PREFIX}${item.name}`;
      return localItem(item, { path });
    });
}

export function isNotFound(error) {
  const code = error?.code || error?.error?.code || "";
  const message = String(
    error?.message || error?.error?.message || error?.msg || "",
  ).toLowerCase();
  return (
    code === "subject_does_not_exist" ||
    code === "ENOENT" ||
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("no such")
  );
}
export const displayName = (path) =>
  String(path || "")
    .split("/")
    .pop();
export const isPptxName = (name) => /\.pptx$/i.test(String(name || ""));
export const inTrash = (path) =>
  typeof path === "string" && /^(?:\/[^/]+|~)\/Trash(?:\/|$)/.test(path);
export const isDirItem = (item) =>
  !!(item?.is_dir || item?.isDirectory || item?.isDir || item?.fsentry_is_dir);
export function folderName(path) {
  const parts = String(path || "").split("/");
  return parts.length > 2 ? parts.at(-2) : "";
}
export function inAppFolder(path) {
  const parts = String(path || "").split("/");
  return parts.length >= 2 && parts.at(-2) === FOLDER;
}
export function modifiedMs(item) {
  const m = item?.modified ?? item?.created;
  if (m == null || m === "") return null;
  const n = typeof m === "number" ? m : Number(m) || new Date(m).getTime();
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}
export function sizeOf(item) {
  const size = Number(item?.size);
  return Number.isFinite(size) && size > 0 ? size : null;
}

export const canStat = () => usingHost();
export async function stat(path) {
  if (!path) return null;
  const name = opfsName(path);
  if (name != null) {
    const blob = await opfsRead(name);
    return blob
      ? localItem({ path, name, size: blob.size }, { path, name })
      : null;
  }
  if (!usingHost()) return null;
  const listed = (await listLibrary()).find((item) => samePath(item.path, path));
  if (listed) return localItem(listed);
  const blob = await readPath(path);
  return blob
    ? localItem({ path, name: pathName(path), size: blob.size })
    : null;
}
export async function statByUid(uid) {
  if (!uid || !canStat()) return null;
  const path = movedPaths.get(uid) || uid;
  const found = await stat(path);
  return found ? { ...found, uid } : null;
}

async function blobAt(path) {
  const name = opfsName(path);
  return name != null ? opfsRead(name) : readPath(path);
}
export async function readFile(path, { importing = false } = {}) {
  const blob = await blobAt(path);
  if (!blob) {
    throw Object.assign(new Error(`File not found: ${path}`), { code: "ENOENT" });
  }
  if (importing) validateImportSize(blob.size);
  return new Uint8Array(await blob.arrayBuffer());
}
export async function saveFile(bytes, name, path = null) {
  const blob = new Blob([bytes], { type: MIME });
  if (path) {
    const opfs = opfsName(path);
    if (opfs != null) {
      await opfsWrite(opfs, blob);
      return localItem(
        { path, name: opfs, size: blob.size },
        { modified: Date.now() / 1000 },
      );
    }
    const saved = await writeToPath(path, blob);
    return localItem(saved, {
      size: blob.size,
      modified: Date.now() / 1000,
      uid: path,
    });
  }
  const filename = `${cleanName(name, {
    stripExtension: false,
    maxLength: Infinity,
  })}.pptx`;
  if (usingHost()) {
    const savedPath = await saveToLibrary(blob, filename);
    return localItem(
      { path: savedPath, name: pathName(savedPath), size: blob.size },
      { modified: Date.now() / 1000 },
    );
  }
  const taken = (await opfsList()).map((item) => item.name);
  const savedName = dedupeName(filename, taken);
  await opfsWrite(savedName, blob);
  return localItem(
    { path: `${OPFS_PREFIX}${savedName}`, name: savedName, size: blob.size },
    { modified: Date.now() / 1000 },
  );
}
export async function renameFile(path, name) {
  const fileName = `${cleanName(name)}.pptx`;
  const target = childPath(path, fileName);
  if (!samePath(target, path) && (await stat(target))) {
    throw Object.assign(
      new Error(
        `A file named “${fileName}” is already in that folder. Choose another name.`,
      ),
      { code: "exists" },
    );
  }
  const opfs = opfsName(path);
  if (opfs != null) {
    const blob = await opfsRead(opfs);
    if (!blob) throw Object.assign(new Error(`File not found: ${path}`), { code: "ENOENT" });
    await opfsWrite(fileName, blob);
    if (fileName !== opfs) await opfsRemove(opfs);
  } else {
    const dir = await libraryDir({ create: false });
    if (dir && samePath(childPath(path, ""), `${dir}/`)) {
      const blob = await readPath(path);
      if (!blob) throw Object.assign(new Error(`File not found: ${path}`), { code: "ENOENT" });
      await writeToPath(target, blob);
      if (!samePath(target, path)) await removeFromLibrary(pathName(path));
    } else {
      const bridge = hostBridge();
      if (!bridge?.renameEntry)
        throw new Error("The OTools host cannot rename this file.");
      await bridge.renameEntry(path, target);
    }
  }
  movedPaths.set(path, target);
  const renamed = await stat(target);
  return localItem(renamed || { path: target, name: fileName }, {
    path: target,
    name: fileName,
    uid: path,
  });
}
export async function deleteFile(path) {
  const opfs = opfsName(path);
  if (opfs != null) return opfsRemove(opfs);
  const dir = await libraryDir({ create: false });
  if (dir && samePath(childPath(path, ""), `${dir}/`))
    return removeFromLibrary(pathName(path));
  const bridge = hostBridge();
  if (!bridge?.removeEntry)
    throw new Error("The OTools host cannot delete this file.");
  return bridge.removeEntry(path);
}

export const canPickFiles = () => usingHost();
export const canSaveFiles = () => usingHost();
export async function pickFile({ accept = [".pptx"] } = {}) {
  const files = await importFiles({
    accept: Array.isArray(accept) ? accept.join(",") : String(accept),
    multiple: false,
  });
  return files[0] || null;
}
export async function saveFileAs(blob, suggestedName) {
  return saveLocalFileAs(blob, suggestedName);
}

export function onLaunch(_handler) {}
export function setWindowTitle(_title) {}
export function onWindowClose(_handler) {
  return false;
}
export function exitApp() {
  try {
    globalThis.close?.();
  } catch {}
}

export async function download(bytes, name) {
  return downloadBlob(
    new Blob([bytes], { type: MIME }),
    `${cleanName(name, { stripExtension: false, maxLength: Infinity })}.pptx`,
  );
}
export async function downloadBlob(blob, filename) {
  if (usingHost()) {
    const saved = await saveLocalFileAs(blob, filename);
    return saved ? { saved } : { cancelled: true };
  }
  browserDownloadBlob(blob, filename);
  return { downloaded: true };
}

export class SaveQueue {
  constructor() {
    this.tail = Promise.resolve();
  }
  run(work) {
    const next = this.tail.then(work);
    this.tail = next.catch(() => {});
    return next;
  }
}

export const canAI = () => false;
export async function* aiChatStream() {
  throw new Error("Cloud AI is disabled in the OTools plugin.");
}
