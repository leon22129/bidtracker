const PENDING_KEY = "resume_ai_pending_screenshots";
const TOKEN_KEY = "resume_ai_access_token";
const API_URL_KEY = "resume_ai_api_url";
const DEFAULT_API_URL = "http://api.yourdomain.com/api";
const MAX_PENDING_AGE_MS = 8 * 24 * 60 * 60 * 1000;
const BROWSER_SESSION_KEY = "resume_ai_screenshot_browser_session";
const CAPTURE_WARNING = 'Some form answers could not be recorded. The screenshot and any saved answers can still be added.';
const isObservationError = (error) => ['This form step could not be captured.', 'Application form capture is too large to save.'].includes(error);

const pendingKey = (applicationId, profileTabId) => profileTabId ? `${profileTabId}:${applicationId}` : applicationId;
const hasUnsavedSteps = (entry) => (entry.captureSteps || []).some((step) => step.captured_at > (entry.syncedSteps?.[step.key] || 0));

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
      // Older recorders saved rejected observations as blocking sync errors,
      // even though there is no rejected step in storage that can be retried.
      captureError: isObservationError(value.captureError) ? null : value.captureError,
      captureWarning: isObservationError(value.captureError) ? CAPTURE_WARNING : value.captureWarning,
      captureWarningKeys: isObservationError(value.captureError) ? [null] : value.captureWarningKeys,
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

const captureStarts = new Map();
async function startFormCapture(tabId) {
  if (captureStarts.has(tabId)) return captureStarts.get(tabId);
  const task = (async () => {
    const frames = await chrome.webNavigation?.getAllFrames({ tabId }).catch(() => []) || [];
    const frameIds = [...new Set(frames.length ? frames.map(({ frameId }) => frameId) : [0])];
    const results = await Promise.allSettled(frameIds.map(async (frameId) => {
      const start = () => chrome.tabs.sendMessage(tabId, { type: 'APPLICATION_CAPTURE_START' }, { frameId });
      if ((await start().catch(() => null))?.captureReady) return;
      // Open tabs may have only the scanner (or no scripts after installation).
      // Probe the helpers without scanning or changing any application fields.
      const target = { tabId, frameIds: [frameId] };
      const [probe] = await chrome.scripting.executeScript({ target, func: () =>
        typeof cleanLabel === 'function' && typeof fieldLabel === 'function' && typeof isVisible === 'function' });
      await chrome.scripting.executeScript({ target,
        files: probe?.result ? ['application-capture.js'] : ['content-script.js', 'application-capture.js'] });
      if (!(await start())?.captureReady) throw new Error('Recorder did not respond');
    }));
    // Restricted advertising/authentication frames must not prevent a readable
    // application frame from starting. Report failure if none can be reached.
    if (!results.some((result) => result.status === 'fulfilled')) {
      throw new Error('Unable to start answer capture on the linked job page. Refresh the page and load the job again.');
    }
  })();
  captureStarts.set(tabId, task);
  try { await task; } finally { captureStarts.delete(tabId); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "ARM_APPLICATION_SCREENSHOT") {
    (async () => {
      const sessionId = await currentBrowserSession();
      await updatePending((entries) => {
        const key = pendingKey(message.applicationId, message.profileTabId);
        const previous = entries[key];
        for (const entry of Object.values(entries)) {
          if (entry.tabId === Number(message.tabId)) entry.captureActive = false;
        }
        // A new job replaces only this profile tab's capture context.
        for (const [entryKey, entry] of Object.entries(entries)) {
          if (message.profileTabId && entry.profileTabId === message.profileTabId) {
            entry.captureActive = false;
            // A new job must not discard observations waiting for a network retry.
            if (!hasUnsavedSteps(entry)) delete entries[entryKey];
          }
        }
        entries[key] = {
          ...previous,
          applicationId: message.applicationId,
          profileTabId: message.profileTabId,
          draftId: message.draftId,
          tabId: Number(message.tabId),
          sessionId,
          captureActive: Boolean(message.draftId),
          captureToken: previous?.tabId === Number(message.tabId) && previous?.sessionId === sessionId
            ? previous.captureToken || crypto.randomUUID() : crypto.randomUUID(),
          companyName: message.companyName,
          jobTitle: message.jobTitle,
          url: message.url,
          createdAt: previous?.createdAt || Date.now(),
          submitted: previous?.tabId === Number(message.tabId) && previous?.sessionId === sessionId ? previous.submitted : false,
        };
      });
      let captureWarning;
      if (message.draftId) {
        try { await startFormCapture(Number(message.tabId)); } catch {
          captureWarning = CAPTURE_WARNING;
          await updatePending((entries) => {
            const entry = entries[pendingKey(message.applicationId, message.profileTabId)];
            if (entry) entry.captureWarning = captureWarning;
          });
        }
      }
      sendResponse({ ok: true, ...(captureWarning ? { captureWarning } : {}) });
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
        if (entry.profileTabId === message.profileTabId) {
          entry.captureActive = false;
          if (!hasUnsavedSteps(entry)) delete entries[key];
        }
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
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "APPLICATION_FORM_SUBMITTED" && sender.tab?.id !== undefined) {
    (async () => {
      let updated = false;
      await updatePending((entries) => {
        const matches = Object.values(entries).filter((entry) => entry.tabId === sender.tab.id && !entry.capturedAt
          && (entry.captureActive || !entry.draftId));
        // A browser event cannot identify the profile tab when several jobs share the same page.
        const pending = matches.length === 1 ? matches[0] : null;
        if (pending && !pending.submitted) {
          pending.submitted = true;
          pending.submittedAt = Date.now();
          updated = true;
        }
      });
      sendResponse({ ok: updated });
    })().catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

// Every observation is written locally before a network request. The database receives
// one complete step at a time, so revisiting a step also removes deleted repeat rows.
const captureSyncs = new Map();
async function syncCapturedSteps(key) {
  if (captureSyncs.has(key)) return captureSyncs.get(key);
  const task = (async () => {
    const failedSteps = new Map();
    let syncError;
    try {
      while (true) {
        const pending = (await pendingEntries())[key];
        if (!pending?.draftId) return;
        const step = (pending.captureSteps || []).find((item) => item.captured_at > (pending.syncedSteps?.[item.key] || 0)
          && failedSteps.get(item.key) !== item.captured_at);
        if (!step) {
          if (syncError && hasUnsavedSteps(pending)) throw syncError;
          return;
        }
        const settings = await chrome.storage.local.get([TOKEN_KEY, API_URL_KEY]);
        if (!settings[TOKEN_KEY]) throw new Error('Sign in to save captured form answers.');
        try {
          const response = await fetch(`${String(settings[API_URL_KEY] || DEFAULT_API_URL).replace(/\/+$/, '')}/applications/drafts/${encodeURIComponent(pending.draftId)}/form-capture`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${settings[TOKEN_KEY]}`, 'Content-Type': 'application/json',
              'X-Resume-Builder-Version': chrome.runtime.getManifest().version },
            body: JSON.stringify(step),
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.message || `Unable to save form answers (${response.status}).`);
          }
        } catch (error) {
          // A rejected step must not prevent other answers from being saved.
          // Keep it locally for background retries until the application is added.
          failedSteps.set(step.key, step.captured_at);
          syncError = error;
          continue;
        }
        await updatePending((entries) => {
          const entry = entries[key];
          if (!entry) return;
          entry.syncedSteps = { ...entry.syncedSteps, [step.key]: step.captured_at };
          if (!hasUnsavedSteps(entry)) entry.captureError = null;
        });
      }
    } catch (error) {
      await updatePending((entries) => {
        if (entries[key]) entries[key].captureError = error.message;
      });
      throw error;
    }
  })();
  captureSyncs.set(key, task);
  try { return await task; } finally { captureSyncs.delete(key); }
}

async function captureContext(sender, includeSubmitted = false) {
  if (sender.tab?.id === undefined) return null;
  const sessionId = await currentBrowserSession();
  const entries = await pendingEntries();
  return Object.entries(entries).find(([, entry]) => entry.tabId === sender.tab.id
    && entry.sessionId === sessionId && entry.captureActive && entry.draftId
    && (includeSubmitted || !entry.submitted)) || null;
}

function isCaptureUrl(url, senderUrl) {
  try {
    const source = new URL(senderUrl);
    const observed = new URL(url);
    // Chrome can retain the document's original sender URL after pushState or
    // replaceState. A queued observation can also precede the current route.
    // Bind captures to the sending frame's origin, retaining the observed path
    // and the existing tab/session/token checks. Queries and fragments are never saved.
    return ['http:', 'https:'].includes(source.protocol) && observed.origin === source.origin
      && url === observed.origin + observed.pathname;
  } catch { return false; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_FORM_CAPTURE_CONTEXT') {
    captureContext(sender).then((match) => sendResponse({ ok: true, token: match?.[1].captureToken || null }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type !== 'APPLICATION_FORM_CAPTURE' || sender.tab?.id === undefined) return;
  (async () => {
    const match = await captureContext(sender, true);
    if (!match || message.token !== match[1].captureToken) return sendResponse({ ok: false });
    const [key] = match;
    const step = message.step;
    // An observation made before confirmation may still be queued in its frame.
    if (match[1].submitted && !(step?.captured_at <= match[1].submittedAt)) return sendResponse({ ok: false });
    if (!step || !isCaptureUrl(step.url, sender.url)
      || typeof step.key !== 'string' || step.key.length > 2000 || typeof step.step !== 'string'
      || !Array.isArray(step.fields) || step.fields.length > 500
      || !Number.isSafeInteger(step.captured_at) || step.captured_at > Date.now() + 300000
      || JSON.stringify(step).length > 90000) throw new Error('This form step could not be captured.');
    await updatePending((entries) => {
      const entry = entries[key];
      if (!entry || entry.captureToken !== message.token || !entry.captureActive
        || (entry.submitted && !(step.captured_at <= entry.submittedAt))) return;
      entry.captureSteps ||= [];
      const index = entry.captureSteps.findIndex((item) => item.key === step.key);
      if (index < 0) entry.captureSteps.push(step);
      else if (entry.captureSteps[index].captured_at < step.captured_at) entry.captureSteps[index] = step;
      if (entry.captureSteps.length > 100 || JSON.stringify(entry.captureSteps).length > 500000) {
        throw new Error('Application form capture is too large to save.');
      }
      entry.capturedAnswerCount = entry.captureSteps.reduce((count, item) => count + item.fields.length, 0);
      entry.captureError = null;
      if (entry.captureWarningKeys?.includes(step.key)) {
        entry.captureWarningKeys = entry.captureWarningKeys.filter((key) => key !== step.key);
        if (!entry.captureWarningKeys.length) entry.captureWarning = null;
      }
    });
    sendResponse({ ok: true });
    void syncCapturedSteps(key).catch(() => undefined);
  })().catch(async (error) => {
    const match = await captureContext(sender, true);
    if (match) await updatePending((entries) => {
      const entry = entries[match[0]];
      if (!entry || entry.captureToken !== message.token) return;
      if (isObservationError(error.message)) {
        entry.captureWarning = CAPTURE_WARNING;
        entry.captureWarningKeys = [...new Set([...(entry.captureWarningKeys || []), message.step?.key || null])];
      } else entry.captureError = error.message;
    });
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

chrome.alarms?.create('retry-application-form-capture', { periodInMinutes: 0.5 });
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === 'retry-application-form-capture') {
    pendingEntries().then((entries) => Promise.allSettled(Object.keys(entries).map(syncCapturedSteps)));
  }
});

async function flushFormCapture(tabId) {
  const frames = await chrome.webNavigation?.getAllFrames({ tabId }).catch(() => []) || [];
  await Promise.allSettled(frames.map(({ frameId }) => chrome.tabs.sendMessage(tabId,
    { type: 'APPLICATION_CAPTURE_FLUSH' }, { frameId })));
  await storageChanges;
}

async function captureAndUpload(tabId, applicationId, confirmed, profileTabId) {
  const entries = await pendingEntries();
  const pending = entries[pendingKey(applicationId, profileTabId)];
  if (!pending || pending.tabId !== tabId) throw new Error("This application is no longer available for capture.");
  if (!pending.submitted && !confirmed) throw new Error("Confirm that the application was submitted successfully first.");
  if (pending.sessionId !== await currentBrowserSession()) {
    throw new Error('Reopen the confirmation page and use Load Last Job to select it again after restarting or reloading the extension.');
  }
  let captureWarning = pending.captureWarning;
  if (pending.draftId) {
    try {
      await flushFormCapture(tabId);
      const key = pendingKey(applicationId, profileTabId);
      for (let attempt = 0; attempt < 5; attempt++) {
        await syncCapturedSteps(key);
        const latest = (await pendingEntries())[key];
        captureWarning = latest?.captureWarning || captureWarning;
        if (latest?.captureError) captureWarning = CAPTURE_WARNING;
        if (!latest || !hasUnsavedSteps(latest)) break;
        if (attempt === 4) captureWarning = CAPTURE_WARNING;
      }
    } catch {
      // Form answers are optional. The submit endpoint retains any steps that
      // reached the database and can also save an application without form data.
      captureWarning = CAPTURE_WARNING;
    }
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
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Resume-Builder-Version": chrome.runtime.getManifest().version,
    },
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
  return captureWarning ? { captureWarning } : {};
}
