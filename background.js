chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'get-open-tab-ids') {
        chrome.tabs.query({}, (tabs) => {
            let tabIds = tabs
                .map(tab => tab.id)
                .filter(tabId => tabId !== sender.tab.id);
            sendResponse({tabIds: tabIds});
        });
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
