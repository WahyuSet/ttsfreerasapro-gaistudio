/**
 * Skrip injeksi untuk merekam aksi interaksi pengguna di dalam browser
 */
function getInjectedRecorderScript() {
  return `(() => {
  if (window.__AUSTUDIO_RECORDER_INITIALIZED__) return;
  window.__AUSTUDIO_RECORDER_INITIALIZED__ = true;

  let stepCounter = 0;
  let inputDebounceTimer = null;
  let lastInputElement = null;
  let scrollDebounceTimer = null;

  function getBestSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return 'body';
    const tag = element.tagName.toLowerCase();

    const buttonParent = element.closest('button, [role="button"], a');
    if (buttonParent) {
      const btnAria = buttonParent.getAttribute('aria-label');
      if (btnAria) return \`\${buttonParent.tagName.toLowerCase()}[aria-label="\${CSS.escape(btnAria)}"]\`;
      for (const attr of ['data-testid', 'data-test', 'data-qa']) {
        const val = buttonParent.getAttribute(attr);
        if (val) return \`[\${attr}="\${val}"]\`;
      }
      const btnText = (buttonParent.textContent || '').trim();
      if (btnText && btnText.length > 0 && btnText.length < 35 && !btnText.includes('\\n')) {
        return \`\${buttonParent.tagName.toLowerCase()}:has-text("\${btnText.replace(/"/g, '\\\\"')}")\`;
      }
    }

    for (const attr of ['data-testid', 'data-test', 'data-qa', 'data-cy']) {
      const val = element.getAttribute(attr);
      if (val) return \`[\${attr}="\${val}"]\`;
    }

    if (element.id && typeof element.id === 'string' && !/^[0-9]|-[0-9a-f]{4,}|ember|react|vue|ng-/i.test(element.id)) {
      return \`#\${CSS.escape(element.id)}\`;
    }

    const name = element.getAttribute('name');
    if (name) return \`\${tag}[name="\${CSS.escape(name)}"]\`;

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return \`\${tag}[aria-label="\${CSS.escape(ariaLabel)}"]\`;

    const placeholder = element.getAttribute('placeholder');
    if (placeholder) return \`\${tag}[placeholder="\${CSS.escape(placeholder)}"]\`;

    if ((tag === 'button' || tag === 'a') && element.textContent) {
      const text = element.textContent.trim();
      if (text.length > 0 && text.length < 35 && !text.includes('\\n')) {
        return \`\${tag}:has-text("\${text.replace(/"/g, '\\\\"')}")\`;
      }
    }

    const role = element.getAttribute('role');
    if (role && ariaLabel) return \`role=\${role}[name="\${ariaLabel}"]\`;

    return buildUniqueCssSelector(element);
  }

  function buildUniqueCssSelector(element) {
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\\s+/)
          .filter(c => c && !c.includes(':') && !/^[0-9]|active|hover|focus|selected/i.test(c)).slice(0, 2);
        if (classes.length > 0) selector += '.' + classes.map(c => CSS.escape(c)).join('.');
      }
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(c => c.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += \`:nth-of-type(\${siblings.indexOf(current) + 1})\`;
        }
      }
      path.unshift(selector);
      try {
        const full = path.join(' > ');
        if (document.querySelectorAll(full).length === 1) return full;
      } catch (e) {}
      current = current.parentElement;
      if (path.length >= 4) break;
    }
    return path.join(' > ') || element.tagName.toLowerCase();
  }

  function emitAction(action) {
    stepCounter++;
    action.id = stepCounter;
    action.timestamp = Date.now();
    action.url = window.location.href;
    updateHud(action);
    if (typeof window.__austudio_record_action === 'function') {
      window.__austudio_record_action(JSON.stringify(action));
    }
  }

  function createHud() {
    if (document.getElementById('__austudio_hud__')) return;
    const hud = document.createElement('div');
    hud.id = '__austudio_hud__';
    hud.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;background:rgba(15,23,42,0.88);backdrop-filter:blur(10px);border:1px solid rgba(56,189,248,0.4);border-radius:12px;padding:10px 16px;color:#f8fafc;font-family:sans-serif;font-size:13px;display:flex;align-items:center;gap:10px;user-select:none;pointer-events:auto;';
    hud.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 8px #ef4444;"></span><strong style="color:#38bdf8;font-weight:600;">AuStudio</strong><span id="__austudio_hud_status__" style="color:#94a3b8;font-size:12px;">Recording... (0 steps)</span>';
    document.body?.appendChild(hud);
  }

  function updateHud(action) {
    const statusEl = document.getElementById('__austudio_hud_status__');
    if (!statusEl) return;
    const summary = action.type === 'fill' ? \`Fill \${action.selector}\` :
                    action.type === 'click' ? \`Click \${action.selector}\` :
                    action.type === 'press' ? \`Press \${action.key}\` : action.type;
    statusEl.innerText = \`Step \${action.id}: \${summary}\`;
  }

  function flushPendingInput() {
    if (inputDebounceTimer && lastInputElement) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
      emitAction({ type: 'fill', selector: getBestSelector(lastInputElement), value: lastInputElement.value });
      lastInputElement = null;
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    flushPendingInput();
    const selector = getBestSelector(e.target);
    const text = (e.target.textContent || '').trim().slice(0, 40);
    emitAction({ type: 'click', selector, text: text || undefined, tagName: e.target.tagName.toLowerCase() });
  }, true);

  document.addEventListener('dblclick', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    flushPendingInput();
    emitAction({ type: 'dblclick', selector: getBestSelector(e.target), tagName: e.target.tagName.toLowerCase() });
  }, true);

  document.addEventListener('input', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      lastInputElement = e.target;
      if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
      inputDebounceTimer = setTimeout(() => flushPendingInput(), 600);
    }
  }, true);

  document.addEventListener('blur', (e) => {
    if (e.target === lastInputElement) flushPendingInput();
  }, true);

  document.addEventListener('change', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    if (e.target.tagName === 'SELECT') {
      emitAction({ type: 'select', selector: getBestSelector(e.target), value: e.target.value });
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    if (['Enter', 'Escape', 'Tab'].includes(e.key)) {
      flushPendingInput();
      const selector = getBestSelector(e.target);
      emitAction({ type: 'press', key: e.key, selector: selector !== 'body' ? selector : undefined });
    }
  }, true);

  window.addEventListener('scroll', () => {
    if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
    scrollDebounceTimer = setTimeout(() => {
      emitAction({ type: 'scroll', scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) });
    }, 800);
  }, { passive: true });

  if (document.body) createHud();
  else document.addEventListener('DOMContentLoaded', createHud);
})();`;
}

module.exports = {
  getInjectedRecorderScript
};
