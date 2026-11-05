const DEFAULT_API_URL = "https://bidtracker365.com/api";
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

export async function getCurrentBrowserTabUrl(): Promise<string> {
  return (await getCurrentBrowserTabContext()).url;
}

export async function getCurrentBrowserTabContext(): Promise<{ url: string; tabId?: number }> {
  const chromeApi = (globalThis as { chrome?: { tabs?: { query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number; url?: string }>> } } }).chrome;
  const tabs = await chromeApi?.tabs?.query({ active: true, currentWindow: true });
  const url = tabs?.[0]?.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Open a job posting in the active browser tab before generating.");
  }
  return { url, tabId: tabs?.[0]?.id };
}

export async function getBrowserTabContext(tabId: number): Promise<{ url: string; tabId: number }> {
  const api = (globalThis as { chrome?: { tabs?: { get: (id: number) => Promise<{ url?: string }> } } }).chrome;
  const tab = await api?.tabs?.get(tabId).catch(() => null);
  if (!tab?.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error("The linked job page is closed or unavailable. Open the linked job before generating.");
  }
  return { url: tab.url, tabId };
}

export async function openBrowserJobPage(url: string, tabId?: number): Promise<{ url: string; tabId: number }> {
  const api = (globalThis as { chrome?: { tabs?: {
    get: (id: number) => Promise<{ url?: string }>;
    update: (id: number, options: { active: boolean }) => Promise<unknown>;
    create: (options: { url: string; active: boolean }) => Promise<{ id?: number }>;
  } } }).chrome;
  if (!api?.tabs || !/^https?:\/\//i.test(url)) throw new Error("Open the job posting in Chrome and link its page first.");
  const existing = tabId === undefined ? null : await api.tabs.get(tabId).catch(() => null);
  if (existing?.url === url && tabId !== undefined) {
    await api.tabs.update(tabId, { active: true });
    return { url, tabId };
  }
  const tab = await api.tabs.create({ url, active: true });
  if (tab.id === undefined) throw new Error("The linked job page could not be opened.");
  return { url, tabId: tab.id };
}

export async function armApplicationScreenshot(
  applicationId: string,
  details: { companyName?: string; jobTitle?: string; draft?: boolean; tabId?: number; url?: string; profileTabId: string },
): Promise<void> {
  const chromeApi = (globalThis as { chrome?: {
    tabs?: { query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number }>> };
    runtime?: { sendMessage: (message: unknown) => Promise<{ ok?: boolean; error?: string }> };
  } }).chrome;
  if (!chromeApi?.tabs || !chromeApi.runtime) return;
  const tabId = details.tabId ?? (await chromeApi.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) return;
  const result = await chromeApi.runtime.sendMessage({
    type: "ARM_APPLICATION_SCREENSHOT",
    tabId,
    applicationId,
    draftId: details.draft === false ? undefined : applicationId,
    ...details,
  });
  if (!result?.ok) throw new Error(result?.error || "Unable to watch for application submission.");
}

export async function clearProfileTabScreenshot(profileTabId: string): Promise<void> {
  const api = (globalThis as { chrome?: { runtime?: { sendMessage: (message: unknown) => Promise<unknown> } } }).chrome;
  await api?.runtime?.sendMessage({ type: "CLEAR_PROFILE_TAB_SCREENSHOT", profileTabId });
}

export type PageQuestion = {
  question: string;
  fieldType: string;
  options: string[];
  sensitive: boolean;
};

export type CurrentPageContext = {
  url: string;
  tabId?: number;
  title: string;
  jobTitle: string;
  jobDescription: string;
  jobDescriptionSource: string | null;
  questions: PageQuestion[];
};

type ExtensionTabsApi = {
  query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number; url?: string }>>;
  sendMessage: (tabId: number, message: unknown, options?: { frameId?: number }) => Promise<unknown>;
};

type ExtensionWebNavigationApi = {
  getAllFrames: (details: { tabId: number }) => Promise<Array<{ frameId: number; url: string }> | null>;
};

type ExtensionScriptingApi = {
  executeScript: (details: {
    target: { tabId: number; frameIds?: number[] };
    files: string[];
  }) => Promise<Array<{ frameId: number; result?: unknown }>>;
};

function extensionTabs(): ExtensionTabsApi | null {
  return (globalThis as { chrome?: { tabs?: ExtensionTabsApi } }).chrome?.tabs ?? null;
}

function extensionWebNavigation(): ExtensionWebNavigationApi | null {
  return (globalThis as { chrome?: { webNavigation?: ExtensionWebNavigationApi } }).chrome?.webNavigation ?? null;
}

function extensionScripting(): ExtensionScriptingApi | null {
  return (globalThis as { chrome?: { scripting?: ExtensionScriptingApi } }).chrome?.scripting ?? null;
}

type FrameMessageResponse<T> = {
  frameId: number;
  value: T;
};

async function sendToCurrentPageFrames<T>(message: unknown): Promise<{
  tabUrl: string;
  tabId: number;
  responses: Array<FrameMessageResponse<T>>;
}> {
  const tabsApi = extensionTabs();
  if (!tabsApi?.sendMessage) {
    throw new Error("Page scanning is available when Resume Builder is installed as a Chrome extension.");
  }
  const [tab] = await tabsApi.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    throw new Error("Open a job posting in the active browser tab first.");
  }

  let frameIds = [0];
  try {
    const frames = await extensionWebNavigation()?.getAllFrames({ tabId: tab.id });
    if (frames?.length) frameIds = [...new Set(frames.map((frame) => frame.frameId))];
  } catch {
    // Fall back to the top frame when frame enumeration is unavailable.
  }

  const sendToFrame = async (frameId: number) => {
    try {
      const value = await tabsApi.sendMessage(tab.id as number, message, { frameId }) as T;
      return { frameId, value };
    } catch {
      return null;
    }
  };

  const firstAttempts = await Promise.all(frameIds.map(sendToFrame));
  const responses = firstAttempts.filter((response): response is FrameMessageResponse<T> => response !== null);
  const missingFrameIds = frameIds.filter((_frameId, index) => firstAttempts[index] === null);

  // Declarative content scripts are not added retroactively to tabs that were
  // already open when the extension was installed or reloaded. Inject only into
  // frames with no listener, then retry so the user does not need to refresh.
  const scriptingApi = extensionScripting();
  if (missingFrameIds.length && scriptingApi?.executeScript) {
    const injectedResponses = await Promise.all(missingFrameIds.map(async (frameId) => {
      try {
        await scriptingApi.executeScript({
          target: { tabId: tab.id as number, frameIds: [frameId] },
          files: ["content-script.js", "application-capture.js"],
        });
        return await sendToFrame(frameId);
      } catch {
        // Restricted or sandboxed frames cannot be scripted. Other readable
        // frames can still provide the job description and application fields.
        return null;
      }
    }));
    responses.push(...injectedResponses.filter(
      (response): response is FrameMessageResponse<T> => response !== null,
    ));
  }

  if (!responses.length) {
    throw new Error("This page does not allow the extension to read its job or application content.");
  }
  return { tabUrl: tab.url, tabId: tab.id, responses };
}

export function canScanCurrentPage(): boolean {
  return Boolean(extensionTabs()?.sendMessage);
}

export async function getCurrentPageContext({ includeQuestions = true }: { includeQuestions?: boolean } = {}): Promise<CurrentPageContext> {
  const { tabUrl, tabId, responses } = await sendToCurrentPageFrames<CurrentPageContext>({
    type: "RESUME_AI_EXTRACT_PAGE",
    includeQuestions,
  });
  const contexts = responses.filter(({ value }) => value && Array.isArray(value.questions));
  if (!contexts.length) throw new Error("No readable job or application content was found on this page.");

  const primary = contexts.find(({ frameId }) => frameId === 0)?.value ?? contexts[0].value;
  const descriptionContext = contexts.reduce((best, current) =>
    current.value.jobDescription.length > best.value.jobDescription.length ? current : best,
  ).value;
  const questions = new Map<string, PageQuestion>();
  for (const { value } of contexts) {
    for (const question of value.questions) {
      const key = question.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const existing = questions.get(key);
      if (!existing || question.options.length > existing.options.length) questions.set(key, question);
    }
  }

  return {
    ...primary,
    url: tabUrl,
    tabId,
    jobDescription: descriptionContext.jobDescription,
    jobDescriptionSource: descriptionContext.jobDescriptionSource,
    questions: [...questions.values()],
  };
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
    try {
      return await new Promise((resolve, reject) => {
        const request = db.transaction(PROFILE_DIRECTORY_HANDLES_STORE, "readonly")
          .objectStore(PROFILE_DIRECTORY_HANDLES_STORE).get(`resumeDirHandle:${profileId}`);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  } catch (cause) {
    throw new Error("Unable to read the saved download folder. Check the location in profile settings.", { cause });
  }
}

export async function setProfileDirectoryHandle(profileId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDirectoryHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROFILE_DIRECTORY_HANDLES_STORE, "readwrite");
      transaction.objectStore(PROFILE_DIRECTORY_HANDLES_STORE).put(handle, `resumeDirHandle:${profileId}`);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function clearProfileDirectoryHandle(profileId: string): Promise<void> {
  if (!("indexedDB" in window)) return;
  const db = await openDirectoryHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(PROFILE_DIRECTORY_HANDLES_STORE, "readwrite");
      transaction.objectStore(PROFILE_DIRECTORY_HANDLES_STORE).delete(`resumeDirHandle:${profileId}`);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function chooseProfileDirectory(profileId: string): Promise<string | null> {
  const picker = (window as Window & { showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error("Your browser does not support directory selection.");
  const handle = await picker.call(window, { mode: "readwrite" });
  await setProfileDirectoryHandle(profileId, handle);
  await setProfileDownloadPath(profileId, handle.name);
  return handle.name;
}
