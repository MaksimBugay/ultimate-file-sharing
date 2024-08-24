//------------------------------common functions----------------------------
function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getRandomIntInclusive(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min; //The maximum is inclusive and the minimum is inclusive
}

//--------------------------------------------------------------------------

const fileSharingManagerUrl = chrome.runtime.getURL("html/file-sharing-manager.html");
let fileSharingManagerTabId = null;

chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL ||
        details.reason === chrome.runtime.OnInstalledReason.UPDATE ||
        details.reason === chrome.runtime.OnInstalledReason.RELOAD) {
        openFileSharingManagerIfNotExists();
    }
});

chrome.runtime.onStartup.addListener(() => {
    openFileSharingManagerIfNotExists();
});

chrome.runtime.onSuspend.addListener(() => {
    openFileSharingManagerIfNotExists();
});

chrome.tabs.onRemoved.addListener((tabId) => {
    fileSharingManagerTabId = null;
    openFileSharingManagerIfNotExists();
});

chrome.runtime.onConnect.addListener((port) => {
    port.onDisconnect.addListener(() => {
        openFileSharingManagerIfNotExists();
    });
});

function processWithFileSharingManager(tabIdConsumer) {
    if (fileSharingManagerTabId) {
        if (typeof tabIdConsumer === 'function') {
            tabIdConsumer(fileSharingManagerTabId);
        }
        return;
    }

    chrome.tabs.query({}, (tabs) => {
        for (let i = 0; i < tabs.length; i++) {
            if (tabs[i].url === fileSharingManagerUrl) {
                if (typeof tabIdConsumer === 'function') {
                    tabIdConsumer(tabs[i].id);
                }
                return;
            }
        }
    });
}

function openFileSharingManagerIfNotExists(makeActive) {
    if (fileSharingManagerTabId) {
        if (makeActive) {
            chrome.tabs.update(fileSharingManagerTabId, {active: true});
        }
        return;
    }
    chrome.tabs.query({}, (tabs) => {
        let existingTab = tabs.some(tab => tab.url === fileSharingManagerUrl);

        if (!existingTab) {
            delay(getRandomIntInclusive(100, 1500)).then(() => {
                if (!fileSharingManagerTabId) {
                    chrome.tabs.create({url: fileSharingManagerUrl, active: !!makeActive, index: 0}, (tab) => {
                        fileSharingManagerTabId = tab.id;
                    });
                }
            });
        } else {
            if (makeActive) {
                chrome.tabs.update(existingTab.id, {active: true});
            }
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'popup-opened') {
        openFileSharingManagerIfNotExists(true);
        delay(1000).then(() => {
            chrome.action.openPopup().then(() => {
                sendResponse({status: 'popup_opened'});
            }).catch((error) => {
                //console.error('Failed to open popup:', error);
                sendResponse({status: 'popup_failed'});
            });
        });
        return true;
    }
    if (message.action === "open-file-sharing-manager") {
        openFileSharingManagerIfNotExists();
        return false;
    }
});

//----------------------------------FILES-----------------------------------------------

//--------------------------------------------------------------------------------------


