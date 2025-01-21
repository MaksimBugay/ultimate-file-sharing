const FileTransfer = {};
FileTransfer.applicationId = 'DIRECT_TRANSFER';
FileTransfer.wsUrl = 'wss://secure.fileshare.ovh:31085';
FileTransfer.scanQrCodeWaiterId = 'scan-qr-code-result';
FileTransfer.pingIntervalId = window.setInterval(function () {
    PushcaClient.sendPing();
}, 10000);

window.addEventListener("beforeunload", function () {
    FileTransfer.observer.disconnect();
    clearInterval(pingIntervalId);
});

const selectFilesBtn = document.getElementById('selectFilesBtn');
const ownerVirtualHost = document.getElementById('ownerVirtualHost');
const deviceFromImage = document.getElementById('deviceFromImage');
const dropZone = document.getElementById('dropZone');
const deviceToImage = document.getElementById('deviceToImage');
const receiverVirtualHost = document.getElementById('receiverVirtualHost');
const progressBarContainer = document.getElementById('progressBarContainer');
const uploadProgress = document.getElementById('uploadProgress');
const uploadProgressPercentage = document.getElementById('uploadProgressPercentage');
const destinationHint = document.getElementById('destinationHint');
const destinationContainer = document.getElementById('destinationContainer');

const fileTransferBtn = document.getElementById('fileTransferBtn');
const fileTransferProgressBtn = document.getElementById('fileTransferProgressBtn');

FileTransfer.progressBarWidget = new ProgressBarWidget(
    progressBarContainer,
    uploadProgress,
    uploadProgressPercentage
);

FileTransfer.reBindControls = function (force = false) {
    if (dropZone.style.display === 'none') {
        if (!force) {
            return;
        }
    }
    if (isMobile()) {
        dropZone.style.display = 'none';
        const deviceToArea = deviceToImage.getBoundingClientRect();
        dropZone.style.width = `${0.86 * deviceToArea.width}px`;
        dropZone.style.height = `${0.45 * deviceToArea.width}px`;
        dropZone.style.top = `${deviceToArea.top + 20}px`;
        dropZone.style.left = `${deviceToArea.left + 13}px`;
        dropZone.style.display = 'block';

        selectFilesBtn.style.display = 'none';
        const deviceFromArea = deviceFromImage.getBoundingClientRect();
        selectFilesBtn.style.top = `${deviceFromArea.top + 30}px`;
        selectFilesBtn.style.left = `${deviceFromArea.left + 40}px`;
        selectFilesBtn.style.display = 'block';
    } else {
        selectFilesBtn.style.display = 'none';
        const deviceToArea = deviceToImage.getBoundingClientRect();
        dropZone.style.width = `${0.86 * deviceToArea.width}px`;
        dropZone.style.height = `${0.45 * deviceToArea.width}px`;
        dropZone.style.top = `${deviceToArea.top + 30}px`;
        dropZone.style.left = `${deviceToArea.left + 20}px`;
        dropZone.style.display = 'block';

        selectFilesBtn.style.display = 'none';
        const deviceFromArea = deviceFromImage.getBoundingClientRect();
        selectFilesBtn.style.top = `${deviceFromArea.top + 50}px`;
        selectFilesBtn.style.left = `${deviceFromArea.left + 70}px`;
        selectFilesBtn.style.display = 'block';
    }
}

window.addEventListener('load', function () {
    if (isMobile()) {
        deviceFromImage.src = 'images/device1-mobile.png';
    } else {
        deviceFromImage.src = 'images/device1.png';
    }
    FileTransfer.observer = new ResizeObserver(() => {
        FileTransfer.reBindControls();
    });

    FileTransfer.observer.observe(destinationContainer);
});

window.addEventListener('resize', function () {
    FileTransfer.reBindControls();
});

//==================================== Copy paste ======================================================================
const toolBarPasteArea = document.getElementById("toolBarPasteArea");

function hasFileExtension(fileName) {
    return /\.[a-zA-Z0-9]+$/.test(fileName); // Matches .extension at the end of the string
}

function getCopyPastName(mimeType, blobName) {
    if (hasFileExtension(blobName)) {
        return blobName;
    }
    let ext = "";
    if (mimeType.includes('png')) {
        ext = '.png';
    }
    if (mimeType.includes('bmp')) {
        ext = '.bmp';
    }
    const prefix = blobName ? blobName : 'binary';
    return `${prefix}-${new Date().getTime()}${ext}`
}

toolBarPasteArea.addEventListener('paste', async function (event) {
    const clipboardItems = event.clipboardData.items;

    event.stopPropagation();
    event.preventDefault();

    for (let item of clipboardItems) {
        // Check if the clipboard item is a file (binary data)
        if (item.kind === 'file') {
            const blob = item.getAsFile();
            console.log('item.getAsFile');
            console.log(blob);
            const mimeType = blob.type;
            const name = getCopyPastName(mimeType, blob.name);
            await TransferFileHelper.transferBlobToVirtualHostBase(
                blob, name, blob.type,
                receiverVirtualHost.value,
                ownerVirtualHost.value,
                FileTransfer
            );
        } else if (item.kind === 'string') {
            const mimeType = 'text/plain';
            const name = `text-message-${new Date().getTime()}.txt`;
            item.getAsString((pasteText) => {
                const text = DOMPurify.sanitize(pasteText);
                if (isNotEmpty(text)) {
                    const textBlob = new Blob([text], {type: mimeType});
                    TransferFileHelper.transferBlobToVirtualHostBase(
                        textBlob, name, textBlob.type,
                        receiverVirtualHost.value,
                        ownerVirtualHost.value,
                        FileTransfer
                    );
                }
            });
        }
    }
});

document.addEventListener('mousemove', (event) => {
    if (!receiverVirtualHost.readOnly) {
        return;
    }
    if (toolBarPasteArea && document.activeElement === toolBarPasteArea) {
        return;
    }
    if (toolBarPasteArea) {
        toolBarPasteArea.focus();
    }
});

//==================================== Show owner QR code ==============================================================
const ownerQrCodeBtn = document.getElementById('ownerQrCodeBtn');
const infoDialog = document.getElementById("infoDialog");
const closeInfoBtn = document.getElementById("closeInfoBtn");

function isInfoDialogVisible() {
    return infoDialog.classList.contains('visible');
}

function closeInfoDialog() {
    infoDialog.classList.remove('visible');
}

function showInfoDialog() {
    infoDialog.classList.add('visible');
}

closeInfoBtn.addEventListener('click', function () {
    closeInfoDialog();
});


function showInfoMsg(msg, url = null) {
    infoMsg.textContent = msg;
    const qrCodeContainer = document.getElementById('qrcode');
    if (url && qrCodeContainer) {
        qrCodeContainer.innerHTML = '';
        QRCode.toDataURL(url, {width: 200, height: 200}, (err, url) => {
            if (err) {
                console.error('Failed to generate QR code:', err);
                return;
            }
            const img = document.createElement('img');
            img.src = url;
            qrCodeContainer.appendChild(img);
        });
    }
    showInfoDialog();
}

ownerQrCodeBtn.addEventListener('click', function () {
    if (ownerVirtualHost.value) {
        ownerQrCodeBtn.blur();
        showInfoMsg("Use our website on the sender's side to scan this code", ownerVirtualHost.value);
    }
});

//====================================Scan QR code======================================================================
const scanQrCodeBtn = document.getElementById('scanQrCodeBtn');
const qrCodeScannerDialog = document.getElementById('qrCodeScannerDialog');
const closeQrScannerBtn = document.getElementById('closeQrScannerBtn');
const qrScanBtn = document.getElementById('qrScanBtn');

qrScanBtn.style.display = 'none';

qrScanBtn.addEventListener('click', function () {
    video.play()
        .then(() => console.log('Video is playing'))
        .catch(err => console.error('Error trying to play video:', err));
});

function isQrCodeScannerDialog() {
    return qrCodeScannerDialog.classList.contains('visible');
}

function closeQrCodeScannerDialog() {
    qrScanBtn.style.display = 'none';
    resultElement.textContent = 'None'
    stopQRScanner();
    qrCodeScannerDialog.classList.remove('visible');
}

async function showQrCodeScannerDialog() {
    qrCodeScannerDialog.classList.add('visible');
    await startQRScanner();
}

closeQrScannerBtn.addEventListener('click', function () {
    closeQrCodeScannerDialog();
});
scanQrCodeBtn.addEventListener('click', async function () {
    const result = await CallableFuture.callAsynchronously(
        120_000,
        FileTransfer.scanQrCodeWaiterId,
        function () {
            showQrCodeScannerDialog();
        }
    );
    if (WaiterResponseType.SUCCESS === result.type) {
        FileTransfer.receiverVirtualHost = result.body;
        console.log(`Receiver virtual host ${FileTransfer.receiverVirtualHost}`);
        performReceiverAliasLookup(receiverVirtualHost, FileTransfer.receiverVirtualHost)
    } else {
        console.warn("Failed attempt to scan receiver virtual host name");
    }
});

FileTransfer.videoWasStartedWaiterId = 'video-was-started';
const video = document.getElementById('video');
const resultElement = document.getElementById('result');

video.addEventListener('play', () => {
    CallableFuture.releaseWaiterIfExistsWithSuccess(
        FileTransfer.videoWasStartedWaiterId,
        true
    );
});

async function startQRScanner() {
    try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', {willReadFrequently: true});

        // Request camera access
        video.srcObject = await navigator.mediaDevices.getUserMedia(
            {
                video: {
                    //frameRate: {ideal: 60, max: 60},
                    facingMode: 'environment'
                }
            }
        );

        let result = await CallableFuture.callAsynchronously(
            5000,
            FileTransfer.videoWasStartedWaiterId,
            () => console.log("Waiting for video stream")
        );

        let manualStartRequired = false;
        if (WaiterResponseType.ERROR === result.type) {
            try {
                await video.play();
                console.log('Video play was forced');
            } catch (err) {
                if (err.message && err.message.includes('can only be initiated by a user gesture')) {
                    manualStartRequired = true;
                    qrScanBtn.style.display = 'block';
                    showErrorMsg(
                        "Autoplay is not allowed, press scan button manually",
                        null
                    );
                } else {
                    showErrorMsg(
                        'To use the QR scanner, please open this page in a standard web browser like Chrome, Firefox, Opera etc.',
                        closeQrCodeScannerDialog
                    );
                    return;
                }
            }
        }

        if (manualStartRequired) {
            result = await CallableFuture.callAsynchronously(
                10_000,
                FileTransfer.videoWasStartedWaiterId,
                () => console.log("Waiting for video stream")
            );
            if (WaiterResponseType.ERROR === result.type) {
                return;
            }
        }
        // Continuously scan video frames
        const scan = () => {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                // Process the image for QR code
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const qrCode = jsQR(imageData.data, imageData.width, imageData.height);

                if (qrCode) {
                    resultElement.textContent = qrCode.data; // Display the scanned string
                    CallableFuture.releaseWaiterIfExistsWithSuccess(
                        FileTransfer.scanQrCodeWaiterId,
                        qrCode.data
                    )
                    delay(2000).then(() => {
                        closeQrCodeScannerDialog();
                    });
                }
            }
            requestAnimationFrame(scan);
        };

        scan(); // Start scanning
    } catch (error) {
        console.error('Error accessing camera:', error);
        showErrorMsg('Unable to access the camera. Please check permissions and try again.',
            closeQrCodeScannerDialog);
    }
}

function stopQRScanner() {
    const stream = video.srcObject;
    if (stream) {
        const tracks = stream.getTracks();
        tracks.forEach(track => track.stop()); // Stop all video tracks
    }
    video.srcObject = null;
}

//====================================Drag and Drop files===============================================================
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function initDropZone(dzElement) {
// Prevent default behavior for drag and drop events (to prevent opening the file in the browser)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dzElement.addEventListener(eventName, preventDefaults, false);
    });

// Add visual feedback for when file is being dragged over the drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
        dzElement.addEventListener(eventName, () => dzElement.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dzElement.addEventListener(eventName, () => dzElement.classList.remove('dragover'), false);
    });
}

initDropZone(dropZone);

dropZone.addEventListener('drop', async function (event) {
    await processSelectedFiles(event.dataTransfer.files);
    delay(500).then(() => {
        event.dataTransfer.clearData();
    });
});
//====================================SELECT FILES =====================================================================
const fileInput = document.getElementById('fileInput');
fileInput.removeAttribute('webkitdirectory');
fileInput.setAttribute('multiple', '');
fileInput.addEventListener('change', async function (event) {
    if (event.target.files && fileInput.value && event.target.files.length > 0) {
        const files = event.target.files;
        await processSelectedFiles(files);
    }
});

async function processSelectedFiles(files) {
    if (!receiverVirtualHost.readOnly) {
        showErrorMsg("Receiver's virtual host was not provided", function () {
            receiverVirtualHost.focus();
        });
        return;
    }

    fileTransferBtn.style.display = 'none';
    fileTransferProgressBtn.style.display = 'block';
    selectFilesBtn.style.display = 'none';
    dropZone.style.display = 'none';
    let i = 0;
    FileTransfer.extraProgressHandler = function () {
        i += 1;
        if (i % 5 === 0) {
            if (fileTransferProgressBtn.style.transform === 'scale(0.95)') {
                fileTransferProgressBtn.style.transform = 'scale(1.1)';
            } else {
                fileTransferProgressBtn.style.transform = 'scale(0.95)';
            }
        }
    }
    for (let i = 0; i < files.length; i++) {
        await TransferFileHelper.transferFileToVirtualHostBase(
            files[i],
            receiverVirtualHost.value,
            ownerVirtualHost.value,
            "Failed file transfer attempt: receiver is not unavailable",
            FileTransfer
        );
    }
    FileTransfer.extraProgressHandler = null;
    fileTransferBtn.style.display = 'block';
    fileTransferProgressBtn.style.display = 'none';
    FileTransfer.reBindControls(true);
}

function afterTransferDoneHandler() {
    fileInput.value = "";
    progressBarContainer.style.display = 'none';
}

//====================================ERROR DIALOG===============================================
const errorDialog = document.getElementById("errorDialog");
const errorMsg = document.getElementById("errorMsg");
const closeErrorBtn = document.getElementById("closeErrorBtn");

function showErrorMsg(msg, afterCloseHandler) {
    errorMsg.textContent = msg;
    FileTransfer.afterErrorMsgClosedHandler = afterCloseHandler;
    errorDialog.classList.add('visible');
}

closeErrorBtn.addEventListener('click', function () {
    closeErrorDialog();
});

function closeErrorDialog() {
    errorDialog.classList.remove('visible');
    if (typeof FileTransfer.afterErrorMsgClosedHandler === 'function') {
        FileTransfer.afterErrorMsgClosedHandler();
    }
}

//================================================================================
selectFilesBtn.addEventListener('click', function () {
    if (!receiverVirtualHost.readOnly) {
        showErrorMsg("Receiver's virtual host was not provided", function () {
            receiverVirtualHost.focus();
        });
        return;
    }
    fileInput.click();
});

receiverVirtualHost.focus();
document.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        if (errorDialog.classList.contains('visible')) {
            closeErrorDialog();
        } else if (isHostDetailsDialogVisible()) {
            hideHostDetailsDialog();
        } else if (isInfoDialogVisible()) {
            closeInfoDialog();
        }
    }
});

function setDeviceFromVirtualHost(alias) {
    ownerVirtualHost.value = alias;
    ownerVirtualHost.classList.add('embedded-link');
}

//===================================Receiver virtual host lookup =================================
receiverVirtualHost.addEventListener('input', (event) => {
    if (FileTransfer.isUpdatingProgrammatically) {
        return;
    }

    if (event.target.value.length > 3) {
        performReceiverAliasLookup(event.target, event.target.value);
    }
});

function performReceiverAliasLookup(subject, str) {
    PushcaClient.connectionAliasLookup(str).then(clientWithAlias => {
        if (clientWithAlias) {
            FileTransfer.isUpdatingProgrammatically = true;
            subject.setAttribute('readonly', true);
            subject.classList.add('embedded-link');
            subject.classList.add('green-text');
            subject.value = clientWithAlias.alias;
            FileTransfer.isUpdatingProgrammatically = false;
            dropZone.classList.remove('disabled-zone');
            destinationHint.style.display = 'none';
            scanQrCodeBtn.style.display = 'none';

            FileTransfer.reBindControls(true);
            toolBarPasteArea.focus();
        }
    });
}

receiverVirtualHost.addEventListener('click', showHostDetailsHandler);
//===================================Host details===================================================
ownerVirtualHost.addEventListener('click', showHostDetailsHandler);

function showHostDetailsHandler() {
    const deviceId = (this.id === 'ownerVirtualHost') ? FileTransfer.deviceFpId : null;
    const value = this.value.trim();
    if (value && this.readOnly) {
        PushcaClient.connectionAliasLookup(value).then(clientWithAlias => {
            if (clientWithAlias) {
                showHostDetailsDialog(deviceId, clientWithAlias);
            }
        });
    }
}

const hostDetailsDialog = document.getElementById('hostDetailsDialog');
const hdCloseBtn = document.getElementById('hdCloseBtn');
const hdDeviceId = document.getElementById('hdDeviceId');
const hdVirtualHostName = document.getElementById('hdVirtualHostName');
const hdCity = document.getElementById('hdCity');
const hdProxyInfo = document.getElementById('hdProxyInfo');
const hdIP = document.getElementById('hdIP');
const hdCountry = document.getElementById('hdCountry');

hdCloseBtn.addEventListener('click', function () {
    hideHostDetailsDialog();
});

function isHostDetailsDialogVisible() {
    return hostDetailsDialog.classList.contains('visible');
}

function hideHostDetailsDialog() {
    hostDetailsDialog.classList.remove('visible');
}

function showHostDetailsDialog(deviceId, connectionDetails) {
    hdDeviceId.textContent = deviceId ? deviceId : '-';
    hdVirtualHostName.textContent = connectionDetails.alias;
    hdIP.textContent = connectionDetails.ip;
    hdCountry.innerHTML = connectionDetails.countryCode ?
        getCountryWithFlagInnerHtml(connectionDetails.countryCode, connectionDetails.countryName) : null;
    hdCity.textContent = connectionDetails.city;
    hdProxyInfo.textContent = connectionDetails.proxyInfo ? connectionDetails.proxyInfo : '-';

    hostDetailsDialog.classList.add('visible');
}

//=====================================================================================================
//=============Device ID and WS connection ============================================================
FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openWsConnection(result.visitorId);
    });
});

PushcaClient.onCloseHandler = function (ws, event) {
    if (!event.wasClean) {
        console.log(event);
        console.error(`Your connection died with exit code ${event.code}, refresh the page please`);
    }
    setDeviceFromVirtualHost(null);
    //channelIndicator.style.backgroundColor = 'red';
};

PushcaClient.onFileTransferChunkHandler = async function (binaryWithHeader) {
    return await TransferFileHelper.processedReceivedChunk(binaryWithHeader, FileTransfer);
};

async function openWsConnection(deviceFpId) {
    FileTransfer.deviceFpId = deviceFpId;
    setOriginatorVirtualHostClickHandler(FileTransfer.deviceFpId);
    if (!PushcaClient.isOpen()) {
        FileTransfer.sessionId = uuid.v4().toString();
        FileTransfer.deviceFpHash = await calculateSha256(stringToArrayBuffer(deviceFpId));
        const pClient = new ClientFilter(
            `${calculateStringHashCode(deviceFpId)}`,
            "anonymous-sharing",
            JSON.stringify({fp: FileTransfer.deviceFpHash, session: FileTransfer.sessionId}),
            FileTransfer.applicationId
        );

        const result = await CallableFuture.callAsynchronously(
            10_000,
            `${pClient.hashCode()}`,
            function () {
                PushcaClient.openWsConnection(
                    FileTransfer.wsUrl,
                    pClient,
                    function (clientObj) {
                        const refreshedClientFilter = new ClientFilter(
                            clientObj.workSpaceId,
                            clientObj.accountId,
                            clientObj.deviceId,
                            clientObj.applicationId
                        );
                        delay(100).then(() => {
                            CallableFuture.callAsynchronously(
                                4_000,
                                `${refreshedClientFilter.hashCode()}`,
                                function () {
                                    console.log(`Connection refresh was requested for client with hash code ${refreshedClientFilter.hashCode()}`);
                                }
                            ).then(aResult => {
                                if (WaiterResponseType.SUCCESS === aResult.type) {
                                    FileTransfer.connectionAlias = aResult.body;
                                    console.log(`Connection alias = ${FileTransfer.connectionAlias}`);
                                    setDeviceFromVirtualHost(FileTransfer.connectionAlias);
                                } else {
                                    console.warn("Failed attempt to get connection alias");
                                }
                            });
                        });
                        return refreshedClientFilter;
                    }
                );
            }
        );
        if (WaiterResponseType.SUCCESS === result.type) {
            FileTransfer.connectionAlias = result.body;
            console.log(`Connection alias = ${FileTransfer.connectionAlias}`);
        } else {
            console.warn("Failed attempt to get connection alias");
        }
        if (FileTransfer.connectionAlias) {
            const clientWithAlias = await PushcaClient.connectionAliasLookup(FileTransfer.connectionAlias);
            //showHostDetailsDialog(FileTransfer.deviceFpId, clientWithAlias);
            console.log(clientWithAlias);
            setDeviceFromVirtualHost(clientWithAlias.alias);
        }
    }
}

//=====================================================================================================
