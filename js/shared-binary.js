
const contentContainer = document.getElementById('contentContainer');
const contentText = document.getElementById('contentText');
const contentTextContainer = document.getElementById("contentTextContainer");
const contentImage = document.getElementById("contentImage");
const contentVideoPlayer = document.getElementById('contentVideoPlayer');
const downloadBtn = document.getElementById('downloadBtn');
const progressBarContainer = document.getElementById("progressBarContainer");
const progressBar = document.getElementById("downloadProgress");
const progressPercentage = document.getElementById("progressPercentage");
const errorMessage = document.getElementById('errorMessage');

function showDownloadProgress() {
    progressBarContainer.style.display = 'block';
    downloadBtn.style.display = 'none';
}
function openBlobInBrowser(blob, binaryFileName) {
    if ('text/plain' === blob.type) {
        const reader = new FileReader();
        const textDecoder = new TextDecoder("utf-8");

        reader.onload = function () {
            const resultBuffer = reader.result;

            if (resultBuffer instanceof ArrayBuffer) {
                contentText.textContent = textDecoder.decode(resultBuffer);
                contentText.style.display = 'block';
                contentTextContainer.style.display = 'block';
                contentContainer.style.display = 'block';
            } else {
                console.error("Error: Expected ArrayBuffer, but got something else");
            }
        };

        reader.readAsArrayBuffer(blob);
    } else if (playableImageTypes.includes(blob.type)) {
        const blobUrl = URL.createObjectURL(blob);
        contentImage.src = blobUrl;
        contentImage.onload = function () {
            contentContainer.style.display = 'block';
            contentImage.style.display = 'block';
            URL.revokeObjectURL(blobUrl);
        };
    } else if (isPlayableMedia(blob.type)) {
        const blobUrl = URL.createObjectURL(blob);
        const source = document.createElement('source');
        source.src = blobUrl;
        source.type = blob.type;

        contentVideoPlayer.appendChild(source);

        contentVideoPlayer.addEventListener('canplay', function () {
            contentVideoPlayer.play();
        });

        contentContainer.style.display = 'block';
        contentVideoPlayer.style.display = 'block';
    } else {
        downloadFile(blob, binaryFileName);
    }

}
