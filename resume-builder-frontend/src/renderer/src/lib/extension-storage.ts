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

export async function getCurrentBrowserTabUrl(): Promise<string> {
  const chromeApi = (globalThis as { chrome?: { tabs?: { query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<Array<{ url?: string }>> } } }).chrome;
  const tabs = await chromeApi?.tabs?.query({ active: true, currentWindow: true });
  const url = tabs?.[0]?.url?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("Open a job posting in the active browser tab before generating.");
  }
  return url;
}

export type PageQuestion = {
  question: string;
  fieldType: string;
  options: string[];
  sensitive: boolean;
};

export type CurrentPageContext = {
  url: string;
  title: string;
  jobTitle: string;
  jobDescription: string;
  jobDescriptionSource: string | null;
  questions: PageQuestion[];
};

export type PageFillResult = {
  filled: number;
  skipped: number;
  skippedQuestions: string[];
};

export type PageAutofillProfile = {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  country: string;
  address1: string;
  city: string;
  county: string;
  state: string;
  zip: string;
  linkedin: string;
  gender: string;
  hispanicLatino: string;
  ethnicity: string;
  requiresSponsorship: string;
  legallyAuthorizedUs: string;
};

type ExtensionTabsApi = {
  query: (queryInfo: { active: boolean; currentWindow: boolean }) => Promise<Array<{ id?: number; url?: string }>>;
  sendMessage: (tabId: number, message: unknown, options?: { frameId?: number }) => Promise<unknown>;
};

type ExtensionWebNavigationApi = {
  getAllFrames: (details: { tabId: number }) => Promise<Array<{ frameId: number; url: string }> | null>;
};

function extensionTabs(): ExtensionTabsApi | null {
  return (globalThis as { chrome?: { tabs?: ExtensionTabsApi } }).chrome?.tabs ?? null;
}

function extensionWebNavigation(): ExtensionWebNavigationApi | null {
  return (globalThis as { chrome?: { webNavigation?: ExtensionWebNavigationApi } }).chrome?.webNavigation ?? null;
}

type FrameMessageResponse<T> = {
  frameId: number;
  value: T;
};

async function sendToCurrentPageFrames<T>(message: unknown): Promise<{
  tabUrl: string;
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

  const responses = (await Promise.all(frameIds.map(async (frameId) => {
    try {
      const value = await tabsApi.sendMessage(tab.id as number, message, { frameId }) as T;
      return { frameId, value };
    } catch {
      return null;
    }
  }))).filter((response): response is FrameMessageResponse<T> => response !== null);

  if (!responses.length) {
    throw new Error("This page cannot be scanned. Reload the job page after updating the extension, or enter the content manually.");
  }
  return { tabUrl: tab.url, responses };
}

export function canScanCurrentPage(): boolean {
  return Boolean(extensionTabs()?.sendMessage);
}

export async function getCurrentPageContext(): Promise<CurrentPageContext> {
  const { tabUrl, responses } = await sendToCurrentPageFrames<CurrentPageContext>({ type: "RESUME_AI_EXTRACT_PAGE" });
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
    jobDescription: descriptionContext.jobDescription,
    jobDescriptionSource: descriptionContext.jobDescriptionSource,
    questions: [...questions.values()],
  };
}

export async function fillCurrentPageAnswers(
  answers: Array<{ question: string; answer: string }>,
  profile: PageAutofillProfile,
  coverLetterText?: string,
): Promise<PageFillResult> {
  type DetailedPageFillResult = PageFillResult & { filledQuestions?: string[] };
  const { responses } = await sendToCurrentPageFrames<DetailedPageFillResult>({
    type: "RESUME_AI_FILL_ANSWERS",
    answers,
    profile,
    coverLetterText,
  });
  const results = responses.map(({ value }) => value).filter(Boolean);
  const normalizeQuestion = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const filledQuestions = new Set(results.flatMap((result) => result.filledQuestions ?? []).map(normalizeQuestion));
  const skippedQuestions = [...new Map(results
    .flatMap((result) => result.skippedQuestions ?? [])
    .filter((question) => !filledQuestions.has(normalizeQuestion(question)))
    .map((question) => [normalizeQuestion(question), question])).values()];

  return {
    filled: results.reduce((total, result) => total + (result.filled || 0), 0),
    skipped: skippedQuestions.length,
    skippedQuestions,
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
