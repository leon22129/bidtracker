const PENDING_KEY = "resume_ai_pending_screenshots";
const TOKEN_KEY = "resume_ai_access_token";
const API_URL_KEY = "resume_ai_api_url";
const DEFAULT_API_URL = "http://api.yourdomain.com/api";
const MAX_PENDING_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const BROWSER_SESSION_KEY = "resume_ai_screenshot_browser_session";

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
  // Older versions keyed records by tab ID. Keep them when upgrading, but retain each application
  // independently so generating a second resume in the same tab does not replace the first button.
  return Object.fromEntries(Object.entries(entries)
    .filter(([, value]) => (value.capturedAt || value.createdAt) > cutoff)
    .map(([key, value]) => [value.applicationId, {
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
        entries[message.applicationId] = {
          ...entries[message.applicationId],
          applicationId: message.applicationId,
          tabId: Number(message.tabId),
          sessionId,
          companyName: message.companyName,
          jobTitle: message.jobTitle,
          createdAt: entries[message.applicationId]?.createdAt || Date.now(),
          submitted: entries[message.applicationId]?.submitted || false,
        };
      });
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
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
    captureAndUpload(Number(message.tabId), message.applicationId)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "APPLICATION_FORM_SUBMITTED" && sender.tab?.id !== undefined) {
    (async () => {
      let updated = false;
      await updatePending((entries) => {
        const pending = Object.values(entries)
          .filter((entry) => entry.tabId === sender.tab.id && !entry.capturedAt)
          .sort((left, right) => right.createdAt - left.createdAt)[0];
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

async function captureAndUpload(tabId, applicationId) {
  const entries = await pendingEntries();
  const pending = entries[applicationId];
  if (!pending || pending.tabId !== tabId) throw new Error("This application is no longer available for capture.");
  if (pending.sessionId !== await currentBrowserSession()) {
    throw new Error('Reopen the confirmation page and use Load Last Application to select it again after restarting or reloading the extension.');
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error("The original application tab is closed. Reopen the confirmation page and load the application again.");
  if (tab.windowId === undefined) throw new Error("The application tab is no longer available.");
  await chrome.tabs.update(tabId, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 200));
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const image = await fetch(dataUrl).then((response) => response.blob());
  const settings = await chrome.storage.local.get([TOKEN_KEY, API_URL_KEY]);
  const token = settings[TOKEN_KEY];
  if (!token) throw new Error("Sign in to Resume Builder and try again.");
  const apiUrl = String(settings[API_URL_KEY] || DEFAULT_API_URL).replace(/\/+$/, "");
  const body = new FormData();
  body.append("screenshot", image, "application-submitted.png");
  const response = await fetch(`${apiUrl}/applications/${encodeURIComponent(applicationId)}/screenshot`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || `Upload failed (${response.status}).`);
  }
  await updatePending((current) => {
    if (current[applicationId]) current[applicationId].capturedAt = Date.now();
  });
}
