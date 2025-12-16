
document.addEventListener('DOMContentLoaded', function () {
    if (isEmbeddedBrowser()) {
        document.querySelector('.login-container').remove();
        contentContainer.style.display = "block";
        const href = window.location.href;
        if (/Android/i.test(navigator.userAgent)) {
            const downloadLink = document.getElementById("androidDownloadLink");

            // Remove protocol FIRST
            const noScheme = href.replace(/^https?:\/\//, '');
            downloadLink.href = `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;end`;
            document.getElementById("android-instruction").style.display = "block";
        } else if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
            const downloadLink = document.getElementById("iosDownloadLink");
            downloadLink.rel = 'noopener noreferrer';
            downloadLink.href = href;
            document.getElementById("ios-instruction").style.display = "block";
        }
    } else {
        const miscHeader = document.querySelector(".misc-header");
        if (miscHeader) {
            miscHeader.addEventListener("click", function () {
                const container = document.getElementById("miscContainer");
                const hideShowContentDetailsCaption = document.getElementById("hideShowContentDetailsCaption");
                hideShowContentDetailsCaption.innerText = "Hide content details";
                container.classList.toggle("open");
            });
        }
    }
});