//------------------------------common functions----------------------------
function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

//--------------------------------------------------------------------------

let wsConnectionExistsCheckAlreadyExecuted = false;
let tabWithWsConnectionId = null;

chrome.runtime.onInstalled.addListener(() => {
    injectConnectionToPushca(null);
});

chrome.runtime.onStartup.addListener(() => {
    injectConnectionToPushca(null);
});
chrome.tabs.onRemoved.addListener((tabId) => {
    wsConnectionExistsCheckAlreadyExecuted = false;
    injectConnectionToPushca(tabId);
});

delay(5000).then(() => {
    getTabWithWsConnectionId(function (tabId) {
        console.log(`Tab with ws connection id = ${tabId}`);
    })
})

function getTabWithWsConnectionId(tabIdConsumer) {
    if (tabWithWsConnectionId) {
        if (typeof tabIdConsumer === 'function') {
            tabIdConsumer(tabWithWsConnectionId);
        }
        return;
    }

    chrome.tabs.query({}, (tabs) => {
        for (let i = 0; i < tabs.length; i++) {
            chrome.tabs.sendMessage(tabs[i].id, {
                message: "get-tab-with-ws-connection-id"
            }, response => {
                if (chrome.runtime.lastError) {
                    //console.error(`Free comments tab is not activated: ${chrome.runtime.lastError}`);
                } else if (response && response.tabId) {
                    tabWithWsConnectionId = response.tabId;
                    if (typeof tabIdConsumer === 'function') {
                        tabIdConsumer(tabWithWsConnectionId);
                    }
                }
            });
        }
    });
}

function injectConnectionToPushca(excludedTabId) {
    chrome.tabs.query({}, (tabs) => {
        for (let i = 0; i < tabs.length; i++) {
            if (tabs[i].id !== excludedTabId) {
                chrome.tabs.sendMessage(tabs[i].id, {
                    message: "open-ws-connection"
                }, response => {
                    if (chrome.runtime.lastError) {
                        console.log(`Reload page: tab url ${tabs[i].url}`);
                        chrome.scripting.executeScript({
                            target: {tabId: tabs[i].id},
                            files: [
                                "js/uuid.min.js",
                                "js/common-utils.js",
                                "js/callable-future.js",
                                "js/pnotifications.js",
                                "js/ws-connection.js"
                            ]
                        });
                    } else if (response && response.result) {
                        console.log(`Inject ws connection: tab url ${tabs[i].url}, result ${response.result}`);
                    } else {
                        console.log(`Cannot inject ws connection: empty response`);
                    }
                });
                break;
            }
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'get-open-tab-ids') {
        if ((message.reason === 'ws-connection-exists-check') && wsConnectionExistsCheckAlreadyExecuted) {
            sendResponse({tabIds: []});
        } else {
            chrome.tabs.query({}, (tabs) => {
                let tabIds = tabs
                    .map(tab => tab.id)
                    .filter(tabId => tabId !== sender.tab.id);
                sendResponse({tabIds: tabIds, senderTabId: sender.tab.id});
            });
            if (message.reason === 'ws-connection-exists-check') {
                wsConnectionExistsCheckAlreadyExecuted = true;
            }
        }
        return true; // Indicate that the response will be sent asynchronously
    }

    if (message.action === 'is-tab-with-ws-connection') {
        let withWsConnection = false;
        chrome.tabs.sendMessage(message.tabId, {
            message: "was-ws-connection-created"
        }, response => {
            if (chrome.runtime.lastError) {
                //console.error(`Free comments tab is not activated: ${chrome.runtime.lastError}`);
            } else if (response && response.loaded) {
                withWsConnection = true;
            }
            sendResponse({withWsConnection: withWsConnection});
        });
        return true; // Indicate that the response will be sent asynchronously
    }
});


