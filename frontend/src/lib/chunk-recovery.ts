// This must run before hydration: a failed root chunk can prevent every React
// component, including an error boundary, from mounting.
export const CHUNK_RECOVERY_SCRIPT = String.raw`(() => {
  const key = 'bidtracker_asset_reload';
  const retryParam = '_bt_reload';
  let recovering = false;
  let edited = false;
  let timer;
  document.addEventListener('input', () => { edited = true; }, true);
  document.addEventListener('change', () => { edited = true; }, true);

  function freshUrl() {
    const url = new URL(location.href);
    url.searchParams.set(retryParam, String(Date.now()));
    return url;
  }

  function reload() {
    try { sessionStorage.setItem(key, String(Date.now())); } catch {}
    location.replace(freshUrl().href);
  }

  function notice(message) {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => notice(message), { once: true });
      return;
    }
    let panel = document.getElementById('bidtracker-load-recovery');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'bidtracker-load-recovery';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;z-index:2147483647;inset:auto 16px 16px;max-width:560px;margin:auto;padding:20px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;box-shadow:0 8px 30px #0003;font:14px/1.5 system-ui';
      const text = document.createElement('p');
      text.style.margin = '0 0 12px';
      panel.appendChild(text);
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Reload page';
      button.style.cssText = 'padding:8px 14px;border:0;border-radius:6px;background:#0f172a;color:#fff;cursor:pointer;font:inherit';
      button.onclick = reload;
      panel.appendChild(button);
      document.body.appendChild(panel);
    }
    panel.firstChild.textContent = message;
  }

  function isAppScript(value) {
    try {
      const url = new URL(value, location.href);
      return url.origin === location.origin && url.pathname.startsWith('/_next/static/') && url.pathname.endsWith('.js');
    } catch { return false; }
  }

  function recover() {
    if (recovering) return;
    recovering = true;
    const fromUrl = Number(new URL(location.href).searchParams.get(retryParam)) || 0;
    let lastReload = fromUrl;
    try { lastReload = Math.max(lastReload, Number(sessionStorage.getItem(key)) || 0); } catch {}
    const alreadyRetried = Date.now() - lastReload < 300000;
    if (edited || alreadyRetried) {
      // Wait until React has handled its error before displaying the fallback.
      setTimeout(() => notice(edited
        ? 'This page could not finish loading. Copy any unsaved text before reloading.'
        : 'This page could not finish loading. Please reload to try again.'), 0);
      return;
    }

    notice('This page could not finish loading. Reconnecting…');
    let attempt = 0;
    async function retry() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        // Probe fresh HTML, not the failed chunk: a new build may have removed
        // that chunk. Do not navigate into a Cloudflare/network error document.
        const response = await fetch(freshUrl().href, {
          cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
          headers: { Accept: 'text/html' },
        });
        if (!response.ok || !/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error('Unavailable');
        if (!(await response.text()).includes('id="bidtracker-asset-recovery"')) throw new Error('Unavailable');
        if (!edited) { reload(); return; }
      } catch {} finally { clearTimeout(timeout); }
      if (!edited && ++attempt < 3) {
        timer = setTimeout(retry, attempt * 1500);
      } else {
        notice(edited
          ? 'Copy any unsaved text before reloading this page.'
          : 'The page is temporarily unavailable. Please try reloading in a moment.');
      }
    }
    timer = setTimeout(retry, 500);
  }

  window.addEventListener('error', (event) => {
    const target = event.target;
    if ((target && target.tagName === 'SCRIPT' && isAppScript(target.src)) || event.error?.name === 'ChunkLoadError') recover();
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason?.name === 'ChunkLoadError') recover();
  });
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('load', () => {
    if (!recovering && new URL(location.href).searchParams.has(retryParam)) {
      const url = new URL(location.href);
      url.searchParams.delete(retryParam);
      history.replaceState(history.state, '', url.href);
    }
  });
})();`;
