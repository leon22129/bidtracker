const DEFAULT_API_URL = "http://api.yourdomain.com/api";
const API_URL_KEY = "resume_ai_api_url";
const TOKEN_KEY = "resume_ai_access_token";
const PROFILE_DOWNLOAD_PATHS_KEY = "resume_ai_profile_download_paths";
const PROFILE_DIRECTORY_HANDLES_DB = "pdf-app-file-handles";
const PROFILE_DIRECTORY_HANDLES_STORE = "handles";

type StorageArea = {
  get: (keys?: string | string[] | Record<string, unknown>) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

function chromeStorage(): StorageArea | null {
  const candidate = (globalThis as { chrome?: { storage?: { local?: StorageArea } } }).chrome;
  return candidate?.storage?.local ?? null;
}

async function getValue<T>(key: string, fallback: T): Promise<T> {
  const storage = chromeStorage();
  if (storage) {
    const values = await storage.get(key);
    return (values[key] as T | undefined) ?? fallback;
  }
  const value = window.localStorage.getItem(key);
  if (value === null) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

async function setValue<T>(key: string, value: T): Promise<void> {
  const storage = chromeStorage();
  if (storage) {
    await storage.set({ [key]: value });
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export async function getApiBaseUrl(): Promise<string> {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
  return getValue(API_URL_KEY, env?.VITE_BIDTRACKER_API_URL || DEFAULT_API_URL);
}

export async function setApiBaseUrl(value: string): Promise<void> {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/i.test(normalized)) {
    throw new Error("Enter a valid HTTP or HTTPS backend URL.");
  }
  await setValue(API_URL_KEY, normalized);
}

export const authStorage = {
  getToken: () => getValue<string | null>(TOKEN_KEY, null),
  setToken: (token: string) => setValue(TOKEN_KEY, token),
  clearToken: () => {
    const storage = chromeStorage();
    return storage ? storage.remove(TOKEN_KEY) : Promise.resolve(window.localStorage.removeItem(TOKEN_KEY));
  },
};

export type ProfileDownloadPaths = Record<string, string>;

export async function getProfileDownloadPaths(): Promise<ProfileDownloadPaths> {
  return getValue(PROFILE_DOWNLOAD_PATHS_KEY, {});
}

export async function setProfileDownloadPath(profileId: string, path: string): Promise<void> {
  const paths = await getProfileDownloadPaths();
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => part === "." || part === ".." || /[:*?"<>|]/.test(part))) {
    throw new Error("Enter a relative download path such as Resumes/Go.");
  }
  await setValue(PROFILE_DOWNLOAD_PATHS_KEY, { ...paths, [profileId]: normalized });
}

export async function getCurrentBrowserTabKey(): Promise<string> {
  const chromeApi = (globalThis as { chrome?: { tabs?: { query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number }>> } } }).chrome;
  const tabs = await chromeApi?.tabs?.query({ active: true, currentWindow: true });
  return `tab_${tabs?.[0]?.id ?? "standalone"}`;
}

function openDirectoryHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROFILE_DIRECTORY_HANDLES_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PROFILE_DIRECTORY_HANDLES_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getProfileDirectoryHandle(profileId: string): Promise<FileSystemDirectoryHandle | null> {
  if (!("indexedDB" in window)) return null;
  try {
    const db = await openDirectoryHandleDb();
    return await new Promise((resolve) => {
      const request = db.transaction(PROFILE_DIRECTORY_HANDLES_STORE, "readonly")
        .objectStore(PROFILE_DIRECTORY_HANDLES_STORE).get(`resumeDirHandle:${profileId}`);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setProfileDirectoryHandle(profileId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDirectoryHandleDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(PROFILE_DIRECTORY_HANDLES_STORE, "readwrite")
      .objectStore(PROFILE_DIRECTORY_HANDLES_STORE).put(handle, `resumeDirHandle:${profileId}`);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function chooseProfileDirectory(profileId: string): Promise<string | null> {
  const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("Your browser does not support directory selection.");
  const handle = await picker();
  await setProfileDirectoryHandle(profileId, handle);
  await setProfileDownloadPath(profileId, handle.name);
  return handle.name;
}