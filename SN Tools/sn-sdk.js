(() => {
  // Prevent double-initialization if background.js fires twice
  if (window.SNTools) return;

  const routeListeners = new Set();
  let lastUrl = location.href;

  // --- 1. SPA Route Change Watcher ---
  function notifyRouteChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;

    // Slight delay lets ServiceNow begin rendering the new workspace view
    setTimeout(() => {
      routeListeners.forEach((cb) => {
        try {
          cb(location.href);
        } catch (err) {
          console.error('[SNTools] Route listener error:', err);
        }
      });
    }, 300);
  }

  // Hook into History API for Next Experience / Workspace navigation
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    notifyRouteChange();
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    notifyRouteChange();
  };

  window.addEventListener('popstate', notifyRouteChange);

  // --- 2. Deep Shadow DOM Traversal ---
  function deepQuerySelector(selector, root = document) {
    const directMatch = root.querySelector(selector);
    if (directMatch) return directMatch;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;

    while (node) {
      // 1. Pierce Shadow DOM
      if (node.shadowRoot) {
        const found = deepQuerySelector(selector, node.shadowRoot);
        if (found) return found;
      }
      // 2. Pierce same-origin iframes (like UI16's #gsft_main)
      if (node.tagName === 'IFRAME') {
        try {
          if (node.contentDocument) {
            const found = deepQuerySelector(selector, node.contentDocument);
            if (found) return found;
          }
        } catch (e) {
          // Ignore cross-origin iframes
        }
      }
      node = walker.nextNode();
    }
    return null;
  }

  function deepQuerySelectorAll(selector, root = document, results = []) {
    results.push(...root.querySelectorAll(selector));

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;

    while (node) {
      if (node.shadowRoot) {
        deepQuerySelectorAll(selector, node.shadowRoot, results);
      }
      node = walker.nextNode();
    }
    return results;
  }

  // --- 3. Async Element Waiter (Handles Lazy-Loaded Shadow Components) ---
  function waitForElement(selector, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const existing = deepQuerySelector(selector);
      if (existing) return resolve(existing);

      const startTime = Date.now();
      const interval = setInterval(() => {
        const el = deepQuerySelector(selector);
        if (el) {
          clearInterval(interval);
          resolve(el);
        } else if (Date.now() - startTime >= timeoutMs) {
          clearInterval(interval);
          reject(new Error(`[SNTools] Timed out waiting for: ${selector}`));
        }
      }, 250);
    });
  }

  // --- 4. URL & Record Context Extractor ---
  function getRecordContext() {
    // Decode URL so encoded Next Experience classic URLs (%3Fsys_id%3D...) parse cleanly
    const decodedUrl = decodeURIComponent(location.href);

    // 1. Workspace URLs: .../record/incident/a1b2c3d4...
    const workspaceMatch = decodedUrl.match(/\/record\/([a-z0-9_]+)\/([a-f0-9]{32})/i);
    if (workspaceMatch) {
      return { table: workspaceMatch[1], sysId: workspaceMatch[2], isWorkspace: true };
    }

    // 2. Classic UI16 URLs (direct or inside Next Experience frame)
    const classicMatch = decodedUrl.match(/\/([a-z0-9_]+)\.do\?.*sys_id=([a-f0-9]{32})/i);
    if (classicMatch) {
      return { table: classicMatch[1], sysId: classicMatch[2], isWorkspace: false };
    }

    return null;
  }

  // --- 5. Deep Style Injector (For Shadow DOM Elements) ---
  // Standard <style> tags in <head> cannot pierce Shadow DOM boundaries.
  // Pass a host element (or shadowRoot) to inject CSS directly inside that shadow tree.
  function injectShadowCSS(hostOrShadowRoot, cssText, styleId = 'sn-plugin-style') {
    const targetRoot = hostOrShadowRoot.shadowRoot || hostOrShadowRoot;
    if (!targetRoot || targetRoot.getElementById?.(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = cssText;
    targetRoot.appendChild(style);
  }

  // Expose Public API
  window.SNTools = {
    query: deepQuerySelector,
    queryAll: deepQuerySelectorAll,
    waitFor: waitForElement,
    getRecord: getRecordContext,
    injectShadowCSS,
    onRouteChange(callback, runImmediately = true) {
      routeListeners.add(callback);
      if (runImmediately) callback(location.href);
      return () => routeListeners.delete(callback); // Returns unsubscribe fn
    }
  };

  console.log('[SNTools] ServiceNow Helper SDK initialized.');
})();