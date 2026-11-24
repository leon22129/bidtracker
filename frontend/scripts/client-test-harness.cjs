const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadClient(relativePath, imports = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../src', relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, Headers, Response, FormData, Blob, Error,
    process: { env: {} }, require: (name) => {
      if (Object.hasOwn(imports, name)) return imports[name];
      throw Error(`Unexpected client import: ${name}`);
    }, ...globals,
  }, { filename });
  return exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Deterministic hook scheduling lets tests complete network requests in any order.
function hookHarness() {
  const slots = [];
  let cursor = 0, dirty = false, pendingEffects = [], render, output;
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, (update) => {
        const next = typeof update === 'function' ? update(slots[i].value) : update;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(factory, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: factory() };
      return slots[i].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) {
        const cleanup = slots[i]?.cleanup;
        slots[i] = { deps };
        pendingEffects.push(() => { cleanup?.(); slots[i].cleanup = effect(); });
      }
    },
    createContext() { return { Provider: 'test-provider' }; },
  };
  function flush() {
    let passes = 0;
    do {
      if (++passes > 30) throw Error('Hook render loop did not settle');
      dirty = false; cursor = 0; pendingEffects = [];
      output = render();
      for (const effect of pendingEffects) effect();
    } while (dirty);
    return output;
  }
  return {
    react,
    mount(fn) { render = fn; return flush(); },
    render: flush,
    async settle() { await new Promise(setImmediate); return flush(); },
    get value() { return output; },
  };
}

module.exports = { loadClient, deferred, hookHarness };
