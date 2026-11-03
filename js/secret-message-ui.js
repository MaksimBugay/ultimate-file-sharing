(() => {
    'use strict';
    const ui = {
        secretForm: document.getElementById('secretForm'),
        showHelp: document.getElementById('showHelp'),
        helpDialog: document.getElementById('helpDialog'),
        closeHelp: document.getElementById('closeHelp'),
        securityBadge: document.getElementById('securityBadge'),
        status: document.getElementById('status'),
        workspace: document.getElementById('workspace'),
        generateWorkspace: document.getElementById('generateWorkspace'),
        togglePassword: document.getElementById('togglePassword'),
        password: document.getElementById('password'),
        settingsPanel: document.getElementById('settingsPanel'),
        toggleSettings: document.getElementById('toggleSettings'),
        workspaceLayout: document.getElementById('workspaceLayout'),
        inputCount: document.getElementById('inputCount'),
        messageInput: document.getElementById('messageInput'),
        conversationDetails: document.getElementById('conversationDetails'),
        saveSettings: document.getElementById('saveSettings'),
        importSettings: document.getElementById('importSettings'),
        exportSettings: document.getElementById('exportSettings'),
        settingsFile: document.getElementById('settingsFile'),
        topic: document.getElementById('topic'),
        topicPreset: document.getElementById('topicPreset'),
        style: document.getElementById('style'),
        stylePreset: document.getElementById('stylePreset'),
        locale: document.getElementById('locale'),
        inputLabel: document.getElementById('inputLabel'),
        outputLabel: document.getElementById('outputLabel'),
        appendToHistory: document.getElementById('appendToHistory'),
        appendToHistoryControl: document.getElementById('appendToHistoryControl'),
        messageOutput: document.getElementById('messageOutput'),
        outputHint: document.getElementById('outputHint'),
        runButton: document.getElementById('runButton'),
        copyOutput: document.getElementById('copyOutput'),
        clearInput: document.getElementById('clearInput'),
        ownerSignature: document.getElementById('ownerSignature'),
        retrieveOwnerSignature: document.getElementById('retrieveOwnerSignature'),
        historyCount: document.getElementById('historyCount'),
        historyRows: document.getElementById('historyRows'),
        newHistoryMessage: document.getElementById('newHistoryMessage'),
        emptyHistory: document.getElementById('emptyHistory'),
        clearHistory: document.getElementById('clearHistory'),
        editHistory: document.getElementById('editHistory'),
        historyDialog: document.getElementById('historyDialog'),
        appendHistory: document.getElementById('appendHistory'),
        historyStatus: document.getElementById('historyStatus'),
        closeHistory: document.getElementById('closeHistory'),
        doneHistory: document.getElementById('doneHistory')
    };
    const form = ui.secretForm;
    const history = [];
    ui.showHelp.addEventListener('click', () => ui.helpDialog.showModal());
    ui.closeHelp.addEventListener('click', () => ui.helpDialog.close());
    let busy = true;
    const mode = () => form.elements.mode.value;
    const status = (message, error = false) => {
        ui.securityBadge.hidden = Boolean(message);
        ui.status.hidden = !message;
        ui.status.textContent = message;
        ui.status.dataset.error = String(error);
    };
    const conversationStorageKey = `secret-message.conversationDetails.v1:${window.location.pathname}`;
    function readConversationDetails(details) {
        if (!details || typeof details !== 'object' || Array.isArray(details) ||
            typeof details.topic !== 'string' || typeof details.style !== 'string' || !Array.isArray(details.history)) {
            throw new Error('Choose a conversation JSON file containing topic, style and history.');
        }
        const normalized = normalizePublicConversationDetails(details);
        return {topic: details.topic, style: details.style, history: [...details.history], locale: normalized.locale};
    }
    function currentConversationDetails() {
        return readConversationDetails({topic: ui.topic.value, style: ui.style.value, history, locale: ui.locale.value});
    }
    function applyConversationDetails(details) {
        const validated = readConversationDetails(details);
        ui.topic.value = validated.topic;
        ui.style.value = validated.style;
        if (![...ui.locale.options].some(option => option.value === validated.locale)) {
            const option = document.createElement('option');
            option.value = validated.locale;
            const name = new Intl.DisplayNames(['en'], {type: 'language'}).of(validated.locale);
            option.textContent = `${name} (${validated.locale})`;
            ui.locale.append(option);
        }
        ui.locale.value = validated.locale;
        history.splice(0, history.length, ...validated.history);
        renderHistory();
    }
    function readSettings(settings) {
        if (!settings || settings.version !== 1 || typeof settings.workspaceId !== 'string' ||
            !settings.workspaceId.trim() || settings.workspaceId.length > 100 ||
            typeof settings.password !== 'string' || typeof settings.ownerSignature !== 'string' ||
            settings.ownerSignature.length > 200 ||
            (settings.appendToHistory !== undefined && typeof settings.appendToHistory !== 'boolean')) {
            throw new Error('Choose a valid obfuscation settings JSON file.');
        }
        return {version: 1, workspaceId: settings.workspaceId, password: settings.password,
            ownerSignature: settings.ownerSignature, appendToHistory: settings.appendToHistory ?? true,
            publicConversationDetails: readConversationDetails(settings.publicConversationDetails)};
    }
    function currentSettings() {
        return readSettings({version: 1, workspaceId: ui.workspace.value, password: ui.password.value,
            ownerSignature: ui.ownerSignature.value, appendToHistory: ui.appendToHistory.checked,
            publicConversationDetails: currentConversationDetails()});
    }
    function applySettings(settings) {
        const validated = readSettings(settings);
        ui.workspace.value = validated.workspaceId;
        ui.password.value = validated.password;
        ui.password.type = 'password';
        ui.togglePassword.setAttribute('aria-pressed', 'false');
        ui.togglePassword.setAttribute('aria-label', 'Show password');
        ui.togglePassword.title = 'Show password';
        ui.ownerSignature.value = validated.ownerSignature;
        ui.appendToHistory.checked = validated.appendToHistory;
        applyConversationDetails(validated.publicConversationDetails);
    }
    for (const [input, picker] of [[ui.topic, ui.topicPreset], [ui.style, ui.stylePreset]]) {
        picker.addEventListener('change', () => {
            if (!picker.value) return;
            input.value = picker.value;
            picker.value = '';
            input.dispatchEvent(new Event('input', {bubbles: true}));
        });
    }
    ui.locale.addEventListener('change', () => { if (!ui.locale.value) ui.locale.value = 'en'; });
    ui.saveSettings.addEventListener('click', async () => {
        ui.saveSettings.disabled = true;
        try {
            await SecretMessageSettingsStore.save(window.location.pathname, currentSettings());
            status('Obfuscation settings saved securely in this browser.');
        } catch (error) { status(error.message || 'Unable to save obfuscation settings in this browser.', true); }
        finally { ui.saveSettings.disabled = busy; }
    });
    async function writeSettingsFile(handle, json) {
        const writable = await handle.createWritable();
        try { await writable.write(json); await writable.close(); }
        catch (error) { await writable.abort().catch(() => {}); throw error; }
    }
    async function readSettingsFile(file) {
        if (file.size > 64 * 1024) throw new Error('Choose a settings JSON file smaller than 64 KiB.');
        return JSON.parse(await file.text());
    }
    // These button names follow this page's requested import/export mapping.
    ui.importSettings.addEventListener('click', async () => {
        try {
            const json = JSON.stringify(currentSettings(), null, 2);
            const showSaveFilePicker = Reflect.get(window, 'showSaveFilePicker');
            if (typeof showSaveFilePicker === 'function') {
                const handle = await showSaveFilePicker.call(window, {
                    suggestedName: 'obfuscation-settings.json',
                    types: [{description: 'Obfuscation settings JSON', accept: {'application/json': ['.json']}}]
                });
                await writeSettingsFile(handle, json);
            } else {
                const url = URL.createObjectURL(new Blob([json], {type: 'application/json'}));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'obfuscation-settings.json';
                document.body.append(link);
                link.click();
                link.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
            status('Obfuscation settings JSON file saved.');
        } catch (error) {
            if (error.name !== 'AbortError') status(error.message || 'Unable to save the JSON file.', true);
        }
    });
    ui.exportSettings.addEventListener('click', () => ui.settingsFile.click());
    ui.settingsFile.addEventListener('change', async () => {
        const file = ui.settingsFile.files[0];
        if (!file) return;
        ui.exportSettings.disabled = true;
        try {
            const data = await readSettingsFile(file);
            if (data && Object.hasOwn(data, 'workspaceId')) applySettings(data);
            else applyConversationDetails(data); // Support previously saved conversation-only files.
            status('Obfuscation settings loaded. Select Save to remember them in this browser.');
        } catch (error) {
            status(error instanceof SyntaxError ? 'The selected file is not valid JSON.' : error.message, true);
        } finally {
            ui.settingsFile.value = '';
            ui.exportSettings.disabled = busy;
        }
    });
    function generateWorkspace() {
        const previous = ui.workspace.value;
        let workspace;
        do {
            const bytes = crypto.getRandomValues(new Uint8Array(9));
            workspace = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
        } while (workspace === previous);
        ui.workspace.value = workspace;
    }
    if (!ui.workspace.value) generateWorkspace();
    ui.generateWorkspace.addEventListener('click', () => {
        generateWorkspace();
        ui.workspace.focus();
        ui.workspace.select();
        status('New workspace generated.');
    });
    ui.retrieveOwnerSignature.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        const controls = [...form.querySelectorAll('input, button, textarea, select')];
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        form.setAttribute('aria-busy', 'true');
        status('Retrieving owner signature…');
        try {
            const signature = await getDeviceSecret();
            if (typeof signature !== 'string' || !signature) {
                status('Unable to retrieve this browser’s fingerprint.', true);
                return;
            }
            ui.ownerSignature.value = signature;
            ui.ownerSignature.dispatchEvent(new Event('input', {bubbles: true}));
            status('Owner signature retrieved for this browser.');
        } catch (error) { status(error.message || 'Unable to retrieve this browser’s fingerprint.', true); }
        finally {
            busy = false;
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
            form.setAttribute('aria-busy', 'false');
        }
    });
    ui.togglePassword.addEventListener('click', () => {
        const show = ui.password.type === 'password';
        ui.password.type = show ? 'text' : 'password';
        ui.togglePassword.setAttribute('aria-pressed', String(show));
        ui.togglePassword.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        ui.togglePassword.title = show ? 'Hide password' : 'Show password';
    });
    function setPanel(open) {
        ui.settingsPanel.hidden = !open;
        ui.toggleSettings.setAttribute('aria-expanded', String(open));
        ui.workspaceLayout.classList.toggle('settings-collapsed', !open);
    }
    setPanel(!window.matchMedia('(max-width: 720px)').matches);
    ui.toggleSettings.addEventListener('click', () => setPanel(ui.settingsPanel.hidden));
    // Reveal invalid required fields even when the sidebar is collapsed.
    form.addEventListener('invalid', event => {
        if (ui.settingsPanel.contains(event.target)) setPanel(true);
    }, true);
    function countInput() {
        ui.inputCount.textContent = `${ui.messageInput.value.length.toLocaleString()} characters`;
    }
    function updateMode() {
        const encode = mode() === 'encode';
        ui.conversationDetails.hidden = !encode;
        ui.appendToHistoryControl.hidden = !encode;
        ui.inputLabel.textContent = encode ? 'Your private message' : 'Public phrase';
        ui.outputLabel.textContent = encode ? 'Public phrase' : 'Decoded message';
        ui.messageInput.placeholder = encode ? 'Write something just for them…' : 'Paste the public phrase you received…';
        ui.messageOutput.placeholder = encode ? 'Your public phrase will appear here.' : 'Your private message will appear here.';
        ui.outputHint.textContent = encode ? 'Share the phrase with your recipient.' : 'Your message, unlocked in this browser.';
        ui.runButton.textContent = encode ? 'Encode message →' : 'Decode message →';
        ui.messageOutput.value = '';
        ui.copyOutput.disabled = true;
        status('');
    }
    form.querySelectorAll('[name="mode"]').forEach(input => input.addEventListener('change', updateMode));
    ui.messageInput.addEventListener('input', countInput);
    ui.clearInput.addEventListener('click', () => { ui.messageInput.value = ''; countInput(); ui.messageInput.focus(); });
    function updateOutputAction() {
        const share = isMobile() && typeof navigator.share === 'function';
        ui.copyOutput.textContent = share ? 'Share output' : 'Copy output';
        ui.copyOutput.title = share ? 'Share output using another app' : 'Copy output to the clipboard';
    }
    updateOutputAction();
    window.addEventListener('resize', updateOutputAction);
    ui.copyOutput.addEventListener('click', async () => {
        const text = ui.messageOutput.value;
        if (!text) return;
        ui.copyOutput.disabled = true;
        try {
            if (isMobile() && typeof navigator.share === 'function') {
                try {
                    // Invoke directly from the click, before awaiting clipboard work.
                    await navigator.share({title: mode() === 'encode' ? 'Public phrase' : 'Decoded message', text});
                    status('Output shared.');
                    return;
                } catch (error) {
                    if (error.name === 'AbortError') return;
                }
            }
            try { await navigator.clipboard.writeText(text); status('Output copied.'); }
            catch (_) { ui.messageOutput.focus(); ui.messageOutput.select(); status('Select and copy the output using your browser.', true); }
        } finally {
            ui.copyOutput.disabled = busy || !ui.messageOutput.value;
        }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        if (!ui.messageInput.value.trim()) { status('Enter a message or public phrase first.', true); ui.messageInput.focus(); return; }
        busy = true;
        const encode = mode() === 'encode';
        const controls = [...form.querySelectorAll('input, button, textarea, select')];
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        form.setAttribute('aria-busy', 'true');
        ui.messageOutput.value = '';
        ui.runButton.textContent = encode ? 'Encoding…' : 'Decoding…';
        status(encode ? 'Encrypting and saving your message…' : 'Fetching and unlocking your message…');
        try {
            const args = [ui.messageInput.value, ui.password.value, ui.workspace.value, ui.ownerSignature.value || null];
            ui.messageOutput.value = encode
                ? await textToSecreteMessagePublicPhrase(...args, {
                    topic: ui.topic.value, style: ui.style.value, history: history.filter(message => message.trim()), locale: ui.locale.value
                })
                : await secreteMessagePublicPhraseToText(...args);
            let message = encode ? 'Message encoded. Your public phrase is ready.' : 'Message decoded successfully.';
            if (encode && ui.appendToHistory.checked) {
                const removed = appendMessageToHistory(ui.messageOutput.value);
                if (removed === null) {
                    message += ' Not appended: this phrase alone exceeds 1500 characters.';
                } else {
                    message += ' Public phrase appended to history.';
                    if (removed) message += ` Removed ${removed} oldest ${removed === 1 ? 'message' : 'messages'}.`;
                }
            }
            status(message);
        } catch (error) { status(error.message || 'Unable to process the message. Please try again.', true); }
        finally {
            busy = false;
            controls.forEach((control, i) => { control.disabled = disabled[i]; });
            ui.copyOutput.disabled = !ui.messageOutput.value;
            form.setAttribute('aria-busy', 'false');
            ui.runButton.textContent = encode ? 'Encode message →' : 'Decode message →';
        }
    });
    const updateHistoryCount = () => { ui.historyCount.textContent = `${history.length} ${history.length === 1 ? 'message' : 'messages'}`; };
    function appendMessageToHistory(message) {
        // A single oversized message cannot fit without changing its content.
        if (message.length > 1500) return null;
        let total = history.reduce((length, item) => length + item.length, 0) + message.length;
        let removed = 0;
        while (history.length && total > 1500) {
            total -= history.shift().length;
            removed++;
        }
        history.push(message);
        renderHistory();
        return removed;
    }
    function renderHistory() {
        ui.historyRows.replaceChildren();
        history.forEach((message, index) => {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            const actions = document.createElement('td');
            actions.className = 'history-actions';
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'history-remove';
            remove.title = 'Remove message';
            remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6"/></svg>';
            remove.setAttribute('aria-label', `Remove message ${index + 1}`);
            remove.addEventListener('click', () => {
                history.splice(index, 1); renderHistory();
                const next = ui.historyRows.querySelectorAll('textarea');
                (next[Math.min(index, next.length - 1)] || ui.newHistoryMessage).focus();
            });
            const editor = document.createElement('textarea');
            editor.id = `history-message-${index}`; editor.rows = 1; editor.value = message;
            editor.setAttribute('aria-label', `Message ${index + 1}`);
            editor.addEventListener('input', () => { history[index] = editor.value; });
            cell.append(editor); actions.append(remove); row.append(cell, actions); ui.historyRows.append(row);
        });
        ui.emptyHistory.hidden = history.length > 0;
        ui.clearHistory.disabled = history.length === 0;
        updateHistoryCount();
    }
    ui.editHistory.addEventListener('click', () => { renderHistory(); ui.historyDialog.showModal(); });
    [ui.closeHistory, ui.doneHistory].forEach(button => button.addEventListener('click', () => ui.historyDialog.close()));
    ui.appendHistory.addEventListener('click', () => {
        const message = ui.newHistoryMessage.value;
        if (!message.trim()) { ui.historyStatus.textContent = 'Write a message before appending.'; ui.newHistoryMessage.focus(); return; }
        const removed = appendMessageToHistory(message);
        if (removed === null) {
            ui.historyStatus.textContent = 'A single history message must be at most 1500 characters.';
            ui.newHistoryMessage.focus();
            return;
        }
        ui.newHistoryMessage.value = '';
        ui.historyStatus.textContent = removed
            ? `Message added. Removed ${removed} oldest ${removed === 1 ? 'message' : 'messages'}.`
            : 'Message added.';
        ui.newHistoryMessage.focus();
    });
    ui.clearHistory.addEventListener('click', () => {
        history.length = 0; renderHistory(); ui.historyStatus.textContent = 'History cleared.';
        ui.newHistoryMessage.focus();
    });
    updateMode(); countInput(); renderHistory();
    // Lock controls until restoration completes so a late read cannot overwrite user edits.
    const startupControls = [...form.querySelectorAll('input, button, textarea, select')];
    const startupDisabled = startupControls.map(control => control.disabled);
    startupControls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    async function restoreSettings() {
        try {
            const saved = await SecretMessageSettingsStore.load(window.location.pathname);
            if (saved !== null) applySettings(saved);
            else {
                const legacy = localStorage.getItem(conversationStorageKey);
                if (legacy !== null) applyConversationDetails(JSON.parse(legacy));
            }
        } catch (_) {
            status('Saved settings could not be loaded. You can open a settings JSON file instead.', true);
        } finally {
            busy = false;
            startupControls.forEach((control, index) => { control.disabled = startupDisabled[index]; });
            form.setAttribute('aria-busy', 'false');
        }
    }
    void restoreSettings();
})();
