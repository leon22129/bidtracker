// Observes only the application explicitly armed by the side panel. This script
// runs in each frame and never changes a form value or advances the application.
(() => {
  const selector = [
    'input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])',
    'textarea', 'select', '[role="combobox"]', '[role="radio"]', '[role="checkbox"]',
    '[role="switch"]', 'button[aria-haspopup="listbox"]', '[contenteditable="true"]',
  ].join(',');
  let token = null;
  let queued;
  let lastSignature = '';
  let lastTimestamp = 0;
  let pending = Promise.resolve();
  let checking = false;

  const labelText = (element) => cleanLabel(element?.innerText || element?.textContent || '');
  const visible = (element) => isVisible(element) && !element.closest('[hidden], [aria-hidden="true"], [inert]');
  const firstText = (selectors) => {
    for (const query of selectors) {
      const element = [...document.querySelectorAll(query)].find(visible);
      const text = labelText(element);
      if (text) return text.slice(0, 300);
    }
    return '';
  };

  function questionFor(field) {
    const dedicated = field.closest('.application-question')?.querySelector('.application-label');
    if (labelText(dedicated)) return labelText(dedicated);
    const label = field.labels?.[0] || field.closest('label');
    if (label) {
      const caption = label.cloneNode(true);
      caption.querySelectorAll('input, select, textarea, button, [role="combobox"], [role="listbox"], [role="option"]').forEach((child) => child.remove());
      if (labelText(caption)) return labelText(caption);
    }
    return fieldLabel(field);
  }

  function sectionFor(field) {
    const parts = [];
    for (let parent = field.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const caption = parent.querySelector(':scope > legend, :scope > h2, :scope > h3, :scope > h4, :scope > [role="heading"]');
      const text = labelText(caption);
      if (text && !parts.includes(text)) parts.unshift(text);
      if (parts.length === 3) break;
    }
    return parts.join(' / ').slice(0, 300);
  }

  function groupCaption(field, group) {
    const ids = group?.getAttribute('aria-labelledby');
    const caption = ids ? cleanLabel(textFromIds(ids)) : '';
    const legend = labelText(group?.querySelector(':scope > legend'));
    const automation = field.closest('[data-automation-id^="formField"]');
    const automationLabel = labelText(automation?.querySelector('[data-automation-id="formLabel"], label'));
    return caption || group?.getAttribute('aria-label') || legend || automationLabel || fieldLabel(field);
  }

  function readSnapshot() {
    // Login screens are not application steps, even when they share the same tab.
    if ([...document.querySelectorAll('input[type="password"]')].some(visible)) return null;
    const elements = [...document.querySelectorAll(selector)].filter((field) => (visible(field)
      || (field instanceof HTMLInputElement && ['radio', 'checkbox'].includes(field.type)
        && [...(field.labels || [])].some(visible)))
      && !field.closest('nav, header, footer, [role="search"], [role="listbox"]')
      && !/^(?:password|current-password|new-password|one-time-code|username)$/i.test(field.autocomplete || '')
      && !/\b(?:password|verification code|security code|one.time code|captcha)\b/i.test(fieldLabel(field)));
    const fields = [];
    const consumed = new Set();
    const occurrences = new Map();
    for (const field of elements) {
      if (consumed.has(field)) continue;
      // Custom widgets often wrap a native input; record the control once.
      if (!(field instanceof HTMLInputElement) && !(field instanceof HTMLSelectElement)
        && field.querySelector('input:not([type="hidden"]), select, textarea')) continue;
      const role = field.getAttribute('role');
      const type = role || (field instanceof HTMLInputElement ? field.type : field.tagName.toLowerCase());
      let question = questionFor(field);
      let answer = '';
      if (['radio', 'checkbox', 'switch'].includes(type)) {
        const group = field.closest('[role="radiogroup"], [role="group"], fieldset, [data-automation-id^="formField"]');
        const peers = elements.filter((other) => {
          if (other === field) return true;
          if ((other.getAttribute('role') || other.type) !== type) return false;
          if (field instanceof HTMLInputElement && field.name) {
            return other.name === field.name && other.form === field.form
              && other.closest('[role="radiogroup"], [role="group"], fieldset, [data-automation-id^="formField"]') === group;
          }
          return type === 'radio' && group && group.contains(other);
        });
        peers.forEach((peer) => consumed.add(peer));
        const checked = peers.filter((peer) => peer.checked || peer.getAttribute('aria-checked') === 'true');
        if (type === 'radio' || peers.length > 1) {
          question = groupCaption(field, group);
          answer = checked.map(optionLabel).join('\n');
        } else answer = checked.length ? 'Yes' : 'No';
      } else if (field instanceof HTMLSelectElement) {
        answer = [...field.selectedOptions].filter((option) => option.value !== '')
          .map((option) => option.textContent.trim()).join('\n');
      } else if (field instanceof HTMLInputElement && field.type === 'file') {
        answer = [...(field.files || [])].map((file) => file.name).join('\n');
      } else if ('value' in field && field.tagName !== 'BUTTON') {
        answer = String(field.value ?? '');
      } else {
        answer = field.getAttribute('aria-valuetext') || (field.innerText || field.textContent || '').trim();
        if (/^(select(?: one| an? (?:option|value))?|choose(?: one)?|please select)[.…]*$/i.test(answer)) answer = '';
      }
      question = cleanLabel(question);
      if (!question) continue;
      const section = sectionFor(field);
      // Occurrence keeps repeated employment/education fields distinct, including
      // sites that reuse names or generate new DOM ids on every visit.
      const identity = `${section}|${type}|${question}`;
      const occurrence = (occurrences.get(identity) || 0) + 1;
      occurrences.set(identity, occurrence);
      fields.push({ id: `${identity}|${occurrence}`.slice(0, 1000), question,
        answer, section, field_type: type });
    }
    if (!fields.length) return null;
    const step = firstText([
      '[aria-current="step"]', '[data-automation-id="progressBarActiveStep"]',
      '[data-automation-id="progressBar"] [aria-current="true"]',
      '[data-automation-id="pageHeader"]', 'main h2', '[role="main"] h2',
      'main h1', '[role="main"] h1', 'form h2', 'form h1', 'h1',
    ]) || fields[0].section || 'Application form';
    const url = location.origin + location.pathname;
    // Some portals keep the job title as the only heading throughout the wizard.
    // The first question distinguishes those pages without using their answers.
    return { key: `${url}|${step}|${fields[0].question}`.slice(0, 2000), step, url, fields };
  }

  function capture() {
    clearTimeout(queued);
    if (!token) return pending;
    const snapshot = readSnapshot();
    if (!snapshot) return pending;
    const signature = JSON.stringify(snapshot);
    if (signature === lastSignature) return pending;
    lastSignature = signature;
    const observedToken = token;
    lastTimestamp = Math.max(Date.now(), lastTimestamp + 1);
    const step = { ...snapshot, captured_at: lastTimestamp };
    pending = pending.catch(() => undefined).then(async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'APPLICATION_FORM_CAPTURE', token: observedToken, step });
        if (!response?.ok && lastSignature === signature) lastSignature = '';
      } catch { if (lastSignature === signature) lastSignature = ''; }
    });
    return pending;
  }

  const schedule = () => {
    clearTimeout(queued);
    if (token) queued = setTimeout(capture, 200);
  };
  async function refreshContext() {
    if (checking) return;
    checking = true;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_FORM_CAPTURE_CONTEXT' });
      const nextToken = response?.token || null;
      if (nextToken !== token) { token = nextToken; lastSignature = ''; }
      await capture();
    } catch { token = null; } finally { checking = false; }
  }

  document.addEventListener('input', schedule, true);
  document.addEventListener('change', () => { void capture(); }, true);
  document.addEventListener('focusout', () => { void capture(); }, true);
  // Capture the old DOM synchronously, before the site's handlers replace it.
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('button, [role="button"], input[type="submit"], a') : null;
    if (button) void capture();
    schedule();
  }, true);
  document.addEventListener('submit', () => { void capture(); }, true);
  document.addEventListener('keydown', (event) => { if (event.key === 'Enter') void capture(); }, true);
  window.addEventListener('pagehide', () => { void capture(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void capture(); });
  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true, childList: true, attributes: true,
    attributeFilter: ['aria-checked', 'aria-selected', 'aria-valuetext', 'value', 'hidden'],
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'APPLICATION_CAPTURE_START') {
      refreshContext().then(() => respond({ ok: true }));
      return true;
    }
    if (message?.type === 'APPLICATION_CAPTURE_FLUSH') {
      capture().then(() => respond({ ok: true }));
      return true;
    }
  });
  void refreshContext();
  // Also observes autofill/programmatic changes that do not dispatch input events.
  setInterval(refreshContext, 2000);
})();
