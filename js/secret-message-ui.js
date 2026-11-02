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
        inputLabel: document.getElementById('inputLabel'),
        outputLabel: document.getElementById('outputLabel'),
        messageOutput: document.getElementById('messageOutput'),
        outputHint: document.getElementById('outputHint'),
        runButton: document.getElementById('runButton'),
        copyOutput: document.getElementById('copyOutput'),
        clearInput: document.getElementById('clearInput'),
        ownerSignature: document.getElementById('ownerSignature'),
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
    let busy = false;
    const mode = () => form.elements.mode.value;
    const status = (message, error = false) => {
        ui.securityBadge.hidden = Boolean(message);
        ui.status.hidden = !message;
        ui.status.textContent = message;
        ui.status.dataset.error = String(error);
    };
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
    ui.copyOutput.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(ui.messageOutput.value); status('Output copied.'); }
        catch (_) { ui.messageOutput.focus(); ui.messageOutput.select(); status('Select and copy the output using your browser.', true); }
    });
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy) return;
        if (!ui.messageInput.value.trim()) { status('Enter a message or public phrase first.', true); ui.messageInput.focus(); return; }
        busy = true;
        const encode = mode() === 'encode';
        const controls = [...form.querySelectorAll('input, button, textarea')];
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        form.setAttribute('aria-busy', 'true');
        ui.messageOutput.value = '';
        ui.runButton.textContent = encode ? 'Encoding…' : 'Decoding…';
        status(encode ? 'Encrypting and saving your message…' : 'Fetching and unlocking your message…');
        try {
            const operation = encode ? textToSecreteMessagePublicPhrase : secreteMessagePublicPhraseToText;
            ui.messageOutput.value = await operation(ui.messageInput.value, ui.password.value,
                ui.workspace.value, ui.ownerSignature.value || null);
            status(encode ? 'Message encoded. Your public phrase is ready.' : 'Message decoded successfully.');
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
        history.push(message); ui.newHistoryMessage.value = ''; renderHistory();
        ui.historyStatus.textContent = 'Message added.'; ui.newHistoryMessage.focus();
    });
    ui.clearHistory.addEventListener('click', () => {
        history.length = 0; renderHistory(); ui.historyStatus.textContent = 'History cleared.';
        ui.newHistoryMessage.focus();
    });
    updateMode(); countInput(); renderHistory();
})();
