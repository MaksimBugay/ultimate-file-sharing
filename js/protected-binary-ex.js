
function initDownloadLink(downloadLink, href) {
    downloadLink.rel = 'noopener noreferrer';
    downloadLink.href = href;
    //downloadLink.target = '_blank';
}

if (isEmbeddedBrowser()) {
    document.querySelector('.login-container').remove();
    contentContainer.style.display = "block";
    const href = window.location.href;
    if (/Android/i.test(navigator.userAgent)) {
        const downloadLink = document.getElementById("androidDownloadLink");

        // Remove protocol FIRST
        const noScheme = href.replace(/^https?:\/\//, '');

        initDownloadLink(
            downloadLink,
            `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`
        );
        document.getElementById("android-instruction").style.display = "block";
    } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        const downloadLink = document.getElementById("iosDownloadLink");

        initDownloadLink(downloadLink, href);
        document.getElementById("ios-instruction").style.display = "block";
    }
}