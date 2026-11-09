// Chat room page: connects to Pushca as ?accountId=, joins ?channelId= (a missing channel is created) and renders
// the conversation. ?avatar=ai-agent|human-manager (or ai|human) picks the avatar, human manager by default.
// Channel commands, history and member presence live in pushca-channel.js. The socket URL comes from the Pushca
// REST open-connection endpoint (not the public WebSocket sign-in), and this page reconnects the same way.
(() => {
    'use strict';

    const OPEN_CONNECTION_URL = 'https://secure.fileshare.ovh/pushca/open-connection';
    const RECONNECT_DELAYS_MS = Object.freeze([1000, 2000, 5000, 10000, 30000]);
    const WORKSPACE_ID = 'secure-chat';
    const APPLICATION_ID = 'CHAT_ROOM';
    const MAX_ID_LENGTH = 128;
    const GROUP_WINDOW_MS = 5 * 60 * 1000;
    const NEAR_BOTTOM_PX = 120;
    const RESYNC_DELAY_MS = 5000;
    const MARK_READ_DELAY_MS = 1500;
    const TOAST_MS = 3500;
    const Avatar = PushcaChannel.Avatar;
    const AVATAR_ALIASES = Object.freeze({ai: Avatar.AI_AGENT, human: Avatar.HUMAN_MANAGER});
    const AVATAR_ROLES = Object.freeze({[Avatar.AI_AGENT]: 'AI agent', [Avatar.HUMAN_MANAGER]: 'Manager'});
    const STATUS_TEXT = Object.freeze({
        connecting: 'Connecting…', online: 'Online', reconnecting: 'Reconnecting…', offline: 'Offline'
    });
    // ```lang\ncode``` blocks; an unclosed fence runs to the end of the message.
    const FENCE = /```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g;
    const INLINE = /`([^`\n]+)`|(https?:\/\/[^\s<>"'`]+)/g;
    const TRAILING_PUNCTUATION = /[.,!?;:)\]}]+$/;
    const ICONS = Object.freeze({
        copy: 'M9 9h10v12H9zM5 15V3h10',
        check: 'm5 12 5 5 9-10'
    });

    const ui = Object.freeze({
        channelCaption: document.getElementById('channelCaption'),
        status: document.getElementById('connectionStatus'),
        statusText: document.getElementById('connectionStatusText'),
        membersBtn: document.getElementById('membersBtn'),
        membersCount: document.getElementById('membersCount'),
        membersPanel: document.getElementById('membersPanel'),
        membersList: document.getElementById('membersList'),
        closeMembersBtn: document.getElementById('closeMembersBtn'),
        copyInviteBtn: document.getElementById('copyInviteBtn'),
        log: document.getElementById('chatLog'),
        empty: document.getElementById('chatEmpty'),
        messages: document.getElementById('chatMessages'),
        loadOlderBtn: document.getElementById('loadOlderBtn'),
        jumpBtn: document.getElementById('jumpLatestBtn'),
        jumpText: document.getElementById('jumpLatestText'),
        composer: document.getElementById('composer'),
        input: document.getElementById('messageInput'),
        sendBtn: document.getElementById('sendBtn'),
        selfAvatar: document.getElementById('selfAvatar'),
        charCount: document.getElementById('charCount'),
        setupDialog: document.getElementById('setupDialog'),
        setupForm: document.getElementById('setupForm'),
        setupChannelId: document.getElementById('setupChannelId'),
        generateRoomIdBtn: document.getElementById('generateRoomIdBtn'),
        setupAccountId: document.getElementById('setupAccountId'),
        toast: document.getElementById('toast')
    });

    const rawText = new WeakMap(); // message element -> original text, for copy and retry
    const pendingBodies = new Set(); // bodies waiting for the long-message check
    const timeFormat = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit'});
    const dateTimeFormat = new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
    const fullFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'full', timeStyle: 'medium'});
    const baseTitle = document.title;
    const enterSends = !window.matchMedia('(pointer: coarse)').matches;

    let session = null;
    let joined = false;
    let syncing = null;
    let resyncTimer = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let connecting = false; // from the REST request until the socket opens or fails
    let markReadTimer = null;
    let toastTimer = null;
    let layoutFrame = 0;
    let scrollIntent = null; // {bottom: true} or {fromBottom: px}, applied after long messages are measured
    let unseen = 0;
    let unread = 0;

    // ---------- parameters ----------

    function validId(value) {
        return value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value) ? value : '';
    }

    function readParams() {
        const params = new URLSearchParams(window.location.search);
        const text = name => (params.get(name) || '').trim();
        const avatar = text('avatar').toLowerCase();
        return {
            channelId: validId(text('channelId')),
            accountId: validId(text('accountId')),
            avatar: AVATAR_ALIASES[avatar] || (Object.values(Avatar).includes(avatar) ? avatar : Avatar.HUMAN_MANAGER)
        };
    }

    function showSetup(params) {
        ui.setupChannelId.value = params.channelId;
        ui.setupAccountId.value = params.accountId;
        ui.setupForm.elements.avatar.value = params.avatar;
        ui.setupDialog.hidden = false;
        ui.channelCaption.textContent = 'Not connected';
        setStatus('offline');
        (params.channelId ? ui.setupAccountId : ui.setupChannelId).focus();
        ui.generateRoomIdBtn.addEventListener('click', () => {
            ui.setupChannelId.value = crypto.randomUUID();
            ui.setupAccountId.focus();
        });
        ui.setupForm.addEventListener('submit', event => {
            event.preventDefault();
            const accountId = validId(ui.setupAccountId.value.trim());
            if (!accountId) {
                ui.setupAccountId.focus();
                return;
            }
            const query = new URLSearchParams({
                channelId: validId(ui.setupChannelId.value.trim()) || crypto.randomUUID(),
                accountId,
                avatar: ui.setupForm.elements.avatar.value
            });
            window.location.search = query.toString();
        });
    }

    // ---------- small DOM helpers ----------

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function svgIcon(path) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'transfer-icon');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', path);
        svg.append(shape);
        return svg;
    }

    function avatarElement(avatar) {
        const holder = element('span', 'chat-avatar');
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'chat-avatar-art');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', AVATAR_ROLES[avatar]);
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', `#avatar-${avatar}`);
        svg.append(use);
        holder.append(svg);
        return holder;
    }

    function iconButton(action, label, path) {
        const button = element('button', 'chat-icon-button');
        button.type = 'button';
        button.dataset.action = action;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.append(svgIcon(path));
        return button;
    }

    function showToast(text, isError = false) {
        ui.toast.textContent = text;
        ui.toast.classList.toggle('is-error', isError);
        ui.toast.hidden = false;
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => { ui.toast.hidden = true; }, TOAST_MS);
    }

    async function copyText(text, button) {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            showToast('Copying is not available in this browser', true);
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            if (button) {
                button.replaceChildren(svgIcon(ICONS.check));
                window.setTimeout(() => button.replaceChildren(svgIcon(ICONS.copy)), 1500);
            }
            return true;
        } catch (error) {
            showToast('Your browser blocked copying to the clipboard', true);
            return false;
        }
    }

    // ---------- message text ----------

    function appendLink(parent, url) {
        const trailing = (url.match(TRAILING_PUNCTUATION) || [''])[0];
        const href = trailing ? url.slice(0, -trailing.length) : url;
        let parsed = null;
        try {
            parsed = new URL(href);
        } catch (error) {
            parsed = null;
        }
        if (parsed && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
            const link = element('a', '', href);
            link.href = parsed.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer nofollow';
            parent.append(link);
        } else {
            parent.append(href);
        }
        if (trailing) parent.append(trailing);
    }

    function appendInline(parent, text) {
        let last = 0;
        for (const match of text.matchAll(INLINE)) {
            parent.append(text.slice(last, match.index));
            if (match[1] !== undefined) {
                parent.append(element('code', '', match[1]));
            } else {
                appendLink(parent, match[2]);
            }
            last = match.index + match[0].length;
        }
        parent.append(text.slice(last));
    }

    function codeBlock(code, language) {
        const block = element('div', 'chat-code');
        const bar = element('div', 'chat-code-bar');
        bar.append(element('span', '', language || 'code'), iconButton('copy-code', 'Copy code', ICONS.copy));
        const pre = element('pre');
        pre.append(element('code', '', code.replace(/\n$/, '')));
        block.append(bar, pre);
        return block;
    }

    // Plain text with line breaks kept by CSS; fenced code blocks, inline code and http(s) links are recognised.
    function renderBody(text) {
        const fragment = document.createDocumentFragment();
        let last = 0;
        for (const match of text.matchAll(FENCE)) {
            appendInline(fragment, text.slice(last, match.index).replace(/\n$/, ''));
            fragment.append(codeBlock(match[2], match[1].trim()));
            last = match.index + match[0].length;
            if (text[last] === '\n') last++;
        }
        appendInline(fragment, text.slice(last));
        return fragment;
    }

    function messageText(body) {
        if (typeof body === 'string') return body;
        return body === null || body === undefined ? '' : JSON.stringify(body, null, 2);
    }

    // ---------- message list ----------

    function formatTime(time) {
        const date = new Date(time);
        return date.toDateString() === new Date().toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date);
    }

    function buildMessage(message) {
        const text = messageText(message.body);
        const avatar = PushcaChannel.avatarOf(message.sender);
        const accountId = message.sender ? message.sender.accountId : 'unknown';
        const article = element('article', 'chat-message');
        article.classList.toggle('is-own', session.isMine(message.sender));
        article.classList.toggle('is-ai', avatar === Avatar.AI_AGENT);
        article.dataset.account = accountId;
        article.dataset.avatar = avatar;
        if (message.messageId) article.dataset.id = message.messageId;
        rawText.set(article, text);

        const meta = element('div', 'chat-message-meta');
        const time = element('time', 'chat-time', formatTime(message.sendTime));
        time.dateTime = new Date(message.sendTime).toISOString();
        time.title = fullFormat.format(new Date(message.sendTime));
        const actions = element('div', 'chat-message-actions');
        actions.append(iconButton('copy-message', 'Copy message', ICONS.copy));
        meta.append(element('span', 'chat-author', accountId), element('span', 'chat-role', AVATAR_ROLES[avatar]), time, actions);

        const body = element('div', 'chat-message-body');
        body.append(renderBody(text));
        const expand = element('button', 'chat-expand', 'Show full message');
        expand.type = 'button';
        expand.dataset.action = 'expand';
        expand.hidden = true;
        expand.setAttribute('aria-expanded', 'false');

        const main = element('div', 'chat-message-main');
        main.append(meta, body, expand);
        article.append(avatarElement(avatar), main);
        pendingBodies.add(body);
        return article;
    }

    function isGroupedWith(previous, current) {
        return Boolean(previous) && previous.classList.contains('chat-message')
            && current.classList.contains('chat-message')
            && previous.dataset.account === current.dataset.account
            && previous.dataset.avatar === current.dataset.avatar
            && Number(current.dataset.time) - Number(previous.dataset.time) < GROUP_WINDOW_MS;
    }

    function refreshGrouping(item) {
        if (item && item.classList.contains('chat-message')) {
            item.classList.toggle('is-continued', isGroupedWith(item.previousElementSibling, item));
        }
    }

    // Items stay ordered by send time, so history pages and live pushes can arrive in any order.
    function insertItem(item, time) {
        item.dataset.time = String(time);
        const items = ui.messages.children;
        let index = items.length;
        while (index > 0 && Number(items[index - 1].dataset.time) > time) index--;
        ui.messages.insertBefore(item, items[index] || null);
        refreshGrouping(item);
        refreshGrouping(item.nextElementSibling);
        refreshEmptyState();
    }

    function insertMessage(message) {
        if (message.messageId && ui.messages.querySelector(`[data-id="${CSS.escape(message.messageId)}"]`)) return;
        insertItem(buildMessage(message), message.sendTime);
    }

    function addSystemNote(text) {
        insertItem(element('div', 'chat-system', text), Date.now());
    }

    function refreshEmptyState() {
        ui.empty.hidden = !joined || ui.messages.querySelector('.chat-message') !== null;
    }

    function isNearBottom() {
        return ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < NEAR_BOTTOM_PX;
    }

    function scheduleLayout(intent) {
        if (intent) scrollIntent = intent;
        if (!layoutFrame) layoutFrame = window.requestAnimationFrame(flushLayout);
    }

    // Messages taller than most of the visible log are folded; reads happen before writes to avoid layout thrash.
    function flushLayout() {
        layoutFrame = 0;
        const limit = Math.max(240, Math.round(ui.log.clientHeight * 0.7));
        const tall = [...pendingBodies].filter(body => body.isConnected && body.scrollHeight > limit + 120);
        pendingBodies.clear();
        for (const body of tall) {
            body.style.setProperty('--chat-clamp', `${limit}px`);
            body.classList.add('is-clamped');
            body.nextElementSibling.hidden = false;
        }
        if (scrollIntent && scrollIntent.bottom) {
            ui.log.scrollTop = ui.log.scrollHeight;
        } else if (scrollIntent) {
            ui.log.scrollTop = ui.log.scrollHeight - scrollIntent.fromBottom;
        }
        scrollIntent = null;
    }

    function scrollToLatest() {
        unseen = 0;
        ui.jumpBtn.hidden = true;
        scheduleLayout({bottom: true});
    }

    function renderBatch(messages, stick) {
        messages.forEach(insertMessage);
        if (stick) scrollToLatest(); else scheduleLayout();
    }

    function renderLive(message) {
        const stick = isNearBottom() || session.isMine(message.sender);
        insertMessage(message);
        if (stick) {
            scrollToLatest();
        } else {
            unseen++;
            ui.jumpText.textContent = unseen === 1 ? '1 new message' : `${unseen} new messages`;
            ui.jumpBtn.hidden = false;
            scheduleLayout();
        }
        if (document.hidden) {
            if (!session.isMine(message.sender)) {
                unread++;
                document.title = `(${unread}) ${baseTitle}`;
            }
        } else {
            scheduleMarkRead();
        }
    }

    function toggleExpand(button) {
        const body = button.previousElementSibling;
        const expanded = body.classList.toggle('is-clamped') === false;
        button.textContent = expanded ? 'Show less' : 'Show full message';
        button.setAttribute('aria-expanded', String(expanded));
        if (!expanded) button.closest('.chat-message').scrollIntoView({block: 'nearest'});
    }

    async function loadOlder() {
        ui.loadOlderBtn.disabled = true;
        const fromBottom = ui.log.scrollHeight - ui.log.scrollTop;
        try {
            const older = await session.loadOlder();
            older.forEach(insertMessage);
            scheduleLayout({fromBottom});
        } catch (error) {
            console.error(error);
            showToast('Could not load earlier messages', true);
        } finally {
            ui.loadOlderBtn.disabled = false;
            ui.loadOlderBtn.hidden = !session.hasOlder;
        }
    }

    // ---------- members ----------

    function renderMembers(members) {
        const sorted = [...members].sort((a, b) =>
            Number(session.isMine(b)) - Number(session.isMine(a))
            || Number(b.active) - Number(a.active)
            || a.accountId.localeCompare(b.accountId));
        const online = members.filter(member => member.active).length;
        ui.membersCount.textContent = String(members.length);
        ui.membersBtn.setAttribute('aria-label', `Room members: ${members.length}, ${online} online`);
        ui.membersBtn.title = `${members.length} members, ${online} online`;
        ui.membersList.replaceChildren(...sorted.map(member => {
            const avatar = member.avatar || Avatar.HUMAN_MANAGER;
            const item = element('li', 'chat-member');
            item.classList.toggle('is-active', member.active);
            const picture = avatarElement(avatar);
            picture.append(element('span', 'chat-presence'));
            const text = element('span', 'chat-member-text');
            const name = session.isMine(member) ? `${member.accountId} (you)` : member.accountId;
            text.append(element('span', 'chat-member-name', name),
                element('span', 'chat-member-role', `${AVATAR_ROLES[avatar]} · ${member.active ? 'online' : 'offline'}`));
            item.append(picture, text);
            return item;
        }));
    }

    function setMembersOpen(open) {
        ui.membersPanel.hidden = !open;
        ui.membersBtn.setAttribute('aria-expanded', String(open));
    }

    // ---------- composer ----------

    function canSend() {
        return joined && PushcaClient.isOpen() && ui.input.value.trim().length > 0;
    }

    function refreshComposer() {
        ui.sendBtn.disabled = !canSend();
        const length = ui.input.value.length;
        ui.charCount.textContent = length > 500 ? `${length.toLocaleString()} characters` : '';
    }

    function autosize() {
        ui.input.style.height = 'auto';
        ui.input.style.height = `${ui.input.scrollHeight}px`;
    }

    function setPendingState(article, state) {
        article.classList.toggle('is-pending', state === 'sending');
        article.classList.toggle('is-failed', state === 'failed');
        const line = article.querySelector('.chat-message-state') || element('div', 'chat-message-state');
        if (state === 'sending') {
            line.replaceChildren('Sending…');
        } else {
            const retry = element('button', '', 'Retry');
            retry.type = 'button';
            retry.dataset.action = 'retry';
            const discard = element('button', '', 'Discard');
            discard.type = 'button';
            discard.dataset.action = 'discard';
            line.replaceChildren('Not sent.', retry, discard);
        }
        article.querySelector('.chat-message-main').append(line);
    }

    async function deliver(article) {
        setPendingState(article, 'sending');
        try {
            const {message, echoed} = await session.send(rawText.get(article));
            if (echoed) {
                const next = article.nextElementSibling;
                article.remove();
                refreshGrouping(next);
                refreshEmptyState();
            } else {
                const sent = buildMessage(message);
                sent.dataset.time = article.dataset.time;
                article.replaceWith(sent);
                refreshGrouping(sent);
                refreshGrouping(sent.nextElementSibling);
                scheduleLayout();
            }
        } catch (error) {
            console.error(error);
            setPendingState(article, 'failed');
        }
    }

    function sendDraft() {
        if (!canSend()) return;
        const text = ui.input.value;
        ui.input.value = '';
        autosize();
        refreshComposer();
        const draft = new ChannelMessage(session.member, session.channel.id, null, null, Date.now(), text, []);
        const article = buildMessage(draft);
        delete article.dataset.id; // not known until Pushca answers
        insertItem(article, draft.sendTime);
        scrollToLatest();
        void deliver(article);
    }

    // ---------- connection ----------

    function setStatus(state) {
        ui.status.dataset.state = state;
        ui.statusText.textContent = STATUS_TEXT[state];
        ui.status.title = `Connection: ${STATUS_TEXT[state]}`;
        refreshComposer();
    }

    function scheduleMarkRead() {
        window.clearTimeout(markReadTimer);
        markReadTimer = window.setTimeout(() => {
            if (joined && PushcaClient.isOpen()) {
                session.markAsRead().catch(error => console.warn('Channel was not marked as read', error));
            }
        }, MARK_READ_DELAY_MS);
    }

    async function runSync() {
        if (!joined) {
            const result = await session.join();
            joined = true;
            ui.channelCaption.textContent = `# ${session.channel.name}`;
            if (result.created) {
                addSystemNote(`Room “${session.channel.name}” was created`);
            } else if (result.joined) {
                addSystemNote(`${session.member.accountId} joined the room`);
            }
            const latest = await session.loadLatest();
            renderBatch(latest, true);
            ui.loadOlderBtn.hidden = !session.hasOlder;
        } else {
            await session.loadInfo();
            renderBatch(await session.loadLatest(), isNearBottom());
        }
        refreshEmptyState();
        refreshComposer();
        scheduleMarkRead();
    }

    // Runs on every (re)connect: the first run joins the channel, later runs fetch what was missed.
    function synchronize() {
        window.clearTimeout(resyncTimer);
        if (!syncing) {
            syncing = runSync()
                .catch(error => {
                    console.error(error);
                    showToast('Could not open the chat room. Retrying…', true);
                    resyncTimer = window.setTimeout(() => {
                        if (PushcaClient.isOpen()) void synchronize();
                    }, RESYNC_DELAY_MS);
                })
                .finally(() => { syncing = null; });
        }
        return syncing;
    }

    // Pushca registers the client for this IP and answers with the WebSocket URL to open.
    async function requestWsUrl(client) {
        const response = await fetch(OPEN_CONNECTION_URL, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({client, mobile: isMobile(), pusherInstanceId: null, apiKey: null})
        });
        if (!response.ok) {
            throw new Error(`Pushca open-connection failed: HTTP ${response.status}`);
        }
        const {browserAdvertisedUrl, pusherInstanceId} = await response.json();
        if (!browserAdvertisedUrl) {
            throw new Error('Pushca open-connection returned no WebSocket URL');
        }
        PushcaClient.pusherInstanceId = pusherInstanceId;
        return browserAdvertisedUrl;
    }

    function scheduleReconnect() {
        connecting = false;
        if (reconnectTimer || PushcaClient.isOpen()) return;
        const delayMs = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
        reconnectAttempt++;
        setStatus('reconnecting');
        reconnectTimer = window.setTimeout(() => {
            reconnectTimer = null;
            void connect();
        }, delayMs);
    }

    // A reconnect refreshes the device id time stamp, as PushcaClient.restoreWsConnection does.
    async function connect() {
        if (connecting || PushcaClient.isOpen()) return;
        connecting = true;
        const client = reconnectAttempt === 0 ? PushcaClient.ClientObj : refreshClientObj(PushcaClient.ClientObj);
        try {
            PushcaClient.wsUrl = await requestWsUrl(client);
            PushcaClient.ClientObj = client;
            PushcaClient.openWebSocket(null, scheduleReconnect, null);
        } catch (error) {
            console.error(error);
            scheduleReconnect();
        }
    }

    function start(params) {
        const member = PushcaChannel.createMember(WORKSPACE_ID, params.accountId, APPLICATION_ID, params.avatar);
        session = PushcaChannel.open(params.channelId, member, {
            onMessage: renderLive,
            onMembersChange: renderMembers
        });
        document.title = `${params.channelId} · ${baseTitle}`;
        ui.channelCaption.textContent = `# ${params.channelId}`;
        ui.channelCaption.title = `Room ${params.channelId} · signed in as ${params.accountId}`;
        ui.selfAvatar.replaceWith(Object.assign(avatarElement(params.avatar), {id: 'selfAvatar'}));
        ui.input.placeholder = `Message as ${params.accountId}…`;
        renderMembers(session.memberList());

        PushcaClient.onOpenHandler = () => {
            connecting = false;
            reconnectAttempt = 0;
            setStatus('online');
            void synchronize();
        };
        PushcaClient.onCloseHandler = scheduleReconnect;
        PushcaClient.ClientObj = member;
        setStatus('connecting');
        void connect();
    }

    // ---------- events ----------

    ui.messages.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const article = button.closest('.chat-message');
        switch (button.dataset.action) {
            case 'copy-message':
                void copyText(rawText.get(article), button);
                break;
            case 'copy-code':
                void copyText(button.closest('.chat-code').querySelector('pre').textContent, button);
                break;
            case 'expand':
                toggleExpand(button);
                break;
            case 'retry':
                if (joined && PushcaClient.isOpen()) void deliver(article);
                else showToast('Waiting for the connection to come back', true);
                break;
            case 'discard': {
                const next = article.nextElementSibling;
                article.remove();
                refreshGrouping(next);
                refreshEmptyState();
                break;
            }
        }
    });

    ui.log.addEventListener('scroll', () => {
        if (!ui.jumpBtn.hidden && isNearBottom()) {
            unseen = 0;
            ui.jumpBtn.hidden = true;
        }
    }, {passive: true});

    ui.jumpBtn.addEventListener('click', scrollToLatest);
    ui.loadOlderBtn.addEventListener('click', () => void loadOlder());
    ui.membersBtn.addEventListener('click', () => setMembersOpen(ui.membersPanel.hidden));
    ui.closeMembersBtn.addEventListener('click', () => setMembersOpen(false));
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !ui.membersPanel.hidden) setMembersOpen(false);
    });

    ui.copyInviteBtn.addEventListener('click', async () => {
        if (!session) return;
        const invite = new URL(window.location.pathname, window.location.origin);
        invite.searchParams.set('channelId', session.channel.id);
        if (await copyText(invite.href)) showToast('Invite link copied. Each person picks their own name.');
    });

    ui.input.addEventListener('input', () => {
        autosize();
        refreshComposer();
    });
    ui.input.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing
            && (enterSends || event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            sendDraft();
        }
    });
    ui.composer.addEventListener('submit', event => {
        event.preventDefault();
        sendDraft();
        ui.input.focus();
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && unread > 0) {
            unread = 0;
            document.title = session ? `${session.channel.id} · ${baseTitle}` : baseTitle;
            scheduleMarkRead();
        }
    });

    // ---------- start ----------

    const params = readParams();
    if (!enterSends) ui.input.enterKeyHint = 'enter';
    if (!params.channelId || !params.accountId) {
        showSetup(params);
        return;
    }
    start(params);
    // Back online: retry now instead of waiting for the backoff delay.
    window.addEventListener('online', () => {
        if (!session || PushcaClient.isOpen()) return;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
        void connect();
    });
})();
