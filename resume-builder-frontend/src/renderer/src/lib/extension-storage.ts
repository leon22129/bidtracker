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
  firstName: string;
  middleName: string;
  lastName: string;
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
  usWorkStatus: string;
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
    target: { tabId: number; frameIds?: number[]; allFrames?: boolean };
    files?: string[];
    func?: (...args: never[]) => unknown;
    args?: unknown[];
    world?: "ISOLATED" | "MAIN";
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
          files: ["content-script.js"],
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
  return { tabUrl: tab.url, responses };
}

export function canScanCurrentPage(): boolean {
  return Boolean(extensionTabs()?.sendMessage);
}

/**
 * ADP's application form is React-controlled and restores values written from
 * an extension's isolated world. This function is deliberately self-contained
 * because Chrome serializes it and executes it in the page's MAIN world.
 */
async function autofillAdpInPageWorld(profile: PageAutofillProfile): Promise<({
  filled: number;
  skipped: number;
  skippedQuestions: string[];
  filledQuestions: string[];
}) | null> {
  const firstNameField = document.getElementById("personalInfomationFirstName");
  const addressFieldCandidate = document.getElementById("PersonalAddress_address_line1");
  if (!(firstNameField instanceof HTMLInputElement) && !(addressFieldCandidate instanceof HTMLInputElement)) {
    return null;
  }

  const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
  const normalized = (value: unknown) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const splitName = text(profile.fullName).split(" ").filter(Boolean);
  const fallbackNames = {
    firstName: splitName[0] ?? "",
    middleName: splitName.length > 2 ? splitName.slice(1, -1).join(" ") : "",
    lastName: splitName.length > 1 ? splitName.at(-1) ?? "" : "",
  };
  const fieldNames = new Map<string, string>([
    ["personalInfomationFirstName", "First Name"],
    ["personalInfomationMiddleName", "Middle Name"],
    ["personalInfomationLastName", "Last Name"],
    ["PersonalAddress_address_line1", "Address Line 1"],
    ["PersonalAddress_city", "City"],
    ["PersonalAddress_state", "State / Territory"],
    ["PersonalAddress_postalCode", "Zip Code"],
    ["PersonalAddress_county", "County"],
  ]);
  const filledQuestions = new Set<string>();

  const dispatchInput = (field: HTMLInputElement, value: string) => {
    const previousValue = field.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    const tracker = (field as HTMLInputElement & { _valueTracker?: { setValue: (next: string) => void } })._valueTracker;
    tracker?.setValue(previousValue);
    try {
      field.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        composed: true,
        data: value,
        inputType: "insertText",
      }));
    } catch {
      field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    }
    field.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  };

  const fillControlledInput = async (field: HTMLInputElement, value: string, shouldBlur = true) => {
    const desiredValue = text(value);
    if (!desiredValue) return false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      field.focus();
      field.select();
      let inserted = false;
      try {
        inserted = typeof document.execCommand === "function"
          && document.execCommand("insertText", false, desiredValue);
      } catch {
        inserted = false;
      }
      if (!inserted || normalized(field.value) !== normalized(desiredValue)) {
        dispatchInput(field, desiredValue);
      } else {
        field.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      }
      await wait(160);
      if (normalized(field.value) === normalized(desiredValue)) {
        if (shouldBlur) field.blur();
        await wait(160);
        if (normalized(field.value) === normalized(desiredValue)) return true;
      }
    }
    if (shouldBlur) field.blur();
    return normalized(field.value) === normalized(desiredValue);
  };

  const roots = () => {
    const found: Array<Document | ShadowRoot> = [document];
    for (let index = 0; index < found.length; index += 1) {
      for (const element of found[index].querySelectorAll("*")) {
        if (element.shadowRoot && !found.includes(element.shadowRoot)) found.push(element.shadowRoot);
      }
    }
    return found;
  };
  const queryAll = (selector: string) => roots().flatMap((root) => Array.from(root.querySelectorAll(selector)));
  const visible = (element: Element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0"
      && element.getClientRects().length > 0;
  };

  const nameValues: Array<[string, string]> = [
    ["personalInfomationFirstName", text(profile.firstName) || fallbackNames.firstName],
    ["personalInfomationMiddleName", text(profile.middleName) || fallbackNames.middleName],
    ["personalInfomationLastName", text(profile.lastName) || fallbackNames.lastName],
  ];
  for (const [id, value] of nameValues) {
    const field = document.getElementById(id);
    if (field instanceof HTMLInputElement && value && await fillControlledInput(field, value)) {
      filledQuestions.add(fieldNames.get(id) ?? id);
    }
  }

  const addressField = document.getElementById("PersonalAddress_address_line1");
  const address1 = text(profile.address1);
  const addressParts = [address1];
  const addressNormalized = normalized(address1);
  for (const value of [profile.city, profile.state, profile.zip]) {
    const part = text(value);
    if (part && !addressNormalized.includes(normalized(part))) addressParts.push(part);
  }
  const fullAddress = addressParts.filter(Boolean).join(", ");
  const populatedAddress = () => {
    const city = text((document.getElementById("PersonalAddress_city") as HTMLInputElement | null)?.value);
    const zip = text((document.getElementById("PersonalAddress_postalCode") as HTMLInputElement | null)?.value);
    const state = text(document.getElementById("PersonalAddress_state")?.textContent);
    return Boolean(city && zip && state);
  };
  const waitForAddress = async (attempts = 30) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (populatedAddress()) return true;
      await wait(100);
    }
    return populatedAddress();
  };

  let selectedAddress = false;
  if (addressField instanceof HTMLInputElement && fullAddress) {
    await fillControlledInput(addressField, fullAddress, false);
    const words = normalized(fullAddress).split(" ").filter((word) => word.length > 2 || /^\d+$/.test(word));
    const streetNumber = words.find((word) => /^\d+$/.test(word));
    const suggestionSelector = [
      ".pac-container .pac-item",
      ".pac-item",
      "[role='listbox'] [role='option']",
      "[class*='autocomplete'] [role='option']",
      "[class*='suggest'] [role='option']",
      "li[class*='suggest']",
      "[data-testid*='suggest']",
    ].join(",");
    for (let attempt = 0; attempt < 40 && !selectedAddress; attempt += 1) {
      const candidates = queryAll(suggestionSelector).filter(visible).map((element, index) => {
        const candidateText = normalized(element.textContent);
        const matches = words.filter((word) => candidateText.includes(word)).length;
        const numberMatches = !streetNumber || candidateText.includes(streetNumber);
        return { element, index, score: matches + (numberMatches ? 6 : 0) };
      }).filter(({ score }) => score > 3).sort((left, right) => right.score - left.score || left.index - right.index);
      const suggestion = candidates[0]?.element;
      if (suggestion instanceof HTMLElement) {
        suggestion.scrollIntoView({ block: "nearest" });
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          suggestion.dispatchEvent(new MouseEvent(type, { bubbles: true, composed: true, view: window }));
        }
        selectedAddress = await waitForAddress();
        break;
      }
      await wait(100);
    }

    if (!selectedAddress) {
      addressField.focus();
      for (const [key, code, keyCode] of [["ArrowDown", "ArrowDown", 40], ["Enter", "Enter", 13]] as const) {
        for (const type of ["keydown", "keyup"]) {
          addressField.dispatchEvent(new KeyboardEvent(type, {
            key,
            code,
            keyCode,
            which: keyCode,
            bubbles: true,
            composed: true,
          }));
        }
        await wait(180);
      }
      selectedAddress = await waitForAddress(20);
    }
  }

  if (selectedAddress || populatedAddress()) {
    const selectedValues: Array<[string, string]> = [
      ["PersonalAddress_address_line1", address1],
      ["PersonalAddress_city", text(profile.city)],
      ["PersonalAddress_postalCode", text(profile.zip)],
      ["PersonalAddress_county", text(profile.county)],
    ];
    for (const [id, fallbackValue] of selectedValues) {
      const field = document.getElementById(id);
      if (!(field instanceof HTMLInputElement)) continue;
      // Google may not provide county for every address. Fill only data that
      // ADP left blank so the validated values remain authoritative.
      if (!text(field.value) && fallbackValue) await fillControlledInput(field, fallbackValue);
      if (text(field.value)) filledQuestions.add(fieldNames.get(id) ?? id);
    }
    if (text(document.getElementById("PersonalAddress_state")?.textContent)) {
      filledQuestions.add(fieldNames.get("PersonalAddress_state") ?? "State / Territory");
    }
  } else {
    // If Google/ADP does not return a suggestion, preserve a usable form by
    // filling each text field and selecting the state from ADP's list.
    const fallbackValues: Array<[string, string]> = [
      ["PersonalAddress_address_line1", address1],
      ["PersonalAddress_city", text(profile.city)],
      ["PersonalAddress_postalCode", text(profile.zip)],
      ["PersonalAddress_county", text(profile.county)],
    ];
    for (const [id, value] of fallbackValues) {
      const field = document.getElementById(id);
      if (field instanceof HTMLInputElement && value && await fillControlledInput(field, value)) {
        filledQuestions.add(fieldNames.get(id) ?? id);
      }
    }

    const stateControl = document.getElementById("PersonalAddress_state");
    const desiredState = normalized(profile.state);
    if (stateControl instanceof HTMLElement && desiredState) {
      if (!normalized(stateControl.textContent).includes(desiredState)) {
        stateControl.focus();
        stateControl.click();
        await wait(200);
        const options = queryAll("[role='option'], li.vdl-dropdown-list__option").filter(visible);
        const stateOption = options.find((option) => normalized(option.textContent).includes(desiredState));
        if (stateOption instanceof HTMLElement) stateOption.click();
      }
      await wait(120);
      if (normalized(stateControl.textContent).includes(desiredState)) {
        filledQuestions.add(fieldNames.get("PersonalAddress_state") ?? "State / Territory");
      }
    }
  }

  const expectedFields = [
    ["personalInfomationFirstName", text(profile.firstName) || fallbackNames.firstName],
    ["personalInfomationMiddleName", text(profile.middleName) || fallbackNames.middleName],
    ["personalInfomationLastName", text(profile.lastName) || fallbackNames.lastName],
    ["PersonalAddress_address_line1", address1],
    ["PersonalAddress_city", text(profile.city)],
    ["PersonalAddress_state", text(profile.state)],
    ["PersonalAddress_postalCode", text(profile.zip)],
    ["PersonalAddress_county", text(profile.county)],
  ] as const;
  const skippedQuestions = expectedFields.filter(([id, expected]) => {
    if (!expected || filledQuestions.has(fieldNames.get(id) ?? id)) return false;
    return Boolean(document.getElementById(id));
  }).map(([id]) => fieldNames.get(id) ?? id);

  return {
    filled: filledQuestions.size,
    skipped: skippedQuestions.length,
    skippedQuestions,
    filledQuestions: [...filledQuestions],
  };
}

async function fillAdpPageWorld(profile: PageAutofillProfile) {
  const tabsApi = extensionTabs();
  const scriptingApi = extensionScripting();
  if (!tabsApi || !scriptingApi?.executeScript) return [];
  const [tab] = await tabsApi.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !/\.adp\.com\//i.test(tab.url ?? "")) return [];
  try {
    const executions = await scriptingApi.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      func: autofillAdpInPageWorld as (...args: never[]) => unknown,
      args: [profile],
    });
    return executions.map(({ result }) => result).filter((result): result is NonNullable<Awaited<ReturnType<typeof autofillAdpInPageWorld>>> => Boolean(result));
  } catch {
    // Keep the generic content-script result when Chrome cannot enter a frame.
    return [];
  }
}

export async function getCurrentPageContext({ includeQuestions = true }: { includeQuestions?: boolean } = {}): Promise<CurrentPageContext> {
  const { tabUrl, responses } = await sendToCurrentPageFrames<CurrentPageContext>({
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
  // Run ADP last so its page-owned React state cannot restore the account's
  // stale name/address values after the generic isolated-world autofill.
  const adpResults = await fillAdpPageWorld(profile);
  const results = [...responses.map(({ value }) => value).filter(Boolean), ...adpResults];
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
