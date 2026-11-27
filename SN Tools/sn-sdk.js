(() => {
    // Prevent double-initialization if background.js fires twice
    if (window.SNPlugins)
        return;

    const routeListeners = new Set();
    const registeredStyles = new Map();
    const persistentTasks = new Map();
    let persistenceObserver = null;
    let persistenceTimer = null;
    let lastUrl = location.href;

    // --- 1. SPA Route Change Watcher ---
    function notifyRouteChange() {
        if (location.href === lastUrl)
            return;
        lastUrl = location.href;

        // Clear route-scoped persistent tasks when navigating to a new record/page
        for (const [key, task] of persistentTasks.entries()) {
            if (task._clearOnRouteChange) {
                persistentTasks.delete(key);
            }
        }

        // Slight delay lets ServiceNow begin rendering the new workspace view
        setTimeout(() => {
            routeListeners.forEach((cb) => {
                try {
                    cb(location.href);
                } catch (err) {
                    console.error('[SNPlugins] Route listener error:', err);
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

    // --- 2. Deep Shadow DOM Traversal (Supports '>>>' Shadow Piercing) ---
    function deepQuerySelector(selector, root = document) {
        if (selector.includes('>>>')) {
            const segments = selector.split('>>>').map(s => s.trim()).filter(Boolean);
            let currentRoot = root;
            let found = null;
            for (const seg of segments) {
                found = deepQuerySelector(seg, currentRoot);
                if (!found) return null;
                currentRoot = found.shadowRoot || found;
            }
            return found;
        }

        const directMatch = root.querySelector(selector);
        if (directMatch) return directMatch;

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode;
        while (node) {
            if (node.shadowRoot) {
                const found = deepQuerySelector(selector, node.shadowRoot);
                if (found) return found;
            }
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
        if (selector.includes('>>>')) {
            const segments = selector.split('>>>').map(s => s.trim()).filter(Boolean);
            let currentRoots = [root];

            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const isLast = i === segments.length - 1;
                const nextLevel = [];

                for (const r of currentRoots) {
                    const matches = deepQuerySelectorAll(seg, r, []);
                    for (const match of matches) {
                        nextLevel.push(isLast ? match : (match.shadowRoot || match));
                    }
                }

                if (nextLevel.length === 0) return results;
                currentRoots = nextLevel;
            }

            results.push(...currentRoots);
            return results;
        }

        results.push(...root.querySelectorAll(selector));

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let node = walker.currentNode;
        while (node) {
            if (node.shadowRoot) {
                deepQuerySelectorAll(selector, node.shadowRoot, results);
            }
            if (node.tagName === 'IFRAME') {
                try {
                    if (node.contentDocument) {
                        deepQuerySelectorAll(selector, node.contentDocument, results);
                    }
                } catch (e) {
                    // Ignore cross-origin iframes
                }
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
                    reject(new Error(`[SNPlugins] Timed out waiting for: ${selector}`));
                }
            }, 250);
        });
    }

    // --- 4. URL & Record Context Extractor ---
    function getRecordContext() {
        const decodedUrl = decodeURIComponent(location.href);

        // 1. Workspace URLs (matches active primary tab or active /sub/record/ tab)
        const workspaceMatch = decodedUrl.match(/.*\/record\/([a-z0-9_]+)\/([a-f0-9]{32})/i);
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

    // --- 5. Deep Style Injector & Auto-Registration ---
    function injectShadowCSS(hostOrShadowRoot, cssText, styleId = 'sn-plugin-style') {
        const targetRoot = hostOrShadowRoot.shadowRoot || hostOrShadowRoot;
        if (!targetRoot || targetRoot.getElementById?.(styleId))
            return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = cssText;
        targetRoot.appendChild(style);
    }

    function registerPluginCSS(pluginId, cssText) {
        if (pluginId && cssText) {
            registeredStyles.set(pluginId, cssText);
        }
    }

    function applyRegisteredCSS(root) {
        if (!root || registeredStyles.size === 0) return;

        // If target is inside an iframe's Document, inject into its <head>
        if (root.nodeType === Node.DOCUMENT_NODE && root !== document) {
            for (const [pluginId, cssText] of registeredStyles.entries()) {
                const styleId = `sn-plugin-style-${pluginId}`;
                if (!root.getElementById(styleId)) {
                    const style = root.createElement('style');
                    style.id = styleId;
                    style.textContent = cssText;
                    root.head.appendChild(style);
                }
            }
            return;
        }

        // If target is inside a ShadowRoot, inject directly into that ShadowRoot
        if (root instanceof ShadowRoot) {
            for (const [pluginId, cssText] of registeredStyles.entries()) {
                injectShadowCSS(root, cssText, `sn-plugin-style-${pluginId}`);
            }
        }
    }

    // --- 6. Re-Render Persistence Manager ---
    function runPersistentTasks() {
        for (const [key, task] of persistentTasks.entries()) {
            try {
                task();
            } catch (err) {
                console.warn(`[SNPlugins] Persistent task "${key}" error:`, err);
            }
        }
    }

    function ensurePersistenceObserver() {
        if (persistenceObserver) return;

        const scheduleRun = () => {
            if (persistenceTimer) return;
            persistenceTimer = setTimeout(() => {
                persistenceTimer = null;
                runPersistentTasks();
            }, 250);
        };

        persistenceObserver = new MutationObserver(scheduleRun);
        persistenceObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    // --- 7. DevTools Shadow-Piercing Selector Helper ---
    function getWaitForText(el) {
        if (!el || el.nodeType !== 1) {
            console.warn('[SNPlugins] Please pass a valid DOM element (tip: inspect an element and pass $0).');
            return null;
        }

        const getNodeSelector = (node) => {
            // 1. Prefer a stable ID (skip random dynamic/Seismic/UUID IDs)
            if (node.id && !/\d{4,}|[a-f0-9]{8,}|^ember|^react|^seismic|^sn-|^now-/i.test(node.id)) {
                return `#${CSS.escape(node.id)}`;
            }

            const tag = node.tagName.toLowerCase();

            // 2. ServiceNow & Seismic stable attributes
            for (const attr of ['name', 'data-testid', 'data-id', 'data-field', 'aria-label']) {
                const val = node.getAttribute(attr);
                if (val && val.length < 60 && !/\d{4,}|[a-f0-9]{16,}/i.test(val)) {
                    return `${tag}[${attr}="${CSS.escape(val)}"]`;
                }
            }

            // 3. Filter out volatile state & Seismic generated classes
            const stableClasses = Array.from(node.classList).filter(
                (c) => !/^(is-|has-|active|focus|hover|ng-|selected|open|in|fade|sn-gen-|now-gen-|css-)/i.test(c)
            );

            let selector = tag;
            if (stableClasses.length > 0) {
                selector += '.' + stableClasses.slice(0, 2).map((c) => CSS.escape(c)).join('.');
            }

            // 4. Add :nth-of-type if siblings share the same tag
            const parent = node.parentElement || node.parentNode;
            if (parent && parent.children) {
                const siblings = Array.from(parent.children).filter(
                    (child) => child.tagName === node.tagName
                );
                if (siblings.length > 1) {
                    const index = siblings.indexOf(node) + 1;
                    selector += `:nth-of-type(${index})`;
                }
            }

            return selector;
        };

        // Build selector chains grouped by ShadowRoot boundaries, joined by ' >>> '
        const shadowChains = [];
        let currentChain = [];
        let current = el;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
            const part = getNodeSelector(current);
            currentChain.unshift(part);

            const candidate = [currentChain.join(' > '), ...shadowChains].join(' >>> ');
            if (deepQuerySelector(candidate) === el) {
                const snippet = `await SNPlugins.waitFor('${candidate.replace(/'/g, "\\'")}')`;
                console.log(`%c[SNPlugins] Selector found:\n%c${snippet}`, 'color: #10b981; font-weight: bold;', 'color: #60a5fa;');
                return candidate;
            }

            if (current.parentElement) {
                current = current.parentElement;
            } else {
                const root = current.getRootNode();
                if (root instanceof ShadowRoot && root.host) {
                    shadowChains.unshift(currentChain.join(' > '));
                    currentChain = [];
                    current = root.host;
                } else {
                    break;
                }
            }
        }

        if (currentChain.length > 0) {
            shadowChains.unshift(currentChain.join(' > '));
        }

        const finalSelector = shadowChains.join(' >>> ');
        const snippet = `await SNPlugins.waitFor('${finalSelector.replace(/'/g, "\\'")}')`;
        console.log(`%c[SNPlugins] Selector found:\n%c${snippet}`, 'color: #10b981; font-weight: bold;', 'color: #60a5fa;');
        return finalSelector;
    }

    // --- 8. DOM Insertion & Hiding Helpers ---
    function createConfiguredElement(doc, config) {
        const tag = config.tag || (config.type === 'button' ? 'button' : 'div');
        const el = doc.createElement(tag);

        if (config.id) el.id = config.id;
        if (config.type) el.type = config.type;

        const cls = config.className || config.classname;
        if (cls) el.className = cls;

        const text = config.textContent ?? config.textContext ?? config.text;
        if (text !== undefined) el.textContent = text;

        if (config.html !== undefined) el.innerHTML = config.html;
        if (config.title) el.title = config.title;

        if (config.style && typeof config.style === 'object') {
            Object.assign(el.style, config.style);
        }

        if (config.attrs && typeof config.attrs === 'object') {
            for (const [key, val] of Object.entries(config.attrs)) {
                el.setAttribute(key, val);
            }
        }

        for (const [key, val] of Object.entries(config)) {
            if (key.startsWith('on') && typeof val === 'function') {
                el[key.toLowerCase()] = val;
            }
        }

        return el;
    }

    function placeElement(target, el, position, config) {
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
    }

    async function insertElement(selector, config = {}, position = 'insideAfter') {
        const target = await waitForElement(selector, config.timeout || 10000).catch(() => null);
        if (!target) {
            console.warn(`[SNPlugins] Target not found for selector: ${selector}`);
            return null;
        }

        const root = target.getRootNode();
        applyRegisteredCSS(root);

        // Prevent duplicates if an id is provided (scoped to current Document or ShadowRoot)
        if (config.id && typeof root.getElementById === 'function') {
            const existing = root.getElementById(config.id);
            if (existing) return existing;
        }

        const el = createConfiguredElement(target.ownerDocument, config);
        placeElement(target, el, position, config);

        // Re-inject automatically if Seismic re-renders and wipes out the element
        if (config.persistent && config.id) {
            const taskKey = `insert:${config.id}`;
            const task = () => {
                const currentTarget = deepQuerySelector(selector);
                if (!currentTarget) return;

                const currentRoot = currentTarget.getRootNode();
                applyRegisteredCSS(currentRoot);

                if (typeof currentRoot.getElementById === 'function' && currentRoot.getElementById(config.id)) {
                    return;
                }

                const freshEl = createConfiguredElement(currentTarget.ownerDocument, config);
                placeElement(currentTarget, freshEl, position, config);
            };
            task._clearOnRouteChange = config.clearOnRouteChange !== false;
            persistentTasks.set(taskKey, task);
            ensurePersistenceObserver();
        }

        return el;
    }

    async function hideElementAPI(selector, options = {}) {
        const opts = typeof options === 'number' ? { timeout: options } : (options || {});
        try {
            const target = await waitForElement(selector, opts.timeout || 10000).catch(() => null);
            if (!target) {
                console.warn(`[SNPlugins] Target not found for selector: ${selector}`);
                return null;
            }

            target.style.display = 'none';

            if (opts.persistent) {
                const taskKey = `hide:${selector}`;
                const task = () => {
                    const currentTarget = deepQuerySelector(selector);
                    if (currentTarget && currentTarget.style.display !== 'none') {
                        currentTarget.style.display = 'none';
                    }
                };
                task._clearOnRouteChange = opts.clearOnRouteChange !== false;
                persistentTasks.set(taskKey, task);
                ensurePersistenceObserver();
            }

            return target;
        } catch (e) {
            console.log('[SNPlugins] hideElement error: ' + e.message);
            return null;
        }
    }

    async function hideElementAllAPI(selector, options = {}) {
        const opts = typeof options === 'number' ? { timeout: options } : (options || {});
        const persist = opts.persistent !== false; // Default to persistent across workspace tab/route changes

        const applyHideToAll = () => {
            const matches = deepQuerySelectorAll(selector);
            matches.forEach((el) => {
                if (el && el.style.display !== 'none') {
                    el.style.display = 'none';
                }
            });
            return matches.length;
        };

        try {
            const firstMatch = await waitForElement(selector, opts.timeout || 10000).catch(() => null);
            if (!firstMatch) {
                console.warn(`[SNPlugins] Target not found for selector: ${selector}`);
                return [];
            }

            applyHideToAll();

            if (persist) {
                const taskKey = `hideAll:${selector}`;
                const task = () => {
                    applyHideToAll();
                };
                // Survive route/tab changes unless explicitly set to clearOnRouteChange: true
                task._clearOnRouteChange = Boolean(opts.clearOnRouteChange);
                persistentTasks.set(taskKey, task);
                ensurePersistenceObserver();
            }

            return deepQuerySelectorAll(selector);
        } catch (e) {
            console.log('[SNPlugins] hideElementAll error: ' + e.message);
            return [];
        }
    }

    // --- 9. Form & Page Lifecycle Helpers ---
    function wrapWorkspaceForm(rawForm, recordCtx) {
        const callIfFn = (methodNames, args, fallback = undefined) => {
            for (const name of methodNames) {
                if (typeof rawForm[name] === 'function') {
                    return rawForm[name](...args);
                }
            }
            return fallback;
        };

        return {
            _raw: rawForm,
            _isWorkspace: true,

            // Core read/write
            getValue: (fieldName) => callIfFn(['getValue'], [fieldName], ''),
            getDisplayValue: (fieldName) => callIfFn(['getDisplayValue'], [fieldName], ''),
            setValue: (fieldName, value, displayValue) =>
                callIfFn(['setValue'], displayValue !== undefined ? [fieldName, value, displayValue] : [fieldName, value]),

            // Record metadata
            getTableName: () => callIfFn(['getTableName'], [], recordCtx?.table || ''),
            getUniqueValue: () => callIfFn(['getUniqueValue'], [], recordCtx?.sysId || ''),

            // Messages & save
            addInfoMessage: (msg) => callIfFn(['addInfoMessage'], [msg]),
            addErrorMessage: (msg) => callIfFn(['addErrorMessage'], [msg]),
            clearMessages: () => callIfFn(['clearMessages'], []),
            save: () => callIfFn(['save'], []),

            // Field state & messages (parity pass)
            setMandatory: (fieldName, mandatory) => callIfFn(['setMandatory'], [fieldName, Boolean(mandatory)]),
            setReadOnly: (fieldName, readOnly) => callIfFn(['setReadOnly'], [fieldName, Boolean(readOnly)]),
            setVisible: (fieldName, visible) => callIfFn(['setVisible', 'setDisplay'], [fieldName, Boolean(visible)]),
            setDisplay: (fieldName, display) => callIfFn(['setDisplay', 'setVisible'], [fieldName, Boolean(display)]),
            showFieldMsg: (fieldName, message, type = 'info') =>
                callIfFn(['showFieldMsg'], [fieldName, message, type]),
            hideFieldMsg: (fieldName, clearAll = false) =>
                callIfFn(['hideFieldMsg'], [fieldName, clearAll])
        };
    }
    function extractWorkspaceFormController(hostEl) {
        if (!hostEl) return null;

        // Known Seismic / Next Experience controller & state locations
        const candidates = [
            hostEl.gForm,
            hostEl.g_form,
            hostEl.nowRecordFormBlob?.gForm,
            hostEl.nowRecordFormBlob?.g_form,
            hostEl.state?.gForm,
            hostEl.state?.g_form,
            hostEl._gForm,
            hostEl._g_form
        ];

        for (const ctrl of candidates) {
            if (ctrl && typeof ctrl.getValue === 'function') {
                return ctrl;
            }
        }

        // Check child elements inside shadowRoot (e.g., sn-form-internal-* or nested form controllers)
        if (hostEl.shadowRoot) {
            const innerNodes = hostEl.shadowRoot.querySelectorAll('*');
            for (const node of innerNodes) {
                const innerCtrl =
                    node.gForm ||
                    node.g_form ||
                    node.nowRecordFormBlob?.gForm ||
                    node.state?.gForm;
                if (innerCtrl && typeof innerCtrl.getValue === 'function') {
                    return innerCtrl;
                }
            }
        }

        return null;
    }

    function findActiveWorkspaceFormController() {
        const recordCtx = getRecordContext();
        const hosts = deepQuerySelectorAll(
            'sn-form-data-connected, now-record-form-connected, sn-record-form-connected, now-record-form, sn-record-form'
        );

        if (!hosts.length) return null;

        // Prefer a host whose sysId matches the active route/sub-tab if detectable
        if (recordCtx?.sysId) {
            for (const host of hosts) {
                const ctrl = extractWorkspaceFormController(host);
                if (ctrl) {
                    const id = typeof ctrl.getUniqueValue === 'function'
                        ? ctrl.getUniqueValue()
                        : (host.getAttribute('sys-id') || host.getAttribute('sys_id') || '');
                    if (!id || id.toLowerCase() === recordCtx.sysId.toLowerCase()) {
                        return ctrl;
                    }
                }
            }
        }

        // Fallback to first host with a valid controller
        for (const host of hosts) {
            const ctrl = extractWorkspaceFormController(host);
            if (ctrl) return ctrl;
        }

        return null;
    }

    function getFormAPI() {
        // 1. Classic UI16 / direct g_form
        if (window.g_form)
            return window.g_form;

        // 2. Classic UI16 inside gsft_main iframe
        const mainFrame = deepQuerySelector('iframe#gsft_main');
        if (mainFrame && mainFrame.contentWindow && mainFrame.contentWindow.g_form) {
            return mainFrame.contentWindow.g_form;
        }

        // 3. Configurable Workspace controller
        const wsForm = findActiveWorkspaceFormController();
        if (wsForm) {
            return wrapWorkspaceForm(wsForm, getRecordContext());
        }

        return null;
    }

    function isWorkspacePage() {
        // 1. Classic UI16 iframe is present -> not a Workspace view
        if (deepQuerySelector('iframe#gsft_main')) return false;

        // 2. Check URL path: /now/<app>/... (excluding /now/nav/ui/classic)
        const path = location.pathname.toLowerCase();
        if (path.startsWith('/now/') && !path.startsWith('/now/nav/ui/classic')) {
            return true;
        }

        // 3. Check for Seismic Workspace / Experience shell components
        return Boolean(
            deepQuerySelector('sn-workspace-layout, sn-canvas-root, now-record-form-connected, sn-record-form')
        );
    }

    function waitForLoaded(timeout = 15000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            const checkReady = () => {
                if (Date.now() - startTime > timeout) {
                    return reject(new Error('[SNPlugins] Timed out waiting for page to finish loading.'));
                }

                // 1. Top-level document must be complete
                if (document.readyState !== 'complete') {
                    return setTimeout(checkReady, 100);
                }

                // 2. Classic UI16 / Polaris gsft_main iframe
                const mainFrame = deepQuerySelector('iframe#gsft_main');
                if (mainFrame) {
                    try {
                        const frameDoc = mainFrame.contentDocument;
                        const frameWin = mainFrame.contentWindow;
                        const frameHref = frameWin?.location?.href || '';

                        if (!frameDoc || frameDoc.readyState !== 'complete' || frameHref === 'about:blank') {
                            return setTimeout(checkReady, 100);
                        }

                        return resolve({ window: frameWin, document: frameDoc, isWorkspace: false });
                    } catch (e) {
                        return resolve({ window, document, isWorkspace: false });
                    }
                }

                // 3. Configurable Workspace (Seismic Web Components)
                // 3. Configurable Workspace (Seismic Web Components)
                const recordCtx = getRecordContext();
                if (recordCtx?.isWorkspace || isWorkspacePage()) {
                    const elapsed = Date.now() - startTime;
                    const formHost = deepQuerySelector(
                        'sn-form-data-connected, sn-form-internal-uiactionbar, now-record-form-connected, sn-record-form-connected, now-record-form, sn-record-form'
                    );

                    // Fast path: record form host is mounted
                    if (recordCtx && formHost && formHost.shadowRoot) {
                        return resolve({ window, document, root: formHost.shadowRoot, isWorkspace: true });
                    }

                    // Fallback: workspace canvas/shell is mounted (handles home/list views or custom tabs)
                    const shellHost = deepQuerySelector(
                        'sn-canvas-root, sn-workspace-layout, macroponent-f51912f4c700201072b211d4d8c26010, seismic-hoist'
                    );
                    if (shellHost && shellHost.shadowRoot && (!recordCtx || elapsed >= 2000)) {
                        return resolve({ window, document, root: shellHost.shadowRoot, isWorkspace: true });
                    }

                    return setTimeout(checkReady, 150);
                }

                // 4. Service Portal / direct .do pages
                if (!document.body || document.body.children.length === 0) {
                    return setTimeout(checkReady, 100);
                }

                return resolve({ window, document, isWorkspace: false });
            };

            checkReady();
        });
    }

    // --- 10. ServiceNow Session Token (g_ck) & REST API Helper ---
    let cachedUserToken = null;

    async function getUserToken() {
        if (window.g_ck) {
            cachedUserToken = window.g_ck;
            return cachedUserToken;
        }

        if (window.NOW && window.NOW.g_ck) {
            cachedUserToken = window.NOW.g_ck;
            return cachedUserToken;
        }

        const mainFrame = deepQuerySelector('iframe#gsft_main');
        if (mainFrame) {
            try {
                if (mainFrame.contentWindow && mainFrame.contentWindow.g_ck) {
                    cachedUserToken = mainFrame.contentWindow.g_ck;
                    return cachedUserToken;
                }
            } catch (e) { }
        }

        if (cachedUserToken) {
            return cachedUserToken;
        }

        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
            const match = s.textContent && s.textContent.match(/g_ck\s*=\s*['"]([a-f0-9]+)['"]/i);
            if (match && match[1]) {
                cachedUserToken = match[1];
                return cachedUserToken;
            }
        }

        try {
            const resp = await fetch('/nav_to.do', { credentials: 'same-origin' });
            const html = await resp.text();
            const match = html.match(/g_ck\s*=\s*['"]([a-f0-9]+)['"]/i);
            if (match && match[1]) {
                cachedUserToken = match[1];
                return cachedUserToken;
            }
        } catch (err) {
            console.warn('[SNPlugins] Failed to retrieve g_ck fallback token:', err);
        }

        return null;
    }

    async function restAPI(url, options = {}) {
        if (options.method && options.method.toUpperCase() != 'GET') {
            throw new Error(`[SNPlugins] Read-only restriction: HTTP method "${options.method}" is not permitted. Only GET requests are allowed.`);
        }
        const token = await getUserToken();
        if (!token) {
            throw new Error('[SNPlugins] Unable to locate ServiceNow session token (g_ck).');
        }

        const targetUrl = url.startsWith('http')
            ? url
            : new URL(url.startsWith('/') ? url : `/${url}`, location.origin).toString();

        const method = (options.method || 'GET').toUpperCase();

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'X-UserToken': token,
            ...(options.headers || {})
        };

        const fetchOptions = {
            method,
            headers,
            credentials: 'same-origin'
        };

        if (options.body !== undefined && method !== 'GET' && method !== 'HEAD') {
            fetchOptions.body = typeof options.body === 'string'
                ? options.body
                : JSON.stringify(options.body);
        }

        const response = await fetch(targetUrl, fetchOptions);

        if (response.status === 204) {
            return null;
        }

        const contentType = response.headers.get('content-type') || '';
        const data = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const detail = data?.error?.message || response.statusText;
            const err = new Error(`[SNPlugins] REST ${method} failed (${response.status}): ${detail}`);
            err.status = response.status;
            err.response = data;
            throw err;
        }

        return data;
    }

    function consoleSNPlugins(message, level) {
        if (!message) return;
        switch (level) {
            case 'info':
                console.info('[SNPlugins] ' + message);
                break;
            case 'error':
                console.error('[SNPlugins] ' + message);
                break;
            case 'log':
            default:
                console.log('[SNPlugins] ' + message);
        }
    }

    window.SNPlugins = {
        query: deepQuerySelector,
        queryAll: deepQuerySelectorAll,
        waitFor: waitForElement,
        getRecord: getRecordContext,
        injectShadowCSS,
        _registerPluginCSS: registerPluginCSS,
        getWaitFor: getWaitForText,
        insertElement,
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
        g_form: getFormAPI,
        waitForLoaded,
        hideElement: hideElementAPI,
        hideElementAll: hideElementAllAPI,
        getToken: getUserToken,
        REST: restAPI,
        console: consoleSNPlugins,
        isWorkspace: isWorkspacePage
    };

    console.log('[SNPlugins] ServiceNow Helper SDK initialized.');
})();