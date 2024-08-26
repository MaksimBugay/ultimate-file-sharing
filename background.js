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

//const fileSharingManagerUrl = chrome.runtime.getURL("html/file-sharing-manager.html");
const fileSharingManagerUrl = 'https://vasilii.prodpushca.com:30443/html/file-sharing-manager.html';
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

chrome.tabs.onCreated.addListener((actionTab) => {
    closeFileManagerTabIfExists(actionTab.id, actionTab.url);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, actionTab) => {
    closeFileManagerTabIfExists(tabId, changeInfo.url);
});

function closeFileManagerTabIfExists(tabId, tabUrl) {
    if (!tabUrl) {
        return;
    }
    if (tabUrl !== fileSharingManagerUrl) {
        return;
    }
    chrome.tabs.query({}, (tabs) => {
        let existingTab = tabs.find(tab => (tab.url === fileSharingManagerUrl) && (tab.id !== tabId));
        if (existingTab) {
            console.log(`Existing tab id = ${existingTab.id}`);
            chrome.tabs.remove(tabId);
            fileSharingManagerTabId = existingTab.id;
            chrome.tabs.update(existingTab.id, {active: true});
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
});

