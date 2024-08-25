document.addEventListener('DOMContentLoaded', function () {
    chrome.runtime.sendMessage({action: 'popup-opened'}).then(() => {
        delay(100).then(() => window.close());
    });
});