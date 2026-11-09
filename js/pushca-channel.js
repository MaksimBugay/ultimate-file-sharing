// Channel chat sessions on top of the PushcaClient channel commands (pnotifications.js, callable-future.js).
// A session joins one channel - Pushca creates a missing channel on the first ADD_MEMBERS_TO_CHANNEL - keeps a
// de-duplicated message log, pages through history and receives the CHANNEL_MESSAGE / CHANNEL_EVENT pushes of its
// channel. Membership is per account (the filter without deviceId); a client announces its avatar in the JSON
// deviceId that ClientFilter builds, the same way free-comments does.
const PushcaChannel = (() => {
    'use strict';

    const Avatar = Object.freeze({HUMAN_MANAGER: 'human-manager', AI_AGENT: 'ai-agent'});
    const EventType = Object.freeze({MEMBER_ACTIVE: 'MEMBER_ACTIVE', MEMBER_NOT_ACTIVE: 'MEMBER_NOT_ACTIVE'});
    const sessions = new Map(); // channel id -> ChannelSession
    let routingInstalled = false;

    function parseAvatar(deviceId) {
        try {
            const code = JSON.parse(deviceId)?.avatarCode;
            return Object.values(Avatar).includes(code) ? code : null;
        } catch (error) {
            return null;
        }
    }

    function avatarOf(client) {
        return (client && parseAvatar(client.deviceId)) || Avatar.HUMAN_MANAGER;
    }

    function createMember(workSpaceId, accountId, applicationId, avatar) {
        return new ClientFilter(workSpaceId, accountId, crypto.randomUUID(), applicationId, avatar);
    }

    // PushcaClient channel commands log failures and return null/false; parsing can also throw.
    async function request(operation, failure) {
        let result;
        try {
            result = await operation();
        } catch (error) {
            throw new Error(failure, {cause: error});
        }
        if (result === null || result === undefined || result === false) {
            throw new Error(failure);
        }
        return result;
    }

    function findChannel(channelsResponse, channelId) {
        return (channelsResponse.channels || []).find(info => info.channel && info.channel.id === channelId) || null;
    }

    class ChannelSession {
        constructor(channelId, member, onMessage, onMembersChange) {
            this.channel = new PChannel(channelId, channelId);
            this.member = member;
            this.onMessage = onMessage;
            this.onMembersChange = onMembersChange;
            this.messages = new Map(); // message id -> ChannelMessage
            this.members = new Map(); // account id -> {accountId, active, avatar}
            this.historyLoaded = false;
            this.historyOffset = null;
            this.hasOlder = false;
            this.noteClient(member, true);
        }

        get accountFilter() {
            return this.member.cloneWithoutDeviceId();
        }

        isMine(client) {
            return Boolean(client) && client.accountId === this.member.accountId;
        }

        memberList() {
            return [...this.members.values()];
        }

        // Adds the account to the channel unless it is a member already.
        async join() {
            if (await this.loadInfo()) {
                return {created: false, joined: false};
            }
            const publicInfo = await request(() => PushcaClient.getChannelsPublicInfo([this.channel.id]),
                'Could not look up the channel');
            const existing = findChannel(publicInfo, this.channel.id);
            if (existing && existing.channel.name) {
                this.channel = new PChannel(existing.channel.id, existing.channel.name);
            }
            await request(() => PushcaClient.addMembersToChannel(this.channel, [this.accountFilter]),
                'Could not join the channel');
            await this.loadInfo();
            return {created: !existing, joined: true};
        }

        // Refreshes the channel name and members; resolves to null while the account is not a member.
        async loadInfo() {
            const response = await request(() => PushcaClient.getChannels(this.accountFilter),
                'Could not load the channel details');
            const info = findChannel(response, this.channel.id);
            if (info) {
                this.channel = new PChannel(info.channel.id, info.channel.name || info.channel.id);
                this.applyMembers(info.members || []);
            }
            return info;
        }

        applyMembers(members) {
            const previous = this.members;
            this.members = new Map();
            for (const member of members) {
                const known = this.members.get(member.accountId);
                this.members.set(member.accountId, {
                    accountId: member.accountId,
                    active: member.active === true || Boolean(known && known.active),
                    avatar: parseAvatar(member.deviceId) || previous.get(member.accountId)?.avatar || null
                });
            }
            this.noteClient(this.member, true);
            this.onMembersChange(this.memberList());
        }

        // Records what a message sender or event actor tells about its account.
        noteClient(client, active) {
            const known = this.members.get(client.accountId);
            this.members.set(client.accountId, {
                accountId: client.accountId,
                active,
                avatar: parseAvatar(client.deviceId) || known?.avatar || null
            });
        }

        // Loads the newest history page; after a reconnect it also returns messages missed while offline.
        async loadLatest() {
            const page = await request(() => PushcaClient.getChannelHistory(this.channel),
                'Could not load the channel history');
            if (!this.historyLoaded) {
                this.historyLoaded = true;
                this.setOlderCursor(page);
            }
            return this.accept(page.messages);
        }

        async loadOlder() {
            if (!this.hasOlder) {
                return [];
            }
            const page = await request(() => PushcaClient.getChannelHistory(this.channel, this.historyOffset),
                'Could not load earlier messages');
            this.setOlderCursor(page);
            return this.accept(page.messages);
        }

        setOlderCursor(page) {
            // A repeated cursor would page forever.
            const moved = page.offset !== this.historyOffset;
            this.historyOffset = page.offset;
            this.hasOlder = page.more === true && page.offset !== null && page.offset !== undefined && moved;
        }

        // Returns the messages not seen before, oldest first.
        accept(messages) {
            const fresh = (messages || []).filter(message => message.messageId && !this.messages.has(message.messageId));
            for (const message of fresh) {
                this.messages.set(message.messageId, message);
                if (message.sender && parseAvatar(message.sender.deviceId) && this.members.has(message.sender.accountId)) {
                    this.members.get(message.sender.accountId).avatar = parseAvatar(message.sender.deviceId);
                }
            }
            return fresh.sort((a, b) => a.sendTime - b.sendTime);
        }

        receive(message) {
            if (!message.messageId || this.messages.has(message.messageId)) {
                return;
            }
            this.messages.set(message.messageId, message);
            if (message.sender) {
                this.noteClient(message.sender, true);
                this.onMembersChange(this.memberList());
            }
            this.onMessage(message);
        }

        async handleEvent(event) {
            if (event.type === EventType.MEMBER_ACTIVE || event.type === EventType.MEMBER_NOT_ACTIVE) {
                this.noteClient(event.actor, event.type === EventType.MEMBER_ACTIVE);
                this.onMembersChange(this.memberList());
                return;
            }
            // Other events (members added or removed) change the member list.
            await this.loadInfo();
        }

        // Pushca may push our own message back before the send response arrives; `echoed` tells the caller
        // that onMessage has already delivered it.
        async send(text) {
            const details = await request(() => PushcaClient.sendMessageToChannel(this.channel, [], text),
                'The message was not sent');
            if (!details.id) {
                throw new Error('The message was not sent');
            }
            const echoed = this.messages.get(details.id);
            if (echoed) {
                return {message: echoed, echoed: true};
            }
            const message = new ChannelMessage(this.member, this.channel.id, details.id, null, Date.now(), text, []);
            this.messages.set(details.id, message);
            return {message, echoed: false};
        }

        markAsRead() {
            return PushcaClient.markChannelAsRead(this.channel);
        }

        close() {
            sessions.delete(this.channel.id);
        }
    }

    // Pushes for channels without a session go to the handlers that were installed before.
    function installRouting() {
        if (routingInstalled) {
            return;
        }
        routingInstalled = true;
        const previousMessageHandler = PushcaClient.onChannelMessageHandler;
        const previousEventHandler = PushcaClient.onChannelEventHandler;
        PushcaClient.onChannelMessageHandler = message => {
            const session = sessions.get(message.channelId);
            if (session) {
                session.receive(message);
            } else if (typeof previousMessageHandler === 'function') {
                previousMessageHandler(message);
            }
        };
        PushcaClient.onChannelEventHandler = event => {
            const session = sessions.get(event.channelId);
            if (session) {
                session.handleEvent(event).catch(error => console.error('Channel event was not applied', error));
            } else if (typeof previousEventHandler === 'function') {
                previousEventHandler(event);
            }
        };
    }

    function open(channelId, member, {onMessage = () => {}, onMembersChange = () => {}} = {}) {
        if (sessions.has(channelId)) {
            throw new Error(`Channel ${channelId} is already open`);
        }
        installRouting();
        const session = new ChannelSession(channelId, member, onMessage, onMembersChange);
        sessions.set(channelId, session);
        return session;
    }

    return {Avatar, EventType, avatarOf, createMember, open};
})();
