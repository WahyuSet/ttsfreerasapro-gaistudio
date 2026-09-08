/**
 * Injected script for recording user actions inside the browser.
 * This runs in the context of the page (injected via context.addInitScript).
 */

function getInjectedRecorderScript() {
  return `(() => {
  if (window.__AUSTUDIO_RECORDER_INITIALIZED__) return;
  window.__AUSTUDIO_RECORDER_INITIALIZED__ = true;

  let stepCounter = 0;
  let inputDebounceTimer = null;
  let lastInputElement = null;
  let scrollDebounceTimer = null;

  // --- Selector Generation Logic ---
  function getBestSelector(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return 'body';

    const tag = element.tagName.toLowerCase();

    // 0. If clicked inside a button, link, or role="button", inspect the parent button first
    const buttonParent = element.closest('button, [role="button"], a');
    if (buttonParent) {
      const btnAria = buttonParent.getAttribute('aria-label');
      if (btnAria) {
        return \`\${buttonParent.tagName.toLowerCase()}[aria-label="\${CSS.escape(btnAria)}"]\`;
      }
      for (const attr of ['data-testid', 'data-test', 'data-qa']) {
        const val = buttonParent.getAttribute(attr);
        if (val) return \`[\${attr}="\${val}"]\`;
      }
      const btnText = (buttonParent.textContent || '').trim();
      if (btnText && btnText.length > 0 && btnText.length < 35 && !btnText.includes('\\n')) {
        return \`\${buttonParent.tagName.toLowerCase()}:has-text("\${btnText.replace(/"/g, '\\\\"')}")\`;
      }
    }

    // 1. Check data-testid or custom test attributes
    const testAttrs = ['data-testid', 'data-test', 'data-qa', 'data-cy'];
    for (const attr of testAttrs) {
      const val = element.getAttribute(attr);
      if (val) return \`[\${attr}="\${val}"]\`;
    }

    // 2. Check id (avoiding dynamic/generated IDs)
    if (element.id && typeof element.id === 'string' && !/^[0-9]|-[0-9a-f]{4,}|ember|react|vue|ng-/i.test(element.id)) {
      return \`#\${CSS.escape(element.id)}\`;
    }

    // 3. Check name attribute for inputs/buttons/forms
    const name = element.getAttribute('name');
    if (name) {
      return \`\${tag}[name="\${CSS.escape(name)}"]\`;
    }

    // 4. Check aria-label or placeholder
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return \`\${tag}[aria-label="\${CSS.escape(ariaLabel)}"]\`;
    }
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) {
      return \`\${tag}[placeholder="\${CSS.escape(placeholder)}"]\`;
    }

    // 5. Check button or link with clean text content
    if ((tag === 'button' || tag === 'a') && element.textContent) {
      const text = element.textContent.trim();
      if (text.length > 0 && text.length < 35 && !text.includes('\\n')) {
        return \`\${tag}:has-text("\${text.replace(/"/g, '\\\\"')}")\`;
      }
    }

    // 6. Role-based selector if available
    const role = element.getAttribute('role');
    if (role && ariaLabel) {
      return \`role=\${role}[name="\${ariaLabel}"]\`;
    }

    // 7. Fallback to unique CSS hierarchy
    return buildUniqueCssSelector(element);
  }

  function buildUniqueCssSelector(element) {
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      // If has clean class
      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .trim()
          .split(/\\s+/)
          .filter(c => c && !c.includes(':') && !/^[0-9]|active|hover|focus|selected/i.test(c))
          .slice(0, 2);
        if (classes.length > 0) {
          selector += '.' + classes.map(c => CSS.escape(c)).join('.');
        }
      }

      // Check uniqueness among siblings
      if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(
          c => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += \`:nth-of-type(\${index})\`;
        }
      }

      path.unshift(selector);
      try {
        const fullSelector = path.join(' > ');
        if (document.querySelectorAll(fullSelector).length === 1) {
          return fullSelector;
        }
      } catch (e) {
        // If querySelector fails due to complex selector
      }

      current = current.parentElement;
      if (path.length >= 4) break; // keep path reasonable
    }

    return path.join(' > ') || element.tagName.toLowerCase();
  }

  // --- Send Action to Node.js ---
  function emitAction(action) {
    stepCounter++;
    action.id = stepCounter;
    action.timestamp = Date.now();
    action.url = window.location.href;

    // Update floating HUD
    updateHud(action);

    // Send to backend via exposed function
    if (typeof window.__austudio_record_action === 'function') {
      window.__austudio_record_action(JSON.stringify(action));
    }
  }

  // --- Floating in-browser HUD ---
  function createHud() {
    if (document.getElementById('__austudio_hud__')) return;

    const hud = document.createElement('div');
    hud.id = '__austudio_hud__';
    hud.style.cssText = \`
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(56, 189, 248, 0.4);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(56, 189, 248, 0.2);
      border-radius: 12px;
      padding: 10px 16px;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      user-select: none;
      pointer-events: auto;
      transition: transform 0.2s, opacity 0.2s;
    \`;

    hud.innerHTML = \`
      <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:#ef4444; box-shadow:0 0 8px #ef4444; animation:austudio_pulse 1.5s infinite;"></span>
      <strong style="color:#38bdf8; font-weight:600;">AuStudio</strong>
      <span id="__austudio_hud_status__" style="color:#94a3b8; font-size:12px;">Recording... (0 steps)</span>
    \`;

    const style = document.createElement('style');
    style.innerHTML = \`
      @keyframes austudio_pulse {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.85); }
        100% { opacity: 1; transform: scale(1); }
      }
    \`;

    document.head?.appendChild(style);
    document.body?.appendChild(hud);
  }

  function updateHud(action) {
    const statusEl = document.getElementById('__austudio_hud_status__');
    if (!statusEl) return;
    const summary = action.type === 'fill' ? \`Fill \${action.selector}\` :
                    action.type === 'click' ? \`Click \${action.selector}\` :
                    action.type === 'press' ? \`Press \${action.key}\` :
                    action.type;
    statusEl.innerText = \`Step \${action.id}: \${summary}\`;
  }

  // --- Event Listeners ---

  // 1. Click handling
  document.addEventListener('click', (e) => {
    // Ignore HUD clicks
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;

    // Flush any pending text input before recording click
    flushPendingInput();

    const selector = getBestSelector(e.target);
    const text = (e.target.textContent || '').trim().slice(0, 40);

    emitAction({
      type: 'click',
      selector,
      text: text || undefined,
      tagName: e.target.tagName.toLowerCase()
    });
  }, true);

  // 2. Double click handling
  document.addEventListener('dblclick', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    flushPendingInput();

    const selector = getBestSelector(e.target);
    emitAction({
      type: 'dblclick',
      selector,
      tagName: e.target.tagName.toLowerCase()
    });
  }, true);

  // 3. Input & Typing with Debounce
  function flushPendingInput() {
    if (inputDebounceTimer && lastInputElement) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
      const selector = getBestSelector(lastInputElement);
      const val = lastInputElement.value;
      emitAction({
        type: 'fill',
        selector,
        value: val
      });
      lastInputElement = null;
    }
  }

  document.addEventListener('input', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      lastInputElement = e.target;
      if (inputDebounceTimer) clearTimeout(inputDebounceTimer);

      inputDebounceTimer = setTimeout(() => {
        flushPendingInput();
      }, 600);
    }
  }, true);

  document.addEventListener('blur', (e) => {
    if (e.target === lastInputElement) {
      flushPendingInput();
    }
  }, true);

  // 4. Select Dropdown change
  document.addEventListener('change', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;
    if (e.target.tagName === 'SELECT') {
      const selector = getBestSelector(e.target);
      emitAction({
        type: 'select',
        selector,
        value: e.target.value
      });
    }
  }, true);

  // 5. Keydown (Enter, Tab, Escape)
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('#__austudio_hud__')) return;

    // Special keys worthy of recording
    if (['Enter', 'Escape', 'Tab'].includes(e.key)) {
      flushPendingInput();
      const selector = getBestSelector(e.target);
      emitAction({
        type: 'press',
        key: e.key,
        selector: selector !== 'body' ? selector : undefined
      });
    }
  }, true);

  // 6. Scroll tracking (debounced)
  window.addEventListener('scroll', () => {
    if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);
    scrollDebounceTimer = setTimeout(() => {
      emitAction({
        type: 'scroll',
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY)
      });
    }, 800);
  }, { passive: true });

  // Initialize HUD once DOM is ready
  if (document.body) {
    createHud();
  } else {
    document.addEventListener('DOMContentLoaded', createHud);
  }
})();`;
}

module.exports = {
  getInjectedRecorderScript
};
