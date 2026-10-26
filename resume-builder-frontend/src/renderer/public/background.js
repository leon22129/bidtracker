const PENDING_KEY = "resume_ai_pending_screenshots";
const TOKEN_KEY = "resume_ai_access_token";
const API_URL_KEY = "resume_ai_api_url";
const DEFAULT_API_URL = "http://api.yourdomain.com/api";
const MAX_PENDING_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const BROWSER_SESSION_KEY = "resume_ai_screenshot_browser_session";

const pendingKey = (applicationId, profileTabId) => profileTabId ? `${profileTabId}:${applicationId}` : applicationId;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id !== undefined) chrome.sidePanel.open({ tabId: tab.id });
});

async function pendingEntries() {
  const stored = await chrome.storage.local.get(PENDING_KEY);
  const entries = stored[PENDING_KEY] || {};
  const cutoff = Date.now() - MAX_PENDING_AGE_MS;
  // Legacy entries remain readable; new entries belong to a specific profile tab and draft.
  return Object.fromEntries(Object.entries(entries)
    // Drop completed entries left by older versions as well as expired pending jobs.
    .filter(([, value]) => !value.capturedAt && value.createdAt > cutoff)
    .map(([key, value]) => [pendingKey(value.applicationId, value.profileTabId), {
      ...value,
      tabId: Number(value.tabId ?? key),
    }]));
}

let storageChanges = Promise.resolve();
function updatePending(update) {
  const result = storageChanges.then(async () => {
    const entries = await pendingEntries();
    await update(entries);
    await savePending(entries);
  });
  storageChanges = result.catch(() => undefined);
  return result;
}

async function savePending(entries) {
  await chrome.storage.local.set({ [PENDING_KEY]: entries });
}

let browserSession;
function currentBrowserSession() {
  browserSession ??= (async () => {
    const stored = await chrome.storage.session.get(BROWSER_SESSION_KEY);
    if (stored[BROWSER_SESSION_KEY]) return stored[BROWSER_SESSION_KEY];
    const id = crypto.randomUUID();
    await chrome.storage.session.set({ [BROWSER_SESSION_KEY]: id });
    return id;
  })();
  return browserSession;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARM_APPLICATION_SCREENSHOT") {
    (async () => {
      const sessionId = await currentBrowserSession();
      await updatePending((entries) => {
        const key = pendingKey(message.applicationId, message.profileTabId);
        const previous = entries[key];
        // A new job replaces only this profile tab's capture context.
        for (const [entryKey, entry] of Object.entries(entries)) {
          if (message.profileTabId && entry.profileTabId === message.profileTabId) delete entries[entryKey];
        }
        entries[key] = {
          ...previous,
          applicationId: message.applicationId,
          profileTabId: message.profileTabId,
          draftId: message.draftId,
          tabId: Number(message.tabId),
          sessionId,
          companyName: message.companyName,
          jobTitle: message.jobTitle,
          url: message.url,
          createdAt: previous?.createdAt || Date.now(),
          submitted: previous?.tabId === Number(message.tabId) && previous?.sessionId === sessionId ? previous.submitted : false,
        };
      });
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_TAB_SCREENSHOT_APPLICATION") {
    (async () => {
      const entries = await pendingEntries();
      const item = message.profileTabId && message.applicationId
        ? entries[pendingKey(message.applicationId, message.profileTabId)] : null;
      sendResponse({ ok: true, item: item || null });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CLEAR_PROFILE_TAB_SCREENSHOT") {
    updatePending((entries) => {
      for (const [key, entry] of Object.entries(entries)) {
        if (entry.profileTabId === message.profileTabId) delete entries[key];
      }
    }).then(() => sendResponse({ ok: true })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SCREENSHOT_APPLICATIONS" || message?.type === "GET_PENDING_SCREENSHOTS") {
    (async () => {
      const entries = await pendingEntries();
      sendResponse({
        ok: true,
        items: Object.entries(entries)
          .filter(([, value]) => message.type === "GET_SCREENSHOT_APPLICATIONS" || (value.submitted && !value.capturedAt))
          .map(([, value]) => value)
          .sort((left, right) => right.createdAt - left.createdAt),
      });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "CAPTURE_APPLICATION_SCREENSHOT") {
    captureAndUpload(Number(message.tabId), message.applicationId, message.confirmed === true, message.profileTabId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "APPLICATION_FORM_SUBMITTED" && sender.tab?.id !== undefined) {
    (async () => {
      let updated = false;
      await updatePending((entries) => {
        const matches = Object.values(entries).filter((entry) => entry.tabId === sender.tab.id && !entry.capturedAt);
        // A browser event cannot identify the profile tab when several jobs share the same page.
        const pending = matches.length === 1 ? matches[0] : null;
        if (pending && !pending.submitted) {
          pending.submitted = true;
          updated = true;
        }
      });
      sendResponse({ ok: updated });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function captureAndUpload(tabId, applicationId, confirmed, profileTabId) {
  const entries = await pendingEntries();
  const pending = entries[pendingKey(applicationId, profileTabId)];
  if (!pending || pending.tabId !== tabId) throw new Error("This application is no longer available for capture.");
  if (!pending.submitted && !confirmed) throw new Error("Confirm that the application was submitted successfully first.");
  if (pending.sessionId !== await currentBrowserSession()) {
    throw new Error('Reopen the confirmation page and use Load Last Job to select it again after restarting or reloading the extension.');
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error("The original application tab is closed. Reopen the confirmation page and load the application again.");
  if (tab.windowId === undefined) throw new Error("The application tab is no longer available.");
  await chrome.tabs.update(tabId, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const [activeTab] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (activeTab?.id !== tabId) throw new Error("The active tab changed during capture. Return to the confirmation page and try again.");
  const image = await fetch(dataUrl).then((response) => response.blob());
  const settings = await chrome.storage.local.get([TOKEN_KEY, API_URL_KEY]);
  const token = settings[TOKEN_KEY];
  if (!token) throw new Error("Sign in to Resume Builder and try again.");
  const apiUrl = String(settings[API_URL_KEY] || DEFAULT_API_URL).replace(/\/+$/, "");
  const body = new FormData();
  body.append("screenshot", image, "application-submitted.png");
  body.append("submitted", "true");
  const endpoint = pending.draftId
    ? `/applications/drafts/${encodeURIComponent(pending.draftId)}/submit`
    : `/applications/${encodeURIComponent(applicationId)}/screenshot`;
  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || `Upload failed (${response.status}).`);
  }
  await updatePending((current) => {
    // Only remove the pending job after the backend has saved the application and screenshot.
    for (const [key, entry] of Object.entries(current)) {
      if (entry.applicationId === applicationId) delete current[key];
    }
  });
}
