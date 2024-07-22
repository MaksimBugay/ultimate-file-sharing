console.log('pnotifications.js running on', window.location.href);

const requiredClientFields = ['workSpaceId', 'accountId', 'deviceId', 'applicationId'];

const Command = Object.freeze({
    PING: "PING",
    ACKNOWLEDGE: "ACKNOWLEDGE",
    SEND_MESSAGE: "SEND_MESSAGE",
    SEND_MESSAGE_WITH_ACKNOWLEDGE: "SEND_MESSAGE_WITH_ACKNOWLEDGE",
    ADD_MEMBERS_TO_CHANNEL: "ADD_MEMBERS_TO_CHANNEL",
    SEND_MESSAGE_TO_CHANNEL: "SEND_MESSAGE_TO_CHANNEL",
    GET_CHANNEL_HISTORY: "GET_CHANNEL_HISTORY",
    REMOVE_ME_FROM_CHANNEL: "REMOVE_ME_FROM_CHANNEL",
    GET_CHANNELS: "GET_CHANNELS",
    GET_CHANNELS_PUBLIC_INFO: "GET_CHANNELS_PUBLIC_INFO",
    MARK_CHANNEL_AS_READ: "MARK_CHANNEL_AS_READ",
    GET_IMPRESSION_STAT: "GET_IMPRESSION_STAT",
    ADD_IMPRESSION: "ADD_IMPRESSION",
    REMOVE_IMPRESSION: "REMOVE_IMPRESSION"
});

const ResponseType = Object.freeze({
    SUCCESS: "SUCCESS",
    ERROR: "ERROR"
});

const MessageType = Object.freeze({
    ACKNOWLEDGE: "ACKNOWLEDGE",
    RESPONSE: "RESPONSE",
    CHANNEL_MESSAGE: "CHANNEL_MESSAGE",
    CHANNEL_EVENT: "CHANNEL_EVENT"
});

const ResourceType = Object.freeze({
    CHANNEL: "CHANNEL",
    CHANNEL_MESSAGE: "CHANNEL_MESSAGE"
});

const MessagePartsDelimiter = "@@";

class PChannel {
    constructor(id, name) {
        this.id = id;
        this.name = name;
    }
}

class ClientFilter {
    constructor(workSpaceId, accountId, deviceId, applicationId, avatarCode, isModalView, signatureHash, webSite) {
        this.workSpaceId = workSpaceId;
        this.accountId = accountId;
        this.deviceId = deviceId;
        if (avatarCode) {
            this.deviceId = JSON.stringify({
                "deviceId": deviceId,
                "avatarCode": avatarCode,
                "webSite": webSite,
                "signatureHash": signatureHash,
                "modalView": isModalView,
                "time": new Date().getTime()
            })
        }
        this.applicationId = applicationId;
    }

    cloneWithoutDeviceId() {
        return new ClientFilter(
            this.workSpaceId,
            this.accountId,
            null,
            this.applicationId
        );
    }

    cloneAndReplaceDeviceId(newDeviceId) {
        return new ClientFilter(
            this.workSpaceId,
            this.accountId,
            newDeviceId,
            this.applicationId
        );
    }
}

class ChannelMember {
    constructor(workSpaceId, accountId, deviceId, applicationId, active) {
        this.workSpaceId = workSpaceId;
        this.accountId = accountId;
        this.deviceId = deviceId;
        this.applicationId = applicationId;
        this.active = active;
    }

    shortPrint() {
        if (isNotEmpty(this.active) && this.active) {
            return this.accountId + "[+]";
        } else {
            return this.accountId + "[-]";
        }
    }
}

class ChannelWithInfo {
    constructor(channel, members, counter, time, read) {
        this.channel = channel;
        this.members = members;
        this.counter = counter;
        this.time = time;
        this.read = read;
    }

    static fromObject(channelObj) {
        const channel = new PChannel(channelObj.channel.id, channelObj.channel.name);
        let members = [];
        if (channelObj.members) {
            members = channelObj.members.map(obj => new ChannelMember(
                    obj.workSpaceId,
                    obj.accountId,
                    obj.deviceId,
                    obj.applicationId,
                    obj.active
                )
            );
        }
        return new ChannelWithInfo(channel, members, channelObj.counter, channelObj.time, channelObj.read);
    }
}

class ChannelsResponse {
    constructor(channels) {
        this.channels = channels;
    }

    static fromWsResponse(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        const channels = jsonObject.body.channels.map(obj => ChannelWithInfo.fromObject(obj));
        return new ChannelsResponse(channels);
    }
}

class ImpressionCounter {
    constructor(code, counter) {
        this.code = code;
        this.counter = counter;
    }

    static fromObject(icObj) {
        return new ImpressionCounter(icObj.code, icObj.counter);
    }

    shortPrint() {
        return this.code + ": " + this.counter;
    }
}

class ResourceImpressionCounters {
    constructor(resourceId, counters) {
        this.resourceId = resourceId;
        this.counters = counters;
    }

    static fromObject(ricObj) {
        const counters = ricObj.counters.map(obj => ImpressionCounter.fromObject(obj));
        return new ResourceImpressionCounters(ricObj.resourceId, counters);
    }
}

class PImpression {
    constructor(resourceId, resourceType, code) {
        this.resourceId = resourceId;
        this.resourceType = resourceType;
        this.code = code;
    }
}

class ImpressionsResponse {
    constructor(items) {
        this.items = items;
    }

    static fromWsResponse(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        const items = jsonObject.body.map(obj => ResourceImpressionCounters.fromObject(obj));
        return new ImpressionsResponse(items);
    }
}

class HistoryPage {
    constructor(messages, offset, latest, more) {
        this.messages = messages;
        this.offset = offset;
        this.latest = latest;
        this.more = more;
    }

    static fromWsResponse(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        const messages = jsonObject.body.messages.map(obj => ChannelMessage.fromObject(obj));
        return new HistoryPage(messages, jsonObject.body.offset, jsonObject.body.latest, jsonObject.body.more);
    }
}

class MessageDetails {
    constructor(id) {
        this.id = id;
    }

    static fromWsResponse(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        const messageId = jsonObject.body.messageId;
        return new MessageDetails(messageId);
    }
}

class ChannelEvent {

    constructor(type, actor, channelId, filters, time) {
        this.type = type;
        this.actor = actor;
        this.channelId = channelId;
        this.filters = filters;
        this.time = time;
    }

    static fromJSON(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        const actor = new ClientFilter(
            jsonObject.actor.workSpaceId,
            jsonObject.actor.accountId,
            jsonObject.actor.deviceId,
            jsonObject.actor.applicationId
        );
        let filters = [];
        if (jsonObject.filters) {
            filters = jsonObject.filters.map(obj => new ClientFilter(
                    obj.workSpaceId,
                    obj.accountId,
                    obj.deviceId,
                    obj.applicationId
                )
            );
        }
        return new ChannelEvent(jsonObject.type, actor, jsonObject.channelId, filters, jsonObject.time);
    }
}

class ChannelMessage {

    constructor(sender, channelId, messageId, parentId, sendTime, body, mentioned) {
        this.sender = sender;
        this.channelId = channelId;
        if (messageId) {
            this.messageId = messageId;
        } else {
            this.messageId = uuid.v4().toString();
        }
        this.parentId = parentId;
        if (sendTime) {
            this.sendTime = sendTime;
        } else {
            this.sendTime = Date.now();
        }
        this.body = body;
        this.mentioned = mentioned;
    }

    static fromObject(jsonObject) {
        const sender = new ClientFilter(
            jsonObject.sender.workSpaceId,
            jsonObject.sender.accountId,
            jsonObject.sender.deviceId,
            jsonObject.sender.applicationId
        );
        let mentioned = [];
        if (isArrayNotEmpty(jsonObject.mentioned)) {
            mentioned = jsonObject.mentioned.map(obj => new ClientFilter(
                    obj.workSpaceId,
                    obj.accountId,
                    obj.deviceId,
                    obj.applicationId
                )
            );
        }
        return new ChannelMessage(sender, jsonObject.channelId, jsonObject.messageId, jsonObject.parentId,
            jsonObject.sendTime, jsonObject.body, mentioned);
    }

    static fromJSON(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return this.fromObject(jsonObject);
    }
}

class WaiterResponse {
    constructor(type, body) {
        this.type = type;
        this.body = body;
    }
}

class Waiter {
    constructor() {
        this.promise = new Promise((resolve, reject) => {
            this.resolve = resolve; // Assign resolve function to the outer scope variable
            this.reject = reject; // Assign reject function to the outer scope variable
        });
    }
}

function printDateTime(dt) {
    const dateTime = new Date(dt);
    const year = dateTime.getFullYear();
    const month = String(dateTime.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed, add 1 to get the correct month
    const day = String(dateTime.getDate()).padStart(2, '0');
    const hours = String(dateTime.getHours()).padStart(2, '0');
    const minutes = String(dateTime.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function printObject(obj) {
    return Object.values(obj)
        .filter(value => value !== undefined && value !== null)
        .join('/');
}

function isArrayNotEmpty(arr) {
    return arr !== null && arr !== undefined && Array.isArray(arr) && arr.length > 0;
}

function isNotEmpty(x) {
    return (typeof x !== 'undefined') && x !== null && x !== undefined && x !== ''
}

function releaseWaiterWithSuccess(waiter, response) {
    waiter.resolve(new WaiterResponse(ResponseType.SUCCESS, response));
}

function releaseWaiterWithError(waiter, error) {
    waiter.reject(new WaiterResponse(ResponseType.ERROR, error));
}

function allClientFieldsAreNotEmpty(obj) {
    return requiredClientFields.every(field => {
        return obj.hasOwnProperty(field) && obj[field] !== null && obj[field] !== undefined && obj[field] !== '';
    });
}

function encodeToBase64UrlSafe(str) {
    // Encode UTF-8 string to Uint8Array
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(str);

    // Convert Uint8Array to binary string
    const binaryString = String.fromCharCode.apply(null, uint8Array);

    // Encode to standard Base64 string
    const base64 = btoa(binaryString);

    // Make the Base64 string URL safe
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeFromBase64UrlSafe(base64UrlSafe) {
    // Replace URL safe characters with Base64 standard characters
    let base64 = base64UrlSafe.replace(/-/g, '+').replace(/_/g, '/');

    // Add padding if necessary
    while (base64.length % 4) {
        base64 += '=';
    }

    // Decode from Base64 to binary string
    const binaryString = atob(base64);

    // Convert binary string to Uint8Array
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        uint8Array[i] = binaryString.charCodeAt(i);
    }

    // Decode UTF-8 Uint8Array to string
    const decoder = new TextDecoder();
    return decoder.decode(uint8Array);
}

class OpenConnectionRequest {
    constructor(client, pusherInstanceId, apiKey) {
        this.client = client;
        this.pusherInstanceId = pusherInstanceId;
        this.apiKey = apiKey;
    }
}

class OpenConnectionResponse {
    constructor(pusherInstanceId, externalAdvertisedUrl, internalAdvertisedUrl, browserAdvertisedUrl) {
        this.pusherInstanceId = pusherInstanceId;
        this.externalAdvertisedUrl = externalAdvertisedUrl;
        this.internalAdvertisedUrl = internalAdvertisedUrl;
        this.browserAdvertisedUrl = browserAdvertisedUrl;
    }

    static fromJSON(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return new OpenConnectionResponse(
            jsonObject.pusherInstanceId,
            jsonObject.externalAdvertisedUrl,
            jsonObject.internalAdvertisedUrl,
            jsonObject.browserAdvertisedUrl
        );
    }
}

class CommandWithId {
    constructor(id, message) {
        this.id = id;
        this.message = message;
    }
}

let PushcaClient = {};
PushcaClient.waitingHall = new Map();
PushcaClient.serverBaseUrl = 'http://localhost:8080'

PushcaClient.addToWaitingHall = function (id) {
    let waiter = new Waiter();
    PushcaClient.waitingHall.set(id, waiter);
    return waiter.promise;
}

PushcaClient.releaseWaiterIfExists = function (id, response) {
    let waiter = PushcaClient.waitingHall.get(id);
    if (waiter) {
        releaseWaiterWithSuccess(waiter, response)
        PushcaClient.waitingHall.delete(id);
    }
}
PushcaClient.executeWithRepeatOnFailure = async function (id, commandWithId, inTimeoutMs, numberOfRepeatAttempts) {
    if (isEmpty(PushcaClient.ws)) {
        return new WaiterResponse(ResponseType.ERROR, 'Web socket connection does not exists');
    }
    if (PushcaClient.ws.readyState !== window.WebSocket.OPEN) {
        const errorMsg = `WebSocket is not open. State: ${PushcaClient.ws.readyState}`;
        console.error(errorMsg);
        return new WaiterResponse(ResponseType.ERROR, errorMsg);
    }
    let n = numberOfRepeatAttempts || 3
    let result;
    for (let i = 0; i < n; i++) {
        result = await PushcaClient.execute(id, commandWithId, inTimeoutMs);
        if (ResponseType.SUCCESS === result.type) {
            break;
        }
    }
    return result;
}
PushcaClient.execute = async function (id, commandWithId, inTimeoutMs) {
    let timeoutMs = inTimeoutMs || 5000;
    let ackId = id || commandWithId.id;

    let timeout = (ms) => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout after ' + ms + ' ms')), ms);
    });

    PushcaClient.ws.send(commandWithId.message);
    let result;
    try {
        result = await Promise.race([
            PushcaClient.addToWaitingHall(ackId),
            timeout(timeoutMs)
        ]);
    } catch (error) {
        PushcaClient.waitingHall.delete(ackId);
        result = new WaiterResponse(ResponseType.ERROR, error);
    }
    //console.log(result);
    return result;
}

PushcaClient.buildCommandMessage = function (command, args) {
    let id = uuid.v4().toString();
    let message;
    if (args) {
        message = `${id}${MessagePartsDelimiter}${command}${MessagePartsDelimiter}${JSON.stringify(args)}`;
    } else {
        message = `${id}${MessagePartsDelimiter}${command}`;
    }
    return new CommandWithId(id, message);
}

PushcaClient.openWebSocket = function (onOpenHandler, onCloseHandler, onMessageHandler,
                                       onChannelEventHandler, onChannelMessageHandler, onDataHandler) {
    PushcaClient.ws = new window.WebSocket(PushcaClient.wsUrl);
    PushcaClient.ws.binaryType = 'arraybuffer';
    if (PushcaClient.ws) {
        PushcaClient.ws.onopen = function () {
            //console.log('open');
            if (typeof onOpenHandler === 'function') {
                onOpenHandler(PushcaClient.ws);
            }
        };

        PushcaClient.ws.onmessage = function (event) {
            if (event.data instanceof ArrayBuffer) {
                //console.log('binary', event.data.byteLength);
                if (typeof onDataHandler === 'function') {
                    onDataHandler(event.data);
                }
                return;
            }
            //console.log('message', event.data);
            let parts = event.data.split(MessagePartsDelimiter);
            if (parts[1] === MessageType.ACKNOWLEDGE) {
                PushcaClient.releaseWaiterIfExists(parts[0], null);
                return;
            }
            if (parts[1] === MessageType.RESPONSE) {
                let body;
                if (parts.length > 2) {
                    body = parts[2];
                }
                PushcaClient.releaseWaiterIfExists(parts[0], body);
                return;
            }
            if (parts[1] === MessageType.CHANNEL_EVENT) {
                if (typeof onChannelEventHandler === 'function') {
                    onChannelEventHandler(ChannelEvent.fromJSON(parts[2]))
                }
                return;
            }
            if (parts[1] === MessageType.CHANNEL_MESSAGE) {
                if (typeof onChannelMessageHandler === 'function') {
                    onChannelMessageHandler(ChannelMessage.fromJSON(parts[2]))
                }
                return;
            }
            if (parts.length === 2) {
                PushcaClient.sendAcknowledge(parts[0]);
                if (typeof onMessageHandler === 'function') {
                    onMessageHandler(PushcaClient.ws, parts[1]);
                }
                return;
            }
            if (typeof onMessageHandler === 'function') {
                onMessageHandler(PushcaClient.ws, event.data);
            }
        };

        PushcaClient.ws.onerror = function (error) {
            console.error("There was an error with your websocket!");
        };

        PushcaClient.ws.onclose = function (event) {
            if (event.wasClean) {
                console.log(
                    `[close] Connection closed cleanly, code=${event.code} reason=${event.reason}`);
            }
            if (typeof onCloseHandler === 'function') {
                onCloseHandler(PushcaClient.ws, event)
            }
        };
    }
}

function cleanRefreshBrokenConnectionInterval() {
    if (PushcaClient.refreshBrokenConnectionIntervalId) {
        window.clearInterval(PushcaClient.refreshBrokenConnectionIntervalId);
        PushcaClient.refreshBrokenConnectionIntervalId = null;
    }
}

PushcaClient.isOpen = function () {
    if (!PushcaClient.ws) {
        return false;
    }
    return PushcaClient.ws.readyState === window.WebSocket.OPEN;
}
PushcaClient.openWsConnection = function (baseUrl, clientObj, onOpenHandler, onCloseHandler, onMessageHandler,
                                          onChannelEventHandler, onChannelMessageHandler, onDataHandler, withoutRefresh) {
    PushcaClient.serverBaseUrl = baseUrl;
    PushcaClient.ClientObj = clientObj;
    const openConnectionRequest = new OpenConnectionRequest(clientObj, null, null);
    //console.log(`Sign-in attempt: ${JSON.stringify(openConnectionRequest)}`);
    const wsUrl = baseUrl + "sign-in/" + encodeToBase64UrlSafe(JSON.stringify(openConnectionRequest));
    console.log("Public sign-in url: " + wsUrl);
    const tmpWs = new WebSocket(wsUrl);
    if (tmpWs) {
        tmpWs.onmessage = function (event) {
            try {
                const response = OpenConnectionResponse.fromJSON(event.data);
                PushcaClient.wsUrl = response.browserAdvertisedUrl;
                console.log("Authorised web socket url: " + PushcaClient.wsUrl);
                PushcaClient.openWebSocket(onOpenHandler, onCloseHandler, onMessageHandler,
                    onChannelEventHandler, onChannelMessageHandler, onDataHandler);
            } catch (error) {
                console.error(`Cannot open ws connection based on response: ${event.data} `);
            }
        };
    }
    if (withoutRefresh) {
        return;
    }
    cleanRefreshBrokenConnectionInterval();
    PushcaClient.recoveryAttempt = 0;
    delay(5000).then(() => {
        PushcaClient.refreshBrokenConnectionIntervalId = window.setInterval(function () {
            if ((!PushcaClient.ws) || (PushcaClient.ws.readyState !== window.WebSocket.OPEN)) {
                if (PushcaClient.ClientObj) {
                    PushcaClient.recoveryAttempt = PushcaClient.recoveryAttempt + 1;
                    if (PushcaClient.recoveryAttempt < 12) {
                        let d = 100;
                        if (PushcaClient.ws
                            && (PushcaClient.ws.readyState !== window.WebSocket.CLOSING)
                            && (PushcaClient.ws.readyState !== window.WebSocket.CLOSED)
                        ) {
                            PushcaClient.ws.close(3000, "Close broken connection before recovery");
                            d = 2000;
                        }
                        delay(d).then(() => {
                            PushcaClient.openWsConnection(baseUrl, refreshClientObj(PushcaClient.ClientObj), onOpenHandler, onCloseHandler, onMessageHandler,
                                onChannelEventHandler, onChannelMessageHandler, onDataHandler, true);
                        });
                    }
                }
            }
        }, 5000);
    });
}

function refreshClientObj(clientObj) {
    const oldDeviceId = JSON.parse(clientObj.deviceId);
    return new ClientFilter(
        clientObj.workSpaceId,
        clientObj.accountId,
        JSON.stringify({
            "deviceId": oldDeviceId.deviceId,
            "avatarCode": oldDeviceId.avatarCode,
            "webSite": oldDeviceId.webSite,
            "signatureHash": oldDeviceId.signatureHash,
            "modalView": oldDeviceId.modalView,
            "time": new Date().getTime()
        }),
        clientObj.applicationId);
}

PushcaClient.changeClientObject = function (clientObj) {
    if (PushcaClient.ws
        && (PushcaClient.ws.readyState === window.WebSocket.OPEN)
        && (clientObj.accountId === PushcaClient.ClientObj.accountId)) {
        return null;
    }
    const old = PushcaClient.ClientObj;
    PushcaClient.ClientObj = clientObj;
    if (PushcaClient.ws) {
        PushcaClient.ws.close(1000, "leave");
    }
    return old;
}

/**
 * acknowledge Pushca about received message (Pushca forwards acknowledge to sender)
 *
 * @param id - message id
 */
PushcaClient.sendAcknowledge = function (id) {
    let metaData = {};
    metaData["messageId"] = id;
    let commandWithId = PushcaClient.buildCommandMessage(Command.ACKNOWLEDGE, metaData);
    PushcaClient.ws.send(commandWithId.message);
}

/**
 * Send message to all connected clients that met the filtering requirements
 *
 * @param id            - message id (if null then will be assigned by Pushca)
 * @param dest          - filter of receivers
 * @param preserveOrder - keep sending order during delivery
 * @param message       - message text
 */
PushcaClient.broadcastMessage = async function (id, dest, preserveOrder, message) {
    let metaData = {};
    metaData["id"] = id;
    metaData["filter"] = dest;
    metaData["sender"] = PushcaClient.client;
    metaData["message"] = message;
    metaData["preserveOrder"] = preserveOrder;

    let commandWithId = PushcaClient.buildCommandMessage(Command.SEND_MESSAGE, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed broadcast message attempt: " + result.body);
    }
}

/**
 * send message to some client and wait for acknowledge, if no acknowledge after defined number of
 * send attempts then throw exception
 *
 * @param id            - message id (if null then will be assigned by Pushca)
 * @param dest          - client who should receive a message
 * @param preserveOrder - keep sending order during delivery
 * @param message       - message text
 */
PushcaClient.sendMessageWithAcknowledge = async function (id, dest, preserveOrder, message) {
    if (!allClientFieldsAreNotEmpty(dest)) {
        console.error("Cannot broadcast with acknowledge: " + JSON.stringify(dest));
        return;
    }
    let metaData = {};
    metaData["id"] = id;
    metaData["client"] = dest;
    metaData["sender"] = PushcaClient.client;
    metaData["message"] = message;
    metaData["preserveOrder"] = preserveOrder;

    let commandWithId = PushcaClient.buildCommandMessage(Command.SEND_MESSAGE_WITH_ACKNOWLEDGE, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(id, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed send message with acknowledge attempt: " + result.body);
    }
}

/**
 * Add new members into create if not exists channel
 *
 * @param channel - channel object
 * @param filters - new members
 */
PushcaClient.addMembersToChannel = async function (channel, filters) {
    let metaData = {};
    metaData["channel"] = channel;
    metaData["filters"] = filters;
    let commandWithId = PushcaClient.buildCommandMessage(Command.ADD_MEMBERS_TO_CHANNEL, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed add members to channel attempt: " + result.body);
        return false;
    }
    return true;
}

PushcaClient.sendMessageToChannel = async function (channel, mentioned, message) {
    let metaData = {};
    metaData["channel"] = channel;
    if (isArrayNotEmpty(mentioned)) {
        metaData["mentioned"] = mentioned;
    }
    metaData["message"] = message;
    let commandWithId = PushcaClient.buildCommandMessage(Command.SEND_MESSAGE_TO_CHANNEL, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed send message to channel attempt: " + result.body);
        return null;
    }
    return MessageDetails.fromWsResponse(result.body);
}

PushcaClient.getChannelHistory = async function (channel, offset) {
    let metaData = {};
    metaData["channel"] = channel;
    if (offset) {
        metaData["offset"] = offset;
    }
    let commandWithId = PushcaClient.buildCommandMessage(Command.GET_CHANNEL_HISTORY, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed get channel history attempt: " + result.body);
        return null;
    }
    return HistoryPage.fromWsResponse(result.body);
}

PushcaClient.removeMeFromChannel = async function (channel) {
    let metaData = {};
    metaData["channel"] = channel;
    let commandWithId = PushcaClient.buildCommandMessage(Command.REMOVE_ME_FROM_CHANNEL, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed remove me from channel attempt: " + result.body);
    }
    return result;
}

PushcaClient.getChannels = async function (filter) {
    let metaData = {};
    metaData["filter"] = filter;
    let commandWithId = PushcaClient.buildCommandMessage(Command.GET_CHANNELS, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed get channels attempt: " + result.body);
        return null;
    }
    return ChannelsResponse.fromWsResponse(result.body);
}

PushcaClient.getChannelsPublicInfo = async function (ids) {
    let metaData = {};
    metaData["ids"] = ids;
    let commandWithId = PushcaClient.buildCommandMessage(Command.GET_CHANNELS_PUBLIC_INFO, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed get channels public info attempt: " + result.body);
        return null;
    }
    return ChannelsResponse.fromWsResponse(result.body);
}

PushcaClient.markChannelAsRead = async function (channel) {
    let metaData = {};
    metaData["channel"] = channel;
    let commandWithId = PushcaClient.buildCommandMessage(Command.MARK_CHANNEL_AS_READ, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed mark channel as read attempt: " + result.body);
    }
}

PushcaClient.getImpressionStat = async function (ids) {
    let metaData = {};
    metaData["ids"] = ids;
    let commandWithId = PushcaClient.buildCommandMessage(Command.GET_IMPRESSION_STAT, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.error("Failed get impression statistic attempt: " + result.body);
        return null;
    }
    return ImpressionsResponse.fromWsResponse(result.body);
}

PushcaClient.addImpression = async function (channel, impression) {
    let metaData = {};
    metaData["channel"] = channel;
    metaData["impression"] = impression;
    let commandWithId = PushcaClient.buildCommandMessage(Command.ADD_IMPRESSION, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.log("Failed add impression attempt: " + result.body);
    }
}

PushcaClient.removeImpression = async function (channel, impression) {
    let metaData = {};
    metaData["channel"] = channel;
    metaData["impression"] = impression;
    let commandWithId = PushcaClient.buildCommandMessage(Command.REMOVE_IMPRESSION, metaData);
    let result = await PushcaClient.executeWithRepeatOnFailure(null, commandWithId)
    if (ResponseType.ERROR === result.type) {
        console.log("Failed add impression attempt: " + result.body);
    }
}

PushcaClient.sendPing = function () {
    let commandWithId = PushcaClient.buildCommandMessage(Command.PING);
    PushcaClient.ws.send(commandWithId.message);
}

window.addEventListener('beforeunload', function () {
    cleanRefreshBrokenConnectionInterval();
    if (isNotEmpty(PushcaClient.ws)) {
        PushcaClient.ws.close(1000, "leave");
    }
});


