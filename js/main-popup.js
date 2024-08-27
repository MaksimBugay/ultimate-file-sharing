document.addEventListener('DOMContentLoaded', function () {
    chrome.runtime.sendMessage({action: 'popup-opened'}).then(() => {
        delay(10000).then(() => window.close());
    });
});