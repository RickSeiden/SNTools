// function matchesUrl(url, rawPattern) {
// if (!rawPattern || !rawPattern.trim()) return false;

// // 1. Check if the entire pattern is wrapped in /regex/flags (e.g. /incident|problem/i)
// const regexLiteral = rawPattern.trim().match(/^\/(.+)\/([gimsuy]*)$/);
// if (regexLiteral) {
// try {
// return new RegExp(regexLiteral[1], regexLiteral[2]).test(url);
// } catch (err) {
// console.warn('[Plugin Container] Invalid regex pattern:', rawPattern, err);
// return false;
// }
// }


// // 2. Otherwise, split by commas to allow multiple patterns (supports * wildcards)
// const patterns = rawPattern
// .split(',')
// .map((p) => p.trim())
// .filter(Boolean);

// return patterns.some((pattern) => {
// const itemRegex = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
// if (itemRegex) {
// try {
// return new RegExp(itemRegex[1], itemRegex[2]).test(url);
// } catch {
// return false;
// }
// }

// if (pattern.includes('*')) {
// const escaped = pattern
// .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
// .replace(/\*/g, '.*');
// return new RegExp(escaped, 'i').test(url);
// }

// return url.toLowerCase().includes(pattern.toLowerCase());
// });
// }

function matchesUrl(url, matchString) {
  if (!matchString || !matchString.trim()) return true;

  // Split by comma for OR groups, and '+' for AND conditions within a group
  // Example: "service-now.com + incident.do, service-now.com + problem.do"
  const orGroups = matchString.split(',').map(s => s.trim()).filter(Boolean);

  return orGroups.some(group => {
    const andTerms = group.split('+').map(s => s.trim()).filter(Boolean);
    return andTerms.every(term => url.includes(term));
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.url)
    return;

  const {
    extensionActive = true,
    plugins = []
  } = await chrome.storage.local.get([
    'extensionActive',
    'plugins'
  ]);

  if (!extensionActive)
    return;

  // Filter plugins that match this tab's URL
  const matchingPlugins = plugins
    .filter((p) => p.active && matchesUrl(tab.url, p.matchPattern))
    .sort((a, b) => Number(Boolean(b.library)) - Number(Boolean(a.library)));

  if (matchingPlugins.length === 0)
    return;

  // 1. Inject the global SDK first (only if on ServiceNow, or inject globally)
  if (tab.url.includes('service-now.com') || tab.url.includes('servicenowservices.com')) {
    await chrome.scripting.executeScript({
      target: {
        tabId
      },
      world: 'MAIN',
      files: ['sn-sdk.js']
    });
  }

  // 2. Inject matching plugins now that window.SNPlugins is ready
  for (const plugin of matchingPlugins) {
    // Still inject into top-level document (for Classic UI16 or document.body overlays)
    if (plugin.css) {
      await chrome.scripting.insertCSS({
        target: {
          tabId
        },
        css: plugin.css
      });
    }

    if (plugin.code) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: (codeString, cssString, pluginId, pluginName) => {
          try {
            if (cssString && window.SNPlugins?._registerPluginCSS) {
              window.SNPlugins._registerPluginCSS(pluginId, cssString);
            }
            const fn = new Function('PLUGIN_CSS', 'PLUGIN_ID', codeString);
            fn(cssString || '', pluginId);
          } catch (err) {
            console.error(`[SNPlugins] Plugin Error: ${pluginName}`, err);
          }
        },
        args: [plugin.code, plugin.css, plugin.id, plugin.name]
      });
    }
  }
});
