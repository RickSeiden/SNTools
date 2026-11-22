(() => {
    // Prevent double-initialization if background.js fires twice
    if (window.SNTools)
        return;

    const routeListeners = new Set();
    let lastUrl = location.href;

    // --- 1. SPA Route Change Watcher ---
    function notifyRouteChange() {
        if (location.href === lastUrl)
            return;
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
        if (directMatch)
            return directMatch;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode;
        while (node) {
            // 1. Pierce Shadow DOM
            if (node.shadowRoot) {
                const found = deepQuerySelector(selector, node.shadowRoot);
                if (found)
                    return found;
            }
            // 2. Pierce same-origin iframes (like UI16's #gsft_main)
            if (node.tagName === 'IFRAME') {
                try {
                    if (node.contentDocument) {
                        const found = deepQuerySelector(selector, node.contentDocument);
                        if (found)
                            return found;
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
            if (existing)
                return resolve(existing);

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
            return {
                table: workspaceMatch[1],
                sysId: workspaceMatch[2],
                isWorkspace: true
            };
        }

        // 2. Classic UI16 URLs (direct or inside Next Experience frame)
        const classicMatch = decodedUrl.match(/\/([a-z0-9_]+)\.do\?.*sys_id=([a-f0-9]{32})/i);
        if (classicMatch) {
            return {
                table: classicMatch[1],
                sysId: classicMatch[2],
                isWorkspace: false
            };
        }

        return null;
    }

    // --- 5. Deep Style Injector (For Shadow DOM Elements) ---
    // Standard <style> tags in <head> cannot pierce Shadow DOM boundaries.
    // Pass a host element (or shadowRoot) to inject CSS directly inside that shadow tree.
    function injectShadowCSS(hostOrShadowRoot, cssText, styleId = 'sn-plugin-style') {
        const targetRoot = hostOrShadowRoot.shadowRoot || hostOrShadowRoot;
        if (!targetRoot || targetRoot.getElementById?.(styleId))
            return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = cssText;
        targetRoot.appendChild(style);
    }

    function getWaitForText(el) {
        if (!el || el.nodeType !== 1) {
            console.warn('[SNTools] Please pass a valid DOM element (tip: inspect an element and pass $0).');
            return null;
        }

        const root = el.getRootNode();

        const getNodeSelector = (node) => {
            // 1. Prefer a stable ID (skip random dynamic/Seismic IDs)
            if (node.id && !/\d{4,}|^ember|^react|^seismic/i.test(node.id)) {
                return `#${CSS.escape(node.id)}`;
            }

            const tag = node.tagName.toLowerCase();

            // 2. ServiceNow-specific stable attributes
            for (const attr of['name', 'data-testid', 'data-id', 'aria-label']) {
                const val = node.getAttribute(attr);
                if (val && val.length < 60) {
                    return `${tag}[${attr}="${CSS.escape(val)}"]`;
                }
            }

            // 3. Filter out volatile state classes
            const stableClasses = Array.from(node.classList).filter(
                    (c) => !/^(is-|has-|active|focus|hover|ng-|selected|open|in|fade)/i.test(c));

            let selector = tag;
            if (stableClasses.length > 0) {
                selector += '.' + stableClasses.slice(0, 2).map((c) => CSS.escape(c)).join('.');
            }

            // 4. Add :nth-of-type if siblings share the same tag
            const parent = node.parentElement;
            if (parent) {
                const siblings = Array.from(parent.children).filter(
                        (child) => child.tagName === node.tagName);
                if (siblings.length > 1) {
                    const index = siblings.indexOf(node) + 1;
                    selector += `:nth-of-type(${index})`;
                }
            }

            return selector;
        };

        const parts = [];
        let current = el;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
            const part = getNodeSelector(current);
            parts.unshift(part);

            const candidate = parts.join(' > ');

            // Verify uniqueness both locally and across Shadow DOMs/iframes
            if (root.querySelectorAll(candidate).length === 1 && deepQuerySelector(candidate) === el) {
                const snippet = `await SNTools.waitFor('${candidate.replace(/'/g, "\\'")}')`;
                console.log(`%c[SNTools] Selector found:\n%c${snippet}`, 'color: #10b981; font-weight: bold;', 'color: #60a5fa;');
                return candidate;
            }

            if (part.startsWith('#') && root.querySelectorAll(part).length === 1) {
                break;
            }

            current = current.parentElement;
        }

        const finalSelector = parts.join(' > ');
        const snippet = `await SNTools.waitFor('${finalSelector.replace(/'/g, "\\'")}')`;
        console.log(`%c[SNTools] Selector found:\n%c${snippet}`, 'color: #10b981; font-weight: bold;', 'color: #60a5fa;');

        return finalSelector;
    }

    async function insertElement(selector, config = {}, position = 'insideAfter') {
        const target = await waitForElement(selector, config.timeout || 10000).catch(() => null);
        if (!target) {
            console.warn(`[SNTools] Target not found for selector: ${selector}`);
            return null;
        }

        const doc = target.ownerDocument;

        // Prevent duplicates if an id is provided
        if (config.id) {
            const existing = doc.getElementById(config.id);
            if (existing)
                return existing;
        }

        // Determine HTML tag (defaults to 'button' if type is 'button', otherwise 'div')
        const tag = config.tag || (config.type === 'button' ? 'button' : 'div');
        const el = doc.createElement(tag);

        if (config.id)
            el.id = config.id;
        if (config.type)
            el.type = config.type;

        // Support both standard DOM names and natural aliases
        const cls = config.className || config.classname;
        if (cls)
            el.className = cls;

        const text = config.textContent ?? config.textContext ?? config.text;
        if (text !== undefined)
            el.textContent = text;

        if (config.html !== undefined)
            el.innerHTML = config.html;
        if (config.title)
            el.title = config.title;

        // Optional inline styles object: style: { marginLeft: '8px' }
        if (config.style && typeof config.style === 'object') {
            Object.assign(el.style, config.style);
        }

        // Optional extra HTML attributes: attrs: { 'data-action': 'copy' }
        if (config.attrs && typeof config.attrs === 'object') {
            for (const[key, val]of Object.entries(config.attrs)) {
                el.setAttribute(key, val);
            }
        }

        // Attach event handlers (onclick, onchange, onmouseover, etc.)
        for (const[key, val]of Object.entries(config)) {
            if (key.startsWith('on') && typeof val === 'function') {
                el[key.toLowerCase()] = val;
            }
        }

        // Optional flex alignment on parent when inserting inside
        if (config.flexParent && (position === 'insideAfter' || position === 'insideBefore')) {
            target.style.display = 'flex';
            target.style.alignItems = 'center';
            target.style.gap = config.gap || '6px';
        }

        switch (position) {
        case 'insideBefore':
            target.prepend(el);
            break;
        case 'before':
            target.before(el);
            break;
        case 'after':
            target.after(el);
            break;
        case 'insideAfter':
        default:
            target.appendChild(el);
            break;
        }

        return el;
    }

    function getFormAPI() {
        if (window.g_form)
            return window.g_form;

        // Locate gsft_main even when nested inside Next Experience Shadow DOMs
        const mainFrame = deepQuerySelector('iframe#gsft_main');
        if (mainFrame && mainFrame.contentWindow && mainFrame.contentWindow.g_form) {
            return mainFrame.contentWindow.g_form;
        }

        return null;
    }
	
function waitForLoaded(timeout = 15000) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkReady = () => {
        if (Date.now() - startTime > timeout) {
          return reject(new Error('[SNTools] Timed out waiting for page to finish loading.'));
        }

        // 1. Top-level document must be complete
        if (document.readyState !== 'complete') {
          return setTimeout(checkReady, 100);
        }

        // 2. If gsft_main iframe exists (Classic UI16 or Next Experience Polaris), wait for it too
        const mainFrame = deepQuerySelector('iframe#gsft_main');
        if (mainFrame) {
          try {
            const frameDoc = mainFrame.contentDocument;
            const frameWin = mainFrame.contentWindow;
            const frameHref = frameWin?.location?.href || '';

            if (!frameDoc || frameDoc.readyState !== 'complete' || frameHref === 'about:blank') {
              return setTimeout(checkReady, 100);
            }

            return resolve({
              window: frameWin,
              document: frameDoc
            });
          } catch (e) {
            // Cross-origin frame fallback
            return resolve({ window, document });
          }
        }

        // 3. Non-framed pages (Workspaces, Service Portal, direct .do pages)
        if (!document.body || document.body.children.length === 0) {
          return setTimeout(checkReady, 100);
        }

        return resolve({ window, document });
      };

      checkReady();
    });
  }

	async function hideElementAPI(selector, timeout=10000){
		try{
			const target = await waitForElement(selector, timeout || 10000).catch(() => null);
			if (!target) {
				console.warn(`[SNTools] Target not found for selector: ${selector}`);
				return null;
			}

			target.style.display = "none";
		} catch (e){
			console.log("[SNTools] hideElement error: "+e.message);
		}
	}
	
    window.SNTools = {
        query: deepQuerySelector,
        queryAll: deepQuerySelectorAll,
        waitFor: waitForElement,
        getRecord: getRecordContext,
        injectShadowCSS,
        getWaitFor: getWaitForText,
        insertElement: insertElement,
        onRouteChange(callback, runImmediately = true) {
            routeListeners.add(callback);
            if (runImmediately)
                callback(location.href);
            return () => routeListeners.delete(callback);
        },
        addInsideAfter: (selector, config) => insertElement(selector, config, 'insideAfter'),
        addInsideBefore: (selector, config) => insertElement(selector, config, 'insideBefore'),
        addBefore: (selector, config) => insertElement(selector, config, 'before'),
        addAfter: (selector, config) => insertElement(selector, config, 'after'),
		g_form:getFormAPI,
		waitForLoaded,
		hideElement: hideElementAPI

    };

    console.log('[SNTools] ServiceNow Helper SDK initialized.');
})();
