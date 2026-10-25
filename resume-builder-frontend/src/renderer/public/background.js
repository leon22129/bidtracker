const PENDING_KEY = "resume_ai_pending_screenshots";
const TOKEN_KEY = "resume_ai_access_token";
const API_URL_KEY = "resume_ai_api_url";
const DEFAULT_API_URL = "http://api.yourdomain.com/api";
const MAX_PENDING_AGE_MS = 24 * 60 * 60 * 1000;

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
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value.createdAt > cutoff));
}

async function savePending(entries) {
  await chrome.storage.local.set({ [PENDING_KEY]: entries });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARM_APPLICATION_SCREENSHOT") {
    (async () => {
      const entries = await pendingEntries();
      entries[String(message.tabId)] = {
        applicationId: message.applicationId,
        createdAt: Date.now(),
        submitted: false,
      };
      await savePending(entries);
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_PENDING_SCREENSHOTS") {
    (async () => {
      const entries = await pendingEntries();
      sendResponse({
        ok: true,
        items: Object.entries(entries)
          .filter(([, value]) => value.submitted)
          .map(([tabId, value]) => ({ tabId: Number(tabId), applicationId: value.applicationId })),
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
      const entries = await pendingEntries();
      const key = String(sender.tab.id);
      const pending = entries[key];
      if (!pending || pending.submitted) return sendResponse({ ok: false });
      pending.submitted = true;
      await savePending(entries);
      await chrome.runtime.sendMessage({
        type: "APPLICATION_SCREENSHOT_READY",
        tabId: sender.tab.id,
        applicationId: pending.applicationId,
      }).catch(() => undefined);
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function captureAndUpload(tabId, applicationId) {
  const tab = await chrome.tabs.get(tabId);
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
  const entries = await pendingEntries();
  delete entries[String(tabId)];
  await savePending(entries);
}
