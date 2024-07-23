const wsUrl = 'wss://vasilii.prodpushca.com:30085';

let tabWithWsConnectionId = null;
let ownTabId = null;
let wsConnectionCreated = false;
let pingIntervalId = null;


function getAllOpenTabIds(tabIdsConsumer) {
    chrome.runtime.sendMessage({action: 'get-open-tab-ids', reason: 'ws-connection-exists-check'}, (response) => {
        if (response && response.tabIds) {
            ownTabId = response.senderTabId;
            if (typeof tabIdsConsumer === 'function') {
                tabIdsConsumer(response.tabIds);
            }
        }
    });
}

async function allTabsCheck(tabIds) {
    if (tabIds.length === 0) {
        return true;
    }
    let wsConnectionExists = false;

    for (let i = 0; i < tabIds.length; i++) {
        if (!wsConnectionExists) {
            const result = await tabWithWsConnectionCheck(tabIds[i]);
            if ((WaiterResponseType.SUCCESS === result.type) && result.body) {
                tabWithWsConnectionId = tabIds[i];
                wsConnectionExists = true;
            }
        }
    }

    return wsConnectionExists;
}

async function tabWithWsConnectionCheck(tabId) {
    let timeoutMs = 5000;

    let timeout = (ms) => new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout after ' + ms + ' ms')), ms);
    });

    let result;
    chrome.runtime.sendMessage({action: 'is-tab-with-ws-connection', tabId: tabId}, (response) => {
        if (response && response.withWsConnection) {
            CallableFuture.releaseWaiterIfExistsWithSuccess(tabId, true);
        } else {
            CallableFuture.releaseWaiterIfExistsWithSuccess(tabId, false);
        }
    });
    try {
        result = await Promise.race([
            CallableFuture.addToWaitingHall(tabId),
            timeout(timeoutMs)
        ]);
    } catch (error) {
        CallableFuture.waitingHall.delete(tabId);
        result = new WaiterResponse(WaiterResponseType.ERROR, error);
    }
    return result;
}

if (!wsConnectionCreated) {
    console.log('ws-connection.js running on', window.location.href);

    getAllOpenTabIds(function (tabIds) {
        //console.log('Open Tab IDs:', tabIds);
        allTabsCheck(tabIds).then(result => {
            if (result) {
                console.log("Connection to Pushca already exists");
            } else {
                console.log(`Open connection to pushca: tab id = ${ownTabId}`);
                wsConnectionCreated = true;
                tabWithWsConnectionId = ownTabId;
                openWsConnection();
            }
        });
    });

    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.message === "was-ws-connection-created") {
            sendResponse({loaded: wsConnectionCreated});
            return true;
        }

        if (request.message === "get-tab-with-ws-connection-id") {
            sendResponse({tabId: tabWithWsConnectionId});
            return true;
        }

        if (request.message === "open-ws-connection") {
            if (wsConnectionCreated) {
                console.log("Connection to Pushca already exists on page");
                sendResponse({result: 'alreadyExists'});
            } else {
                wsConnectionCreated = true;
                console.log("Connection to Pushca was added");
                openWsConnection();
                sendResponse({result: 'created'});
            }
            return true;
        }
    });
} else {
    console.log('ws-connection.js already executed on', window.location.href)
}

function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        PushcaClient.openWsConnection(
            wsUrl,
            new ClientFilter(
                "main",
                uuid.v4().toString(),
                "my-device",
                "ultimate-file-sharing-listener"
            ),
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    uuid.v4().toString(),
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            },
            function () {
                console.log("Connected to Pushca!");
                pingIntervalId = window.setInterval(function () {
                    PushcaClient.sendPing();
                }, 30000);
            },
            function (ws, event) {
                window.clearInterval(pingIntervalId);
                if (!event.wasClean) {
                    console.error("Your connection died, refresh the page please");
                }
            },
            function (ws, messageText) {
                if (messageText !== "PONG") {
                    console.log(messageText);
                }
            },
            function (channelEvent) {
                //console.log(channelEvent);
            },
            function (channelMessage) {
                //console.log(channelMessage);
            },
            function (binary) {
                //console.log(binary.length)
            }
        );
    }
}

