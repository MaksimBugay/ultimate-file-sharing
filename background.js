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

function openFileSharingManagerIfNotExists() {
    if (fileSharingManagerTabId) {
        return;
    }
    chrome.tabs.query({}, (tabs) => {
        let pageExists = tabs.some(tab => tab.url === fileSharingManagerUrl);

        if (!pageExists) {
            delay(getRandomIntInclusive(100, 1500)).then(() => {
                if (!fileSharingManagerTabId) {
                    chrome.tabs.create({url: fileSharingManagerUrl, active: false, index: 0}, (tab) => {
                        fileSharingManagerTabId = tab.id;
                    });
                }
            });
        }
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "open-file-sharing-manager") {
        openFileSharingManagerIfNotExists();
        return false;
    }
    if (message.action === "save-file") {
        chrome.downloads.download({
            url: message.url,
            filename: message.fileName,  // change the filename and extension as needed
            conflictAction: 'overwrite',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                sendResponse({status: "error", message: chrome.runtime.lastError.message});
            } else {
                sendResponse({status: "success", downloadId: downloadId});
            }
        });

        return true;
    }
});

//----------------------------------FILES-----------------------------------------------

//--------------------------------------------------------------------------------------


