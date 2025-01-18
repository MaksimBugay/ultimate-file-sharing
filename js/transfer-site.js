const FileTransfer = {};
FileTransfer.applicationId = 'DIRECT_TRANSFER';
FileTransfer.wsUrl = 'wss://secure.fileshare.ovh:31085';
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

FileTransfer.progressBarWidget = new ProgressBarWidget(
    progressBarContainer,
    uploadProgress,
    uploadProgressPercentage
);

function reBindControls() {
    if (isMobile()) {
        dropZone.style.display = 'none';
        const deviceToArea = deviceToImage.getBoundingClientRect();
        dropZone.style.width = `${0.86 * deviceToArea.width}px`;
        dropZone.style.height = `${0.45 * deviceToArea.width}px`;
        dropZone.style.top = `${deviceToArea.top + 20}px`;
        dropZone.style.left = `${deviceToArea.left + 13}px`;
        dropZone.style.display = 'block';

        selectFilesBtn.style.display = 'none';
        deviceFromImage.src = 'images/device1-mobile.png';
        const deviceFromArea = deviceFromImage.getBoundingClientRect();
        selectFilesBtn.style.top = `${deviceFromArea.top + 30}px`;
        selectFilesBtn.style.left = `${deviceFromArea.left + 40}px`;
        selectFilesBtn.style.display = 'block';
    } else {
        selectFilesBtn.style.display = 'none';
        deviceFromImage.src = 'images/device1.png';
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

delay(100).then(() => {
    reBindControls();
});
window.addEventListener('load', function () {
    FileTransfer.observer = new ResizeObserver(() => {
        reBindControls();
    });

    FileTransfer.observer.observe(destinationContainer);
});

window.addEventListener('resize', function () {
    reBindControls();
});

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
    for (let i = 0; i < files.length; i++) {
        await TransferFileHelper.transferFileToVirtualHostBase(
            files[i],
            receiverVirtualHost.value,
            ownerVirtualHost.value,
            "Failed file transfer attempt: receiver is not unavailable",
            FileTransfer
        );
    }
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
        PushcaClient.connectionAliasLookup(event.target.value).then(clientWithAlias => {
            if (clientWithAlias) {
                FileTransfer.isUpdatingProgrammatically = true;
                event.target.setAttribute('readonly', true);
                event.target.classList.add('embedded-link');
                event.target.classList.add('green-text');
                event.target.value = clientWithAlias.alias;
                FileTransfer.isUpdatingProgrammatically = false;
                dropZone.classList.remove('disabled-zone');
                destinationHint.style.display = 'none';
            }
        });
    }
});

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

async function openWsConnection(deviceFpId) {
    FileTransfer.deviceFpId = deviceFpId;
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
