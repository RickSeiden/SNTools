chrome.tabs.onUpdated.addListener(async(tabId, changeInfo, tab) => {
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
    const matchingPlugins = plugins.filter(
            (p) => p.active && p.matchPattern && tab.url.includes(p.matchPattern));

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

    // 2. Inject matching plugins now that window.SNTools is ready
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
                target: {
                    tabId
                },
                world: 'MAIN',
                func: (codeString, cssString, pluginId, pluginName) => {
                    try {
                        // Expose PLUGIN_CSS and PLUGIN_ID as local variables inside the plugin
                        const fn = new Function('PLUGIN_CSS', 'PLUGIN_ID', codeString);
                        fn(cssString || '', pluginId);
                    } catch (err) {
                        console.error(`[Plugin Error: ${pluginName}]`, err);
                    }
                },
                args: [plugin.code, plugin.css, plugin.id, plugin.name]
            });
        }
    }
});
