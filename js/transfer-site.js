const FileTransfer = {};
FileTransfer.applicationId = 'DIRECT_TRANSFER';
FileTransfer.wsUrl = 'wss://secure.fileshare.ovh:31085';
FileTransfer.pingIntervalId = window.setInterval(function () {
    PushcaClient.sendPing();
}, 10000);

window.addEventListener("beforeunload", function () {
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

FileTransfer.progressBarWidget = new ProgressBarWidget(
    progressBarContainer,
    uploadProgress,
    uploadProgressPercentage
)
//====================================SELECT FILES ==============================================
const fileInput = document.getElementById('fileInput');
fileInput.removeAttribute('webkitdirectory');
fileInput.setAttribute('multiple', '');
fileInput.addEventListener('change', processSelectedFiles);

async function processSelectedFiles(event) {
    if (event.target.files && fileInput.value && event.target.files.length > 0) {
        const files = event.target.files;

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
const deviceFromArea = deviceFromImage.getBoundingClientRect();
selectFilesBtn.style.top = `${deviceFromArea.top + 30}px`;
selectFilesBtn.style.left = `${deviceFromArea.left + 50}px`;
selectFilesBtn.style.display = 'block';
selectFilesBtn.addEventListener('click', function () {
    if (!receiverVirtualHost.readOnly) {
        showErrorMsg("Receiver's virtual host was not provided", function () {
            receiverVirtualHost.focus();
        });
        return;
    }
    fileInput.click();
});

const deviceToArea = deviceToImage.getBoundingClientRect();
dropZone.style.width = `${0.86 * deviceToArea.width}px`;
dropZone.style.height = `${0.45 * deviceToArea.width}px`;
dropZone.style.top = `${deviceToArea.top + 30}px`;
dropZone.style.left = `${deviceToArea.left + 20}px`;

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
