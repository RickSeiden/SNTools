let plugins = [];
let currentPluginId = null;
let isDirty = false;
let isNewUnsaved = false; // Tracks whether the active plugin has never been saved to storage

let jsCm = null;
let cssCm = null;

// DOM Elements
const pluginList = document.getElementById('pluginList');
const newBtn = document.getElementById('newBtn');
const pluginName = document.getElementById('pluginName');
const pluginIdDisplay = document.getElementById('pluginIdDisplay');
const activeFlag = document.getElementById('activeFlag');
const libraryFlag = document.getElementById('libraryFlag');
const matchPattern = document.getElementById('matchPattern');
const saveBtn = document.getElementById('saveBtn');
const exportSingleBtn = document.getElementById('exportSingleBtn');
const deleteBtn = document.getElementById('deleteBtn');
const statusMsg = document.getElementById('statusMsg');
const statusMsgSidebar = document.getElementById('statusMsgSidebar');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initCodeEditors();

    const data = await chrome.storage.local.get('plugins');
    plugins = data.plugins || [];

    if (plugins.length === 0) {
        createNewPluginDraft();
    } else {
        renderSidebar();
        loadPluginIntoForm(plugins[0].id);
    }
});

// Initialize CodeMirror instances
function initCodeEditors() {
    const commonConfig = {
        theme: 'dracula',
        lineNumbers: true,
        tabSize: 2,
        indentWithTabs: false,
        lineWrapping: true,
        extraKeys: {
            'Ctrl-S': () => saveBtn.click(),
            'Cmd-S': () => saveBtn.click(),
            'Shift-Ctrl-F': (cm) => formatEditorCode(cm),
            'Shift-Cmd-F': (cm) => formatEditorCode(cm),
            'Shift-Alt-F': (cm) => formatEditorCode(cm)
        },
        autoCloseBrackets: true,
        matchBrackets: true,
        foldGutter: true,
        search: true,
        dialog: true,
        gutters: ['CodeMirror-linenumbers', 'CodeMirror-lint-markers', 'CodeMirror-foldgutter'],
        lint: {
            esversion: 11, // Supports async/await, optional chaining (?.), nullish coalescing (??)
            asi: true, // Optional: suppresses missing-semicolon warnings
            delay: 1000
        }
    };

    jsCm = CodeMirror.fromTextArea(document.getElementById('codeEditor'), {
        ...commonConfig,
        mode: 'javascript'
    });

    cssCm = CodeMirror.fromTextArea(document.getElementById('cssEditor'), {
        ...commonConfig,
        mode: 'css'
    });

    // Mark dirty when user types in either editor
    jsCm.on('change', (_instance, changeObj) => {
        if (changeObj.origin !== 'setValue')
            isDirty = true;
    });

    cssCm.on('change', (_instance, changeObj) => {
        if (changeObj.origin !== 'setValue')
            isDirty = true;
    });
}

// beautify
function formatEditorCode(cm) {
    console.log("[SNTools] in formatEditorCode");
    if (cm === jsCm && typeof window.js_beautify !== 'function') return;

    const cursor = cm.getCursor();
    const scrollInfo = cm.getScrollInfo();

    const formatted = window.js_beautify(cm.getValue(), {
        indent_size: 4,
        indent_char: ' ',
        max_preserve_newlines: 2,
        preserve_newlines: true,
        keep_array_indentation: false,
        break_chained_methods: false,
        indent_scripts: 'normal',
        brace_style: 'collapse',
        space_before_conditional: true,
        unescape_strings: false,
        jslint_happy: false,
        end_with_newline: false,
        wrap_line_length: 0,
        indent_empty_lines: false
    });

    cm.setValue(formatted);
    cm.setCursor(cursor);
    cm.scrollTo(scrollInfo.left, scrollInfo.top);
    cm.focus();
}

// Track dirty state on standard inputs
[pluginName, activeFlag, libraryFlag, matchPattern].forEach(el => {
    el.addEventListener('change', () => {
        isDirty = true;
    });
    el.addEventListener('input', () => {
        isDirty = true;
    });
});

// Live ID preview while typing name
pluginName.addEventListener('input', () => {
    pluginIdDisplay.textContent = generateUniqueId(pluginName.value, currentPluginId);
});

// Global Ctrl+S / Cmd+S shortcut outside editors
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveBtn.click();
    }
});

// Handle "+ New" Button
newBtn.addEventListener('click', async () => {
    const canProceed = await handleUnsavedChangesBeforeSwitch();
    if (!canProceed)
        return;
    createNewPluginDraft();
});

// Handle "Save" Button
saveBtn.addEventListener('click', async () => {
    await saveCurrentPlugin();
    showStatus('Saved!');
});

// Handle "Export" (single) Button
exportSingleBtn.addEventListener('click', async () => {
    if (!currentPluginId)
        return;

    const cleanName = pluginName.value.trim() || "Untitled Plugin";
    const exportId = generateUniqueId(cleanName, currentPluginId);

    const singlePlugin = {
        id: exportId,
        name: cleanName,
        active: activeFlag.checked,
        library: libraryFlag.checked,
        matchPattern: matchPattern.value.trim(),
        code: jsCm.getValue(),
        css: cssCm.getValue()
    }

    // Wrap in an array so the existing Import JSON button accepts it seamlessly
    const blob = new Blob([JSON.stringify([singlePlugin], null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `plugin-${exportId}.json`;
    a.click();
    URL.revokeObjectURL(url);
});
// Handle "Delete" Button
deleteBtn.addEventListener('click', async () => {
    if (!currentPluginId)
        return;

    const target = plugins.find(p => p.id === currentPluginId);
    if (!confirm(`Delete "${target?.name || 'this plugin'}"?`))
        return;

    plugins = plugins.filter(p => p.id !== currentPluginId);
    isNewUnsaved = false;
    isDirty = false;

    await chrome.storage.local.set({
        plugins
    });

    if (plugins.length === 0) {
        createNewPluginDraft();
    } else {
        renderSidebar();
        loadPluginIntoForm(plugins[0].id);
    }
});

// --- Export & Import JSON ---

exportBtn.addEventListener('click', () => {
    // Only export saved plugins (exclude unsaved new drafts)
    const savedPlugins = plugins.filter(p => !(p.id === currentPluginId && isNewUnsaved));
    const blob = new Blob([JSON.stringify(savedPlugins, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `plugins-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => {
    importFileInput.click();
});

importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file)
        return;

    try {
        const text = await file.text();
        const imported = JSON.parse(text);

        if (!Array.isArray(imported)) {
            alert('Invalid backup file: expected a JSON array of plugins.');
            return;
        }

        const replaceAll = confirm(
            `Found ${imported.length} plugin(s).\n\nClick OK to MERGE with existing plugins, or Cancel to REPLACE all existing plugins.`);

        if (!replaceAll) {
            plugins = [];
        }

        for (const item of imported) {
            const cleanName = (item.name || 'Imported Plugin').trim();
            const uniqueId = generateUniqueId(cleanName);
            plugins.push({
                id: uniqueId,
                name: cleanName,
                active: item.active !== undefined ? Boolean(item.active) : true,
                library: item.library !== undefined ? Boolean(item.library) : false,
                matchPattern: (item.matchPattern || '').trim(),
                code: item.code || '',
                css: item.css || ''
            });
        }

        isNewUnsaved = false;
        isDirty = false;
        await chrome.storage.local.set({
            plugins
        });

        if (plugins.length > 0) {
            renderSidebar();
            loadPluginIntoForm(plugins[0].id);
        }
        showStatus('Imported!');
    } catch (err) {
        alert('Failed to import JSON: ' + err.message);
    }
    finally {
        importFileInput.value = ''; // Reset input so same file can be re-selected
    }
});

// --- Unsaved State & Draft Cleanup Logic ---

async function handleUnsavedChangesBeforeSwitch() {
    if (!currentPluginId)
        return true;

    if (isDirty) {
        const wantSave = confirm('You have unsaved changes. Click OK to save before switching, or Cancel to discard changes.');
        if (wantSave) {
            await saveCurrentPlugin();
            return true;
        }
    }

    // If user chose Cancel (discard) OR never touched the new draft, prune the unsaved new draft
    if (isNewUnsaved) {
        plugins = plugins.filter(p => p.id !== currentPluginId);
        isNewUnsaved = false;
        isDirty = false;
    }

    return true;
}

// --- ID Generation ---

function generateUniqueId(rawName, excludeId = null) {
    let baseSlug = (rawName || 'untitled-plugin')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    if (!baseSlug)
        baseSlug = 'untitled-plugin';

    let candidateId = baseSlug;
    let counter = 1;
    while (plugins.some(p => p.id === candidateId && p.id !== excludeId)) {
        candidateId = `${baseSlug}-${counter}`;
        counter++;
    }

    return candidateId;
}

// --- Core Form & Sidebar Logic ---

function createNewPluginDraft() {
    const defaultName = 'Untitled Plugin';
    const id = generateUniqueId(defaultName);

    const newPlugin = {
        id,
        name: defaultName,
        active: true,
        library: false,
        matchPattern: 'service-now.com',
        code: 'SNTools.onRouteChange(async () => {\n  const record = SNTools.getRecord();\n  if (!record || record.isWorkspace) return;\n\n});',
        css: ''
    };

    plugins.push(newPlugin);
    isNewUnsaved = true;
    renderSidebar();
    loadPluginIntoForm(newPlugin.id, true);
}

function renderSidebar() {
    pluginList.innerHTML = '';

    plugins.forEach(plugin => {
        const li = document.createElement('li');
        li.className = 'plugin-item' + (plugin.id === currentPluginId ? ' selected' : '');

        const dotClass = plugin.active ? 'dot-active' : 'dot-inactive';
        const unsavedTag = (plugin.id === currentPluginId && isNewUnsaved) ? ' (draft)' : '';
        let displayName = plugin.name;
        if (plugin.library) {
            displayName = "[LIBRARY] " + displayName;
        }
        li.innerHTML = `
      <span class="${dotClass}">●</span>
      <div class="plugin-item-meta">
        <span class="plugin-item-name">${escapeHtml(displayName || 'Untitled')}${unsavedTag}</span>
        <span class="plugin-item-id">${escapeHtml(plugin.id)}</span>
      </div>
    `;

        li.addEventListener('click', async () => {
            if (plugin.id === currentPluginId)
                return;

            const canProceed = await handleUnsavedChangesBeforeSwitch();
            if (!canProceed)
                return;

            loadPluginIntoForm(plugin.id);
        });

        pluginList.appendChild(li);
    });
}

function loadPluginIntoForm(id, keepUnsavedFlag = false) {
    const plugin = plugins.find(p => p.id === id);
    if (!plugin)
        return;

    currentPluginId = plugin.id;
    if (!keepUnsavedFlag)
        isNewUnsaved = false;

    pluginName.value = plugin.name || '';
    pluginIdDisplay.textContent = plugin.id;
    activeFlag.checked = Boolean(plugin.active);
    libraryFlag.checked = Boolean(plugin.library);
    matchPattern.value = plugin.matchPattern || '';

    // setValue with origin 'setValue' avoids falsely triggering the dirty flag
    jsCm.setValue(plugin.code || '');
    cssCm.setValue(plugin.css || '');

    isDirty = false;
    renderSidebar();
}

async function saveCurrentPlugin() {
    if (!currentPluginId)
        return;

    const index = plugins.findIndex(p => p.id === currentPluginId);
    if (index === -1)
        return;

    const cleanName = pluginName.value.trim() || 'Untitled Plugin';
    const newId = generateUniqueId(cleanName, currentPluginId);

    plugins[index] = {
        id: newId,
        name: cleanName,
        active: activeFlag.checked,
        library: libraryFlag.checked,
        matchPattern: matchPattern.value.trim(),
        code: jsCm.getValue(),
        css: cssCm.getValue()
    };

    currentPluginId = newId;
    pluginIdDisplay.textContent = newId;
    isNewUnsaved = false;
    isDirty = false;

    await chrome.storage.local.set({
        plugins
    });
    renderSidebar();
}

function showStatus(text) {
    statusMsg.textContent = text;
    statusMsg.classList.add('show');
    setTimeout(() => statusMsg.classList.remove('show'), 1500);

    statusMsgSidebar.textContent = text;
    statusMsgSidebar.classList.add('show');
    setTimeout(() => statusMsgSidebar.classList.remove('show'), 1500);
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[m]);
}
