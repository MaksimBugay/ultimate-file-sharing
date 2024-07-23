const wsUrl = 'wss://vasilii.prodpushca.com:30085/';

let wsConnectionCreated = false;
let pingIntervalId = null;


function getAllOpenTabIds(tabIdsConsumer) {
    chrome.runtime.sendMessage({action: 'get-open-tab-ids'}, (response) => {
        if (response && response.tabIds) {
            if (typeof tabIdsConsumer === 'function') {
                tabIdsConsumer(response.tabIds);
            }
        }
    });
}

async function allTabsCheck(tabIds) {
    let wsConnectionExists = false;

    for (let i = 0; i < tabIds.length; i++) {
        if (!wsConnectionExists) {
            const result = await tabWithWsConnectionCheck(tabIds[i]);
            if ((ResponseType.SUCCESS === result.type) && result.body) {
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
            PushcaClient.releaseWaiterIfExists(tabId, true);
        } else {
            PushcaClient.releaseWaiterIfExists(tabId, false);
        }
    });
    try {
        result = await Promise.race([
            PushcaClient.addToWaitingHall(tabId),
            timeout(timeoutMs)
        ]);
    } catch (error) {
        PushcaClient.waitingHall.delete(tabId);
        result = new WaiterResponse(ResponseType.ERROR, error);
    }
    return result;
}

if (!(document.getElementById('wsConnectionScript'))) {
    const loaded = document.createElement('div');
    loaded.id = 'wsConnectionScript';
    loaded.style.display = 'none';
    document.body.appendChild(loaded);
    console.log('ws-connection.js running on', window.location.href);

    getAllOpenTabIds(function (tabIds) {
        //console.log('Open Tab IDs:', tabIds);
        allTabsCheck(tabIds).then(result => {
            if (result) {
                console.log("Connection to Pushca already exists");
            } else {
                console.log("Open connection to pushca");
                wsConnectionCreated = true;
                //TODO open ws connection here
            }
        });
    });

    chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
        if (request.message === "was-ws-connection-created") {
            sendResponse({loaded: wsConnectionCreated});
            return true;
        }

        if (request.message === "open-ws-connection") {
            if (wsConnectionCreated) {
                console.log("Connection to Pushca already exists");
                sendResponse({result: 'alreadyExists'});
            } else {
                wsConnectionCreated = true;
                console.log("Connection to Pushca was added");
                //TODO open ws connection here

                sendResponse({result: 'created'});
            }
            return true;
        }
    });
} else {
    console.log('ws-connection.js already executed on', window.location.href)
}

