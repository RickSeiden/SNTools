# SNTools

The `SNTools` API is the central structure used to build ServiceNow plugins across Classic UI16 and Next Experience (Workspace).

---

## SNTools.query(selector, [root])

Searches for the first element matching a CSS selector, traversing Shadow DOM boundaries and same-origin `<iframe>` elements (such as `iframe#gsft_main`).

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector to match against elements. |
| `root` | Document \| ShadowRoot \| Element | Optional starting root node (defaults to `document`). |

### Returns
| Type | Description |
| :--- | :--- |
| Element \| null | The first matching DOM `Element`, or `null` if no match is found. |

### Example
```javascript
const saveBtn = SNTools.query('button[data-action="save"]');
```
This immediately searches the current document, Shadow DOMs, and accessible iframes for the matching button without waiting.

---

## SNTools.queryAll(selector, [root], [results])

Searches for all elements matching a CSS selector across the DOM, Shadow DOMs, and same-origin `<iframe>` elements.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector to match against elements. |
| `root` | Document \| ShadowRoot \| Element | Optional starting root node (defaults to `document`). |
| `results` | Array | Optional array to append matched elements into. |

### Returns
| Type | Description |
| :--- | :--- |
| Array\<Element\> | An array of all matching DOM `Element` nodes. |

### Example
```javascript
const labels = SNTools.queryAll('span.sn-chrome-one-tab-label');
```
This collects all matching tab label spans across Workspace Shadow DOMs and frames.

---

## await SNTools.waitFor(selector, [timeoutMs])

Asynchronous function that polls for an element matching `selector` (across Shadow DOMs and same-origin iframes) until it appears or the timeout expires.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector representing the target element. |
| `timeoutMs` | Number | Optional timeout in milliseconds before rejecting (defaults to `10000`). |

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Element\> | Resolves to the matching DOM `Element` once found. |

If the element is not found within `timeoutMs`, `SNTools.waitFor` rejects with an `Error` (`[SNTools] Timed out waiting for: <selector>`).

### Example
```javascript
SNTools.onRouteChange(async () => {
    try {
        const record = SNTools.getRecord();
        if (!record || record.isWorkspace) return;

        const numberLabel = await SNTools.waitFor(`#label\\.${record.table}\\.number`);
        SNTools.console('Found label: ' + numberLabel.textContent);
    } catch (e) {
        SNTools.console(e.message, 'error');
    }
});
```
This waits for the Number field label on a classic form to render and logs its text.

---

## SNTools.getRecord()

Extracts the current record context (`table`, `sysId`, and `isWorkspace`) from `location.href`, supporting both Workspace `/record/` routes and Classic UI16 `.do` URLs (including percent-encoded URLs).

### Parameters
This method takes no parameters.

### Returns
| Type | Description |
| :--- | :--- |
| Object \| null | An object `{ table, sysId, isWorkspace }`, or `null` if the current URL does not represent a record. |

### Example
```javascript
const record = SNTools.getRecord();
if (record?.table === 'incident') {
    SNTools.console(`Viewing incident ${record.sysId}`);
}
```
This checks whether the user is currently on an `incident` record.

---

## SNTools.injectShadowCSS(hostOrShadowRoot, cssText, [styleId])

Injects a `<style>` element into a host element's `shadowRoot` (or directly into a `ShadowRoot` / root node) if a style element with `styleId` is not already present there.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `hostOrShadowRoot` | Element \| ShadowRoot | Host element whose `shadowRoot` will receive the style, or a `ShadowRoot` directly. |
| `cssText` | String | Raw CSS rules to inject. |
| `styleId` | String | Optional unique `id` to prevent duplicate injection in the same root (defaults to `'sn-plugin-style'`). |

### Returns
| Type | Description |
| :--- | :--- |
| undefined | Does not return a value. |

### Example
```javascript
const host = await SNTools.waitFor('sn-canvas-component');
SNTools.injectShadowCSS(host, '.custom-badge { color: green; }', 'my-badge-css');
```
This injects custom CSS into the target component's Shadow DOM once.

---

## SNTools.getWaitFor(el)

Inspects a DOM `Element` (such as `$0` in DevTools) and builds a candidate CSS selector string, logging a ready-to-use `SNTools.waitFor(...)` snippet to the console.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `el` | Element | A valid DOM element (`el.nodeType === 1`). |

### Returns
| Type | Description |
| :--- | :--- |
| String \| null | The generated CSS selector string, or `null` if `el` is not a valid element. |

### Example
```javascript
const selector = SNTools.getWaitFor($0);
```
This generates and logs a selector for the currently inspected element in browser DevTools.

---

## await SNTools.insertElement(selector, [config], [position])

Waits for `selector` to appear, creates a new DOM element according to `config`, and inserts it relative to the target element using `position` (`'insideAfter'`, `'insideBefore'`, `'before'`, or `'after'`).

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector for the target reference element. |
| `config` | Object | Optional configuration object defining the element to create and how to place it (see **Config Object Properties** below). |
| `position` | String | Insertion position: `'insideAfter'` (default), `'insideBefore'`, `'before'`, or `'after'`. |

### Config Object Properties
* `tag` (`String`): HTML tag name to create (defaults to `'button'` when `config.type === 'button'`, otherwise `'div'`).
* `type` (`String`): Sets `el.type` (e.g., `'button'`).
* `id` (`String`): Sets `el.id` and guards against duplicate IDs within the target's root (`Document` or `ShadowRoot`).
* `className` / `classname` (`String`): Sets `el.className`.
* `text` / `textContent` / `textContext` (`String`): Sets `el.textContent` when defined.
* `html` (`String`): Sets `el.innerHTML` when defined.
* `title` (`String`): Sets `el.title`.
* `style` (`Object`): Key/value style map applied via `Object.assign(el.style, config.style)` (e.g., `{ marginLeft: '8px' }`).
* `attrs` (`Object`): Key/value attribute map applied via `el.setAttribute(key, val)` (e.g., `{ 'data-action': 'copy' }`).
* `on<Event>` (`Function`): Any property starting with `'on'` with a function value is attached as `el[key.toLowerCase()] = val` (e.g., `onclick`, `onchange`).
* `flexParent` (`Boolean`): When truthy on `'insideAfter'` or `'insideBefore'`, sets `display: 'flex'` and `alignItems: 'center'` on the target element.
* `gap` (`String`): Sets `target.style.gap` when `flexParent` is enabled (defaults to `'6px'`).
* `timeout` (`Number`): Wait timeout in milliseconds passed to `waitFor` (defaults to `10000`).

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Element \| null\> | Resolves to the created DOM `Element`, an existing element with the same `id` in that root, or `null` if the target was not found. |

### Example
```javascript
await SNTools.insertElement('#action-bar', {
    id: 'sn-tools-ping-btn',
    type: 'button',
    text: 'Ping',
    onclick: () => SNTools.console('Pong!')
}, 'insideAfter');
```
This waits for `#action-bar` and appends a `Ping` button inside the end of it.

---

## await SNTools.addInsideAfter(selector, [config])

Convenience wrapper around `SNTools.insertElement(selector, config, 'insideAfter')` that appends a new element as the last child inside the target element.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector for the target container element. |
| `config` | Object | Optional configuration object describing the new element (see **Config Object Properties** under `SNTools.insertElement`). |

### Config Object Properties
* `tag` (`String`): HTML tag name to create (defaults to `'button'` when `config.type === 'button'`, otherwise `'div'`).
* `type` (`String`): Sets `el.type` (e.g., `'button'`).
* `id` (`String`): Sets `el.id` and guards against duplicate IDs within the target's root (`Document` or `ShadowRoot`).
* `className` / `classname` (`String`): Sets `el.className`.
* `text` / `textContent` / `textContext` (`String`): Sets `el.textContent` when defined.
* `html` (`String`): Sets `el.innerHTML` when defined.
* `title` (`String`): Sets `el.title`.
* `style` (`Object`): Key/value style map applied via `Object.assign(el.style, config.style)` (e.g., `{ marginLeft: '8px' }`).
* `attrs` (`Object`): Key/value attribute map applied via `el.setAttribute(key, val)` (e.g., `{ 'data-action': 'copy' }`).
* `on<Event>` (`Function`): Any property starting with `'on'` with a function value is attached as `el[key.toLowerCase()] = val` (e.g., `onclick`, `onchange`).
* `flexParent` (`Boolean`): When truthy on `'insideAfter'` or `'insideBefore'`, sets `display: 'flex'` and `alignItems: 'center'` on the target element.
* `gap` (`String`): Sets `target.style.gap` when `flexParent` is enabled (defaults to `'6px'`).
* `timeout` (`Number`): Wait timeout in milliseconds passed to `waitFor` (defaults to `10000`).

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Element \| null\> | Resolves to the inserted DOM `Element`, an existing matching `id` element, or `null` if not found. |

### Example
```javascript
await SNTools.addInsideAfter('#label\\.incident\\.number', {
    tag: 'span',
    text: ' *',
    style: { color: 'red' }
});
```
This appends a red asterisk span inside the end of the Incident Number label.

---

## await SNTools.addInsideBefore(selector, [config])

Convenience wrapper around `SNTools.insertElement(selector, config, 'insideBefore')` that prepends a new element as the first child inside the target element.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector for the target container element. |
| `config` | Object | Optional configuration object describing the new element (see **Config Object Properties** under `SNTools.insertElement`). |

### Config Object Properties
* `tag` (`String`): HTML tag name to create (defaults to `'button'` when `config.type === 'button'`, otherwise `'div'`).
* `type` (`String`): Sets `el.type` (e.g., `'button'`).
* `id` (`String`): Sets `el.id` and guards against duplicate IDs within the target's root (`Document` or `ShadowRoot`).
* `className` / `classname` (`String`): Sets `el.className`.
* `text` / `textContent` / `textContext` (`String`): Sets `el.textContent` when defined.
* `html` (`String`): Sets `el.innerHTML` when defined.
* `title` (`String`): Sets `el.title`.
* `style` (`Object`): Key/value style map applied via `Object.assign(el.style, config.style)` (e.g., `{ marginLeft: '8px' }`).
* `attrs` (`Object`): Key/value attribute map applied via `el.setAttribute(key, val)` (e.g., `{ 'data-action': 'copy' }`).
* `on<Event>` (`Function`): Any property starting with `'on'` with a function value is attached as `el[key.toLowerCase()] = val` (e.g., `onclick`, `onchange`).
* `flexParent` (`Boolean`): When truthy on `'insideAfter'` or `'insideBefore'`, sets `display: 'flex'` and `alignItems: 'center'` on the target element.
* `gap` (`String`): Sets `target.style.gap` when `flexParent` is enabled (defaults to `'6px'`).
* `timeout` (`Number`): Wait timeout in milliseconds passed to `waitFor` (defaults to `10000`).

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Element \| null\> | Resolves to the inserted DOM `Element`, an existing matching `id` element, or `null` if not found. |

### Example
```javascript
await SNTools.addInsideBefore('.toolbar', {
    id: 'sn-tools-prefix',
    text: '[Tools]'
});
```
This prepends a `[Tools]` element at the start of `.toolbar`.

---

## await SNTools.addBefore(selector, [config])

Convenience wrapper around `SNTools.insertElement(selector, config, 'before')` that inserts a new sibling element immediately before the target element.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector for the target sibling element. |
| `config` | Object | Optional configuration object describing the new element (see **Config Object Properties** under `SNTools.insertElement`). |

### Config Object Properties
* `tag` (`String`): HTML tag name to create (defaults to `'button'` when `config.type === 'button'`, otherwise `'div'`).
* `type` (`String`): Sets `el.type` (e.g., `'button'`).
* `id` (`String`): Sets `el.id` and guards against duplicate IDs within the target's root (`Document` or `ShadowRoot`).
* `className` / `classname` (`String`): Sets `el.className`.
* `text` / `textContent` / `textContext` (`String`): Sets `el.textContent` when defined.
* `html` (`String`): Sets `el.innerHTML` when defined.
* `title` (`String`): Sets `el.title`.
* `style` (`Object`): Key/value style map applied via `Object.assign(el.style, config.style)` (e.g., `{ marginLeft: '8px' }`).
* `attrs` (`Object`): Key/value attribute map applied via `el.setAttribute(key, val)` (e.g., `{ 'data-action': 'copy' }`).
* `on<Event>` (`Function`): Any property starting with `'on'` with a function value is attached as `el[key.toLowerCase()] = val` (e.g., `onclick`, `onchange`).
* `flexParent` (`Boolean`): When truthy on `'insideAfter'` or `'insideBefore'`, sets `display: 'flex'` and `alignItems: 'center'` on the target element.
* `gap` (`String`): Sets `target.style.gap` when `flexParent` is enabled (defaults to `'6px'`).
* `timeout` (`Number`): Wait timeout in milliseconds passed to `waitFor` (defaults to `10000`).

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Element \| null\> | Resolves to the inserted DOM `Element`, an existing matching `id` element, or `null` if not found. |

### Example
```javascript
await SNTools.addBefore('#submit_btn', {
    type: 'button',
    text: 'Preview',
    onclick: () => SNTools.console('Preview clicked')
});
```
This places a `Preview` button immediately before `#submit_btn`.

---

## await SNTools.addAfter(selector, [config])

Convenience wrapper around `SNTools.insertElement(selector, config, 'after')` that inserts a new sibling element immediately after the target element.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector for the target sibling element. |
| `config` | Object | Optional configuration object describing the new element (see **Config Object Properties** under `SNTools.insertElement`). |

### Config Object Properties
* `tag` (`String`): HTML tag name to create (defaults to `'button'` when `config.type === 'button'`, otherwise `'div'`).
* `type` (`String`): Sets `el.type` (e.g., `'button'`).
* `id` (`String`): Sets `el.id` and guards against duplicate IDs within the target's root (`Document` or `ShadowRoot`).
* `className` / `classname` (`String`): Sets `el.className`.
* `text` / `textContent` / `textContext` (`String`): Sets `el.textContent` when defined.
* `html` (`String`): Sets `el.innerHTML` when defined.
* `title` (`String`): Sets `el.title`.
* `style` (`Object`): Key/value style map applied via `Object.assign(el.style, config.style)` (e.g., `{ marginLeft: '8px' }`).
* `attrs` (`Object`): Key/value attribute map applied via `el.setAttribute(key, val)` (e.g., `{ 'data-action': 'copy' }`).
* `on<Event>` (`Function`): Any property starting with `'on'` with a function value is attached as `el[key.toLowerCase()] = val` (e.g., `onclick`, `onchange`).
* `flexParent` (`Boolean`): When truthy on `'insideAfter'` or `'insideBefore'`, sets `display: 'flex'` and `alignItems: 'center'` on the target element.
* `gap` (`String`): Sets `target.style.gap` when `flexParent` is enabled (defaults to `'6px'`).
* `timeout` (`Number`): Wait timeout in milliseconds passed to `waitFor` (defaults to `10000`).

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Element \| null\> | Resolves to the inserted DOM `Element`, an existing matching `id` element, or `null` if not found. |

### Example
```javascript
await SNTools.addAfter('#incident\\.short_description', {
    tag: 'div',
    text: 'Keep concise (< 160 chars)',
    className: 'help-hint'
});
```
This inserts a helper element immediately after `#incident.short_description`.

---

## SNTools.onRouteChange(callback, [runImmediately])

Registers a listener function to be invoked when SPA navigation occurs (`history.pushState`, `history.replaceState`, or `popstate`), with a 300ms delay after URL changes.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `callback` | Function | Function called with `(location.href)` on route change. |
| `runImmediately` | Boolean | Whether to invoke `callback(location.href)` immediately upon registration (defaults to `true`). |

### Returns
| Type | Description |
| :--- | :--- |
| Function | An unsubscribe function that removes `callback` from `routeListeners` when called. |

### Example
```javascript
const unsubscribe = SNTools.onRouteChange((url) => {
    SNTools.console('Navigated to: ' + url);
});
```
This runs the callback right away and again whenever the URL changes in the SPA.

---

## SNTools.g_form()

Retrieves ServiceNow's `g_form` client API object from the current window or from `iframe#gsft_main` (including across Shadow DOMs).

### Parameters
This method takes no parameters.

### Returns
| Type | Description |
| :--- | :--- |
| Object \| null | The `g_form` API object if available, or `null` otherwise. |

### Example
```javascript
const gForm = SNTools.g_form();
if (gForm) {
    SNTools.console('Current number: ' + gForm.getValue('number'));
}
```
This reads the `number` field value via `g_form` when available.

---

## await SNTools.waitForLoaded([timeout])

Asynchronous helper that waits until `document.readyState === 'complete'` and, if present, `iframe#gsft_main` is also loaded (and not `about:blank`), or until `document.body` has children on non-framed pages.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `timeout` | Number | Optional timeout in milliseconds before rejecting (defaults to `15000`). |

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<{ window: Window, document: Document }\> | Resolves with the active `window` and `document` (the `gsft_main` frame's window/document when present). |

If loading does not complete within `timeout`, it rejects with an `Error` (`[SNTools] Timed out waiting for page to finish loading.`).

### Example
```javascript
const { document: targetDoc } = await SNTools.waitForLoaded();
SNTools.console('Ready in: ' + targetDoc.title);
```
This waits for the page and `gsft_main` (if present) to finish loading before reading `targetDoc.title`.

---

## await SNTools.hideElement(selector, [timeout])

Waits for the element matching `selector` and sets `target.style.display = "none"`.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `selector` | String | CSS selector for the element to hide. |
| `timeout` | Number | Optional wait timeout in milliseconds (defaults to `10000`). |

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<undefined \| null\> | Resolves after hiding the element, or `null` if the target element is not found. |

### Example
```javascript
await SNTools.hideElement('.promo-banner');
```
This waits for `.promo-banner` and hides it from view.

---

## await SNTools.getToken()

Retrieves and caches the ServiceNow session token (`g_ck`) from `window.g_ck`, `window.NOW.g_ck`, `iframe#gsft_main`, previously cached state, inline `<script>` tags, or a fallback fetch to `/nav_to.do`.

### Parameters
This method takes no parameters.

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<String \| null\> | Resolves to the `g_ck` token string, or `null` if it cannot be found. |

### Example
```javascript
const token = await SNTools.getToken();
```
This resolves the session token needed for authenticated ServiceNow requests.

---

## await SNTools.REST(url, [options])

Performs an authenticated ServiceNow REST API request using `fetch` with `X-UserToken` and `credentials: 'same-origin'`.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `url` | String | Relative path (e.g., `'/api/now/table/incident'`) or full URL. |
| `options` | Object | Optional request options (`method`, `headers`, `body`); only `GET` requests are permitted. |

### Returns
| Type | Description |
| :--- | :--- |
| Promise\<Object \| String \| null\> | Resolves to parsed JSON, response text, or `null` for HTTP `204`. |

Throws an `Error` if a non-`GET` method is passed, if `g_ck` cannot be retrieved, or if the HTTP response is not `ok` (`!response.ok`).

### Example
```javascript
const data = await SNTools.REST('/api/now/table/incident?sysparm_limit=5');
SNTools.console('Count: ' + (data.result?.length || 0));
```
This queries up to five incident records via the Table API.

---

## SNTools.console(message, [level])

Logs a prefixed `[SNTools]` message to the browser console using `console.log`, `console.info`, or `console.error`.

### Parameters
| Name | Type | Description |
| :--- | :--- | :--- |
| `message` | String | Message to log; if falsy, nothing is logged. |
| `level` | String | Optional log level: `'log'` (default), `'info'`, or `'error'`. |

### Returns
| Type | Description |
| :--- | :--- |
| undefined | Does not return a value. |

### Example
```javascript
SNTools.console('Plugin initialized', 'info');
```
This writes an informational `[SNTools]` message to the console.