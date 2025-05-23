console.log('ws-connection.js running on', window.location.href);

class FileshareProperties {
    constructor(transferGroup, transferGroupPassword) {
        this.transferGroup = transferGroup;
        this.transferGroupPassword = transferGroupPassword;
    }

    getTransferApplicationId() {
        if (!this.transferGroup) {
            return Fileshare.noTransferGroupApplicationId;
        }
        return `TRANSFER_GROUP_${calculateStringHashCode(this.transferGroup)}`
    }

    setTransferGroup(group) {
        this.transferGroup = group;
    }

    setTransferGroupPassword(transferGroupPassword) {
        this.transferGroupPassword = transferGroupPassword;
    }

    toJSON() {
        return {
            transferGroup: this.transferGroup,
            transferGroupPassword: this.transferGroupPassword
        };
    }

    static fromObject(jsonObject) {
        return new FileshareProperties(
            jsonObject.transferGroup,
            jsonObject.transferGroupPassword
        );
    }

    static fromJSON(jsonString) {
        const jsonObject = typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString;
        return this.fromObject(jsonObject);
    }
}

const Fileshare = {};
Fileshare.noTransferGroupApplicationId = "ultimate-file-sharing";
Fileshare.wakeLock = null;
Fileshare.defaultReadMeText = "Default description";

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('tg-host') && urlParams.get('tg-session')) {
    Fileshare.transferGroupHostValue = decodeURIComponent(urlParams.get('tg-host'));
    Fileshare.transferGroupSessionValue = decodeURIComponent(urlParams.get('tg-session'));
}


const howToButton = document.getElementById("howToButton");
const privacyButton = document.getElementById('privacyButton');
const statusCaption = document.getElementById("statusCaption");
const channelIndicator = document.getElementById("channelIndicator");
const addBinaryButton = document.getElementById("addBinaryButton");
const recordVideoButton = document.getElementById("recordVideoButton");
const recordAudioButton = document.getElementById("recordAudioButton");
const pastFromBufferButton = document.getElementById("pastFromBufferButton")
const textMessageButton = document.getElementById('textMessageButton');
const transferFileButton = document.getElementById("transferFileButton");
const joinTransferGroupBtn = document.getElementById("joinTransferGroupBtn");
const generateStrongGroup = document.getElementById('generateStrongGroup');
const leaveTransferGroupBtn = document.getElementById("leaveTransferGroupBtn");
const copyJoinTransferGroupLinkBtn = document.getElementById("copyJoinTransferGroupLinkBtn");
const transferGroupName = document.getElementById("transferGroupName");
const transferGroupPasswordInput = document.getElementById("transferGroupPasswordInput");
const transferGroupNavBarItem = document.getElementById("transferGroupNavBarItem");
const virtualHostNavBarItem = document.getElementById('virtualHostNavBarItem');
const errorDialog = document.getElementById("errorDialog");
const errorMsg = document.getElementById("errorMsg");
const closeErrorBtn = document.getElementById("closeErrorBtn");
const infoDialog = document.getElementById("infoDialog");
const infoMsg = document.getElementById("infoMsg");
const closeInfoBtn = document.getElementById("closeInfoBtn");
const showSharedContentManagerBtn = document.getElementById("showSharedContentManagerBtn");
const fileManagerContainer = document.getElementById("fileManagerContainer");
const toolbarNavContainer = document.getElementById('toolbarNavContainer');
const selectFileBtn = document.getElementById("selectFileBtn");

const hostDetailsDialog = document.getElementById('hostDetailsDialog');
const hdCloseBtn = document.getElementById('hdCloseBtn');
const hdDeviceId = document.getElementById('hdDeviceId');
const hdVirtualHostName = document.getElementById('hdVirtualHostName');
const hdCity = document.getElementById('hdCity');
const hdProxyInfo = document.getElementById('hdProxyInfo');
const hdIP = document.getElementById('hdIP');
const hdCountry = document.getElementById('hdCountry');

Fileshare.progressBarWidget = new ProgressBarWidget(
    mmProgressBarContainer,
    mmDownloadProgress,
    mmProgressPercentage
);
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

leaveTransferGroupBtn.disabled = true;
copyJoinTransferGroupLinkBtn.disabled = true;
Fileshare.afterErrorMsgClosedHandler = function () {
}

showSharedContentManagerBtn.addEventListener('click', function () {
    const thirdTube = document.getElementById("thirdTube");
    if (fileManagerContainer.classList.contains('show')) {
        if (thirdTube) {
            thirdTube.style.display = 'block';
        }
        showSharedContentManagerBtn.textContent = 'Open Shared content manager';
    } else {
        if (thirdTube) {
            thirdTube.style.display = 'none';
        }
        showSharedContentManagerBtn.textContent = 'Hide Shared content manager';
    }
});

const toolBarPasteArea = document.getElementById("toolBarPasteArea");
toolBarPasteArea.addEventListener('paste', async function (event) {
    const clipboardItems = event.clipboardData.items;

    for (let item of clipboardItems) {
        // Check if the clipboard item is a file (binary data)
        if (item.kind === 'file') {
            const blob = item.getAsFile();
            const mimeType = blob.type;
            const name = getCopyPastName(mimeType, blob.name);
            openModal(ContentType.COPY_PAST);
            await SaveInCloudHelper.cacheBlobInCloud(
                name,
                mimeType,
                Fileshare.defaultReadMeText,
                blob,
                true,
                false,
                null);
            delay(500).then(() => {
                closeModal();
            });
        } else {
            event.stopPropagation();
            event.preventDefault();
        }
    }
});

document.addEventListener('mousemove', (event) => {
    const target = event.target;

    if (!hasParentWithIdOrClass(target, ['navbar'])) {
        return;
    }
    const toolBarPasteArea = document.getElementById("toolBarPasteArea");
    if (toolBarPasteArea && document.activeElement === toolBarPasteArea) {
        return;
    }
    if (toolBarPasteArea) {
        toolBarPasteArea.focus();
    }
});

transferGroupNavBarItem.addEventListener('click', function () {
    openModal(ContentType.FILE_TRANSFER, true);
});

virtualHostNavBarItem.addEventListener('click', async function () {
    if (Fileshare.connectionAlias) {
        const clientWithAlias = await PushcaClient.connectionAliasLookup(Fileshare.connectionAlias);
        showHostDetailsDialog(Fileshare.workSpaceId, clientWithAlias);
    }
});
howToButton.addEventListener('click', function () {
    window.open('manual/secure-file-share-doc.html', '_blank');
});

privacyButton.addEventListener('click', function () {
    window.open('privacy/privacy.html', '_blank');
});

document.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
        if (infoDialog.classList.contains('visible')) {
            infoDialog.classList.remove('visible');
        } else if (errorDialog.classList.contains('visible')) {
            closeErrorDialog();
            Fileshare.errorMessageWasJustRemoved = true;
        } else if (isHostDetailsDialogVisible()) {
            hideHostDetailsDialog();
        }
    }
});
closeErrorBtn.addEventListener('click', function () {
    closeErrorDialog();
});

function closeErrorDialog() {
    errorDialog.classList.remove('visible');
    if (typeof Fileshare.afterErrorMsgClosedHandler === 'function') {
        Fileshare.afterErrorMsgClosedHandler();
    }
}

closeInfoBtn.addEventListener('click', function () {
    if (typeof Fileshare.closeQRCodeHandler === 'function') {
        Fileshare.closeQRCodeHandler();
    }
    infoDialog.classList.remove('visible');
});

function showInfoMsg(msg, url = null, name = null) {
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
        Fileshare.closeQRCodeHandler = function () {
            if (isMobile()) {
                showNativeShareDialog(name, url).then(ableToShow => {
                    if (!ableToShow) {
                        console.log('Cannot show native share dialog');
                    }
                });
            }
        }
    } else {
        Fileshare.closeQRCodeHandler = null;
    }
    infoDialog.classList.add('visible');
}

function showErrorMsg(msg, afterCloseHandler) {
    if (msg.includes("at least one key does not satisfy the uniqueness requirements")) {
        errorMsg.textContent = 'Content is already added into browser database';
    } else if (msg.includes("A mutation operation in the transaction failed because a constraint was not satisfied")) {
        errorMsg.textContent = 'Content is already added into browser database';
    } else {
        errorMsg.textContent = msg;
    }
    Fileshare.afterErrorMsgClosedHandler = afterCloseHandler;
    errorDialog.classList.add('visible');
}

const exposeWorkspaceIdCheckBoxId = "exposeWorkspaceIdCheckBox";

function updateDeviceIdCaption(id) {
    const deviceIdCaption = document.getElementById("deviceIdCaption");
    if (deviceIdCaption) {
        deviceIdCaption.textContent = `${id}`;
    }
    const deviceIdCaptionMobile = document.getElementById("deviceIdCaptionMobile");
    if (deviceIdCaptionMobile) {
        deviceIdCaptionMobile.textContent = `${id}`;
    }
}

function updateTransferGroupCaption() {
    let group = null;
    if (Fileshare.properties && Fileshare.properties.transferGroup) {
        group = Fileshare.properties.transferGroup;
    }

    const transferGroupCaption = document.getElementById("transferGroupCaption");
    if (transferGroupCaption) {
        if (group) {
            transferGroupCaption.style.display = 'block';
            transferGroupCaption.textContent = `${group}`;
        } else {
            transferGroupCaption.style.display = 'none';
        }
    }

    const transferGroupCaptionMobileHeader = document.getElementById('transferGroupCaptionMobileHeader');
    const transferGroupCaptionMobile = document.getElementById("transferGroupCaptionMobile");
    if (transferGroupCaptionMobile) {
        if (group) {
            transferGroupCaptionMobileHeader.style.display = 'block';
            transferGroupCaptionMobile.style.display = 'block';
            transferGroupCaptionMobile.textContent = `${group}`;
        } else {
            transferGroupCaptionMobile.style.display = 'none';
            transferGroupCaptionMobileHeader.style.display = 'none';
        }
    }
}

document.addEventListener("DOMContentLoaded", function () {
    if (isMobile()) {
        const thirdTube = document.getElementById("thirdTube");
        const thirdTubeTogglerBtn = document.getElementById('thirdTubeTogglerBtn');
        thirdTubeTogglerBtn.remove();
        if (thirdTube) {
            swapElements(thirdTube, document.getElementById('connectionInfo'));
            const thirdTubeNav = document.querySelector('#thirdTubeNav');
            thirdTubeNav.classList.add('show');
        }
        toolbarNavContainer.style.height = 'auto';
        const toolbarNav = document.querySelector('#toolbarNav');
        const toolbarConnectionInfo = document.getElementById("toolbarConnectionInfo");
        //swapElements(toolbarNav, toolbarConnectionInfo);

        const showSharedContentManagerBtn = document.getElementById("showSharedContentManagerBtn");
        const showSharedContentManagerMobileContainer = document.getElementById("showSharedContentManagerMobileContainer");
        showSharedContentManagerMobileContainer.appendChild(showSharedContentManagerBtn);

        if (toolbarNav) {
            toolbarNav.classList.add('show');
        }
        if (toolbarConnectionInfo) {
            toolbarConnectionInfo.classList.add('show');
        }
        const mainNavbarTogglerBtn = document.getElementById("mainNavbarTogglerBtn");
        if (mainNavbarTogglerBtn) {
            mainNavbarTogglerBtn.remove();
        }
        const connectionInfoTogglerBtn = document.getElementById("connectionInfoTogglerBtn");
        if (connectionInfoTogglerBtn) {
            connectionInfoTogglerBtn.remove();
        }

        const fastAccessToolBar = document.getElementById("fastAccessToolBar");
        if (fastAccessToolBar) {
            fastAccessToolBar.remove();
        }
        const usageWarning = document.getElementById("usageWarning");
        if (usageWarning) {
            usageWarning.remove();
        }
        if (selectFileBtn) {
            selectFileBtn.style.minWidth = '70px';
            selectFileBtn.style.width = '70px';
            selectFileBtn.style.height = '70px';
            selectFileBtn.parentElement.style.marginLeft = '0';
        }
        const dialogBox = document.querySelector('.dialog-box');
        if (dialogBox) {
            dialogBox.style.width = "96%";
            dialogBox.style.top = "20%";
            dialogBox.style.paddingLeft = "10px";
            dialogBox.style.paddingRight = "10px";
        }
        howToButton.style.right = '10px';
        privacyButton.style.right = '50px'
    } else {
        const usageWarning = document.getElementById("usageWarning");
        if (usageWarning) {
            usageWarning.style.display = 'none';
        }
    }
});

generateStrongGroup.addEventListener("click", function () {
    const id = uuid.v4().toString();
    transferGroupName.value = `${id.substring(id.length / 2 + 1)}`;
    transferGroupPasswordInput.value = generateStrongPassword();
});

joinTransferGroupBtn.addEventListener("click", function () {
    if (!transferGroupName.value) {
        showErrorMsg('Transfer group is not defined', function () {
            transferGroupName.focus();
        });
        return;
    }
    if (!Fileshare.properties) {
        Fileshare.properties = new FileshareProperties(transferGroupName.value, transferGroupPasswordInput.value);
    } else {
        Fileshare.properties.setTransferGroup(transferGroupName.value);
        Fileshare.properties.setTransferGroupPassword(transferGroupPasswordInput.value);
    }
    saveFileshareProperties(Fileshare.properties);
    PushcaClient.changeClientObject(
        new ClientFilter(
            PushcaClient.ClientObj.workSpaceId,
            PushcaClient.ClientObj.accountId,
            PushcaClient.ClientObj.deviceId,
            Fileshare.properties.getTransferApplicationId()
        )
    );
    postJoinTransferGroupActions();
    copyJoinGroupLink();
});

leaveTransferGroupBtn.addEventListener("click", function () {
    Fileshare.properties.setTransferGroup(null);
    saveFileshareProperties(Fileshare.properties);
    PushcaClient.changeClientObject(
        new ClientFilter(
            PushcaClient.ClientObj.workSpaceId,
            PushcaClient.ClientObj.accountId,
            PushcaClient.ClientObj.deviceId,
            Fileshare.noTransferGroupApplicationId
        )
    );
    postLeaveTransferGroupActions();
});

copyJoinTransferGroupLinkBtn.addEventListener("click", function () {
    copyJoinGroupLink();
});

function copyJoinGroupLink() {
    const serverUrl = PushcaClient.clusterBaseUrl;
    const url = `${serverUrl}/index.html?tg-host=${encodeURIComponent(PushcaClient.ClientObj.accountId)}&tg-session=${Fileshare.sessionId}`;
    copyTextToClipboard(url);
    Fileshare.joinGroupLinkWasJustCopied = true;
    copyJoinTransferGroupLinkBtn.blur();
    showInfoMsg("Join transfer group link was copied to clipboard (open it in browser on receiver side)", url, Fileshare.properties.transferGroup);
}

function postJoinTransferGroupActions() {
    joinTransferGroupBtn.disabled = true;
    generateStrongGroup.disabled = true;
    leaveTransferGroupBtn.disabled = false;
    copyJoinTransferGroupLinkBtn.disabled = false;
    transferGroupName.readOnly = true;
    transferGroupName.value = Fileshare.properties.transferGroup;
    transferGroupPasswordInput.value = Fileshare.properties.transferGroupPassword;

    transferGroupCollapsibleDiv.classList.remove('show');
    transferGroupToggleButton.textContent = `Transfer Group: ${Fileshare.properties.transferGroup}`;
}

function postLeaveTransferGroupActions() {
    transferGroupCollapsibleDiv.classList.add('show');
    transferGroupToggleButton.textContent = `Transfer Group`;

    joinTransferGroupBtn.disabled = false;
    generateStrongGroup.disabled = false;
    leaveTransferGroupBtn.disabled = true;
    copyJoinTransferGroupLinkBtn.disabled = true;
    transferGroupName.readOnly = false;
    transferGroupName.value = '';
    transferGroupPasswordInput.value = '';
    transferGroupName.focus();
}

addBinaryButton.addEventListener("click", function () {
    openModal(ContentType.FILE);
});

recordVideoButton.addEventListener("click", function () {
    openModal(ContentType.VIDEO);
});

recordAudioButton.addEventListener("click", function () {
    openModal(ContentType.AUDIO);
});

pastFromBufferButton.addEventListener("click", function () {
    openModal(ContentType.COPY_PAST);
});

textMessageButton.addEventListener("click", function () {
    openModal(ContentType.TEXT_MESSAGE);
});

transferFileButton.addEventListener("click", function () {
    openModal(ContentType.FILE_TRANSFER);
});

let FileManager = {};
const wsUrl = 'wss://secure.fileshare.ovh:31085';
let pingIntervalId = window.setInterval(function () {
    PushcaClient.sendPing();
    if (!dbConnectionHealthCheck()) {
        closeDataBase();
        openDataBase(Fileshare.workSpaceId, initFileManager);
    } else {
        console.log("Connection to DB is healthy");
    }
}, 30000);

window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key === 'v') {
        const toolBarPasteArea = document.getElementById("toolBarPasteArea");
        if (toolBarPasteArea && (!hasParentWithIdOrClass(event.target, ['addBinaryPopup', 'fileManagerGrid']))) {
            event.stopPropagation();
            toolBarPasteArea.focus();
        }
    }
});

window.addEventListener("beforeunload", function () {
    clearInterval(pingIntervalId);
});

window.addEventListener('resize', function () {
    const toolbarNav = document.querySelector('#toolbarNav');
    const fastToolbarNav = document.querySelector('#fastToolbarNav');
    const toolbarConnectionInfo = document.querySelector('#toolbarConnectionInfo');
    const thirdTubeNav = document.querySelector('#thirdTubeNav');

    if (window.innerWidth < 600) {
        toolbarNav.style.height = 'auto';
        if (fastToolbarNav) {
            fastToolbarNav.style.height = 'auto';
        }
        toolbarConnectionInfo.style.height = 'auto';
    } else {
        toolbarNav.style.height = '130px';
        if (fastToolbarNav) {
            fastToolbarNav.style.height = '130px';
        }
    }

    toolbarNav.classList.add('show');
    if (fastToolbarNav) {
        fastToolbarNav.classList.add('show');
    }
    toolbarConnectionInfo.classList.add('show');
    thirdTubeNav.classList.add('show');
});

getDeviceSecret().then((secret) => {
    Fileshare.deviceSecret = secret;
    console.log(`Device secret = ${Fileshare.deviceSecret}`);

    FingerprintJS.load().then(fp => {
        fp.get().then(result => {
            openDataBase(result.visitorId, function () {
                getFileshareProperties(function (fsProperties) {
                    Fileshare.properties = fsProperties;
                    openWsConnection(result.visitorId);
                }, function () {
                    Fileshare.properties = null;
                    updateTransferGroupCaption();
                    openWsConnection(result.visitorId);
                });
            });
        });
    });

});

PushcaClient.verbose = true;
PushcaClient.onOpenHandler = async function () {
    console.log(`Connected to Pushca: application id ${PushcaClient.ClientObj.applicationId}`);
    const usageWarning = document.getElementById("usageWarning");
    if (usageWarning) {
        usageWarning.style.display = 'none';
        statusCaption.textContent = "(Exactly one instance of that page should be always open to provide sharing of your files!!!)";
    }
    updateTransferGroupCaption();
    initFileManager();
    channelIndicator.style.backgroundColor = 'limegreen';
    if (TransferFileHelper.preparedFile.length > 0) {
        for (const file of TransferFileHelper.preparedFile) {
            await TransferFileHelper.transferFile(
                file,
                Fileshare.properties.transferGroup,
                Fileshare.properties.transferGroupPassword
            );
        }
        TransferFileHelper.preparedFile.length = 0;
    }
};

PushcaClient.onCloseHandler = function (ws, event) {
    if (!event.wasClean) {
        console.log(event);
        console.error(`Your connection died with exit code ${event.code}, refresh the page please`);
    }
    /*if (1013 === event.code) {
        PushcaClient.stopWebSocket();
        showErrorMsg("Another Secure FileShare tab was open, this one should be closed", function () {
            window.close();
        });
    }*/
    const usageWarning = document.getElementById("usageWarning");
    if (usageWarning) {
        usageWarning.style.display = 'flex';
        statusCaption.textContent = "(Transfer channel is broken)";
    }
    channelIndicator.style.backgroundColor = 'red';
};

PushcaClient.onFinalizedBinaryHandler = function (manifest) {
    console.log(`Binary download was finalized: id = ${manifest.id}`);
    console.log(manifest);
    if (manifest.isCompleted()) {
        downloadBinary(manifest.datagrams.map(dtm => dtm.bytes), "dl_" + manifest.name, manifest.mimeType);
    } else {
        console.warn(`Binary with id ${manifest.id} cannot be fully downloaded`);
    }
    BinaryWaitingHall.delete(buildDownloadWaiterId(manifest.id));
}

PushcaClient.onMessageHandler = function (ws, data) {
    if (data.includes("PUSHCA_LIMITS_VIOLATION::")) {
        PushcaClient.uploadBinaryLimitWasReached = true;
        delay(120_000).then(() => {
            PushcaClient.uploadBinaryLimitWasReached = false;
        });
        showErrorMsg(
            data.replace("PUSHCA_LIMITS_VIOLATION::", "") + ", use 'Share from device option' or wait for several hours",
            null
        );
        return;
    }
    if (data.includes(`::${MessageType.PRIVATE_URL_SUFFIX}::`)) {
        //console.log(`get private url suffix request: ${data}`);
        const parts = data.split("::");
        getPrivateUrlSuffix(parts[2]).then(getSuffixResponse => {
            if (getSuffixResponse) {
                let value = getSuffixResponse.privateUrlSuffix;
                if (getSuffixResponse.encryptionContract) {
                    value = encodeURIComponent(value + `|${getSuffixResponse.encryptionContract}|${Fileshare.ownerSignature}`);
                }
                const msg = `${parts[0]}::${MessageType.PRIVATE_URL_SUFFIX}::${value}`;
                PushcaClient.broadcastMessage(
                    null,
                    new ClientFilter("PushcaCluster", null, null, "BINARY-PROXY-CONNECTION-TO-PUSHER"),
                    false,
                    msg
                );
            }
        });
    }
}

PushcaClient.onFileTransferChunkHandler = async function (binaryWithHeader) {
    return await TransferFileHelper.processedReceivedChunk(binaryWithHeader, Fileshare);
};

async function buildSignatureHash(signature) {
    return await calculateSha256(stringToArrayBuffer(signature));
}

async function openWsConnection(deviceFpId) {
    Fileshare.workSpaceId = deviceFpId;
    if (!PushcaClient.isOpen()) {
        Fileshare.ownerSignature = await calculateSignatureSha256(Fileshare.deviceSecret);
        Fileshare.ownerSignatureHash = await calculateSha256(stringToArrayBuffer(Fileshare.ownerSignature));
        Fileshare.sessionId = uuid.v4().toString();
        Fileshare.deviceFpHash = await calculateSha256(stringToArrayBuffer(deviceFpId));
        console.log(`Owner signature hash = ${Fileshare.ownerSignatureHash}`);
        const signaturePhrase = await generateHashAndConvertToReadableSignature(Fileshare.ownerSignatureHash);
        console.log(signaturePhrase);
        let applicationId = Fileshare.noTransferGroupApplicationId;
        if (Fileshare.properties && (!Fileshare.transferGroupHostValue)) {
            applicationId = Fileshare.properties.getTransferApplicationId()
        }
        const pClient = new ClientFilter(
            `${calculateStringHashCode(deviceFpId)}`,
            Fileshare.ownerSignature,//"anonymous-sharing",
            JSON.stringify({fp: Fileshare.deviceFpHash, session: Fileshare.sessionId}),
            //`${calculateStringHashCode(deviceFpId)}`,
            applicationId
        );

        const result = await CallableFuture.callAsynchronously(
            10_000,
            `${pClient.hashCode()}`,
            function () {
                PushcaClient.openWsConnection(
                    wsUrl,
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
                                    console.log("Connection refresh was requested");
                                }
                            ).then(aResult => {
                                if (WaiterResponseType.SUCCESS === aResult.type) {
                                    Fileshare.connectionAlias = aResult.body;
                                    console.log(`Connection alias = ${Fileshare.connectionAlias}`);
                                    updateDeviceIdCaption(Fileshare.connectionAlias);
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
            Fileshare.connectionAlias = result.body;
            console.log(`Connection alias = ${Fileshare.connectionAlias}`);
        } else {
            console.warn("Failed attempt to get connection alias");
        }
        if (Fileshare.connectionAlias) {
            const clientWithAlias = await PushcaClient.connectionAliasLookup(Fileshare.connectionAlias);
            //showHostDetailsDialog(Fileshare.workSpaceId, clientWithAlias);
            updateDeviceIdCaption(Fileshare.connectionAlias);
        }
        //====================================================================
        if (Fileshare.transferGroupHostValue) {
            const joinGroupResponse = await sendJoinTransferGroupRequest(
                Fileshare.transferGroupHostValue,
                Fileshare.transferGroupSessionValue,
                deviceFpId,
                null
            );
            if (joinGroupResponse) {
                if (!Fileshare.properties) {
                    Fileshare.properties = new FileshareProperties(
                        joinGroupResponse.name,
                        joinGroupResponse.pwd
                    );
                } else {
                    Fileshare.properties.setTransferGroup(joinGroupResponse.name);
                    Fileshare.properties.setTransferGroupPassword(joinGroupResponse.pwd);
                }
                saveFileshareProperties(Fileshare.properties);

                window.location.href = window.location.origin + window.location.pathname;
            }
        }
        //====================================================================
    }
}

class GridCellButton {
    eGui;
    eButton;
    eventListener;
    publicUrl;

    init(params) {
        this.eGui = document.createElement("div");
        this.eGui.style.display = "flex";
        this.eGui.style.alignItems = "center";

        this.eButton = document.createElement("button");
        this.eButton.className = "btn-simple fm-grid-button";
        this.publicUrl = `${params.data.getPublicUrl(Fileshare.workSpaceId, isWorkspaceIdExposed())}`;
        this.eButton.title = this.publicUrl;
        this.eButton.style.marginLeft = '45%';

        if ("credentials" === params.columnName) {
            if (params.data.base64Key) {
                this.eGui.style.backgroundImage = "url('../images/encrypted-content.png')";
                this.eGui.style.backgroundSize = 'cover';
                this.eGui.style.backgroundRepeat = 'no-repeat';
                this.eGui.style.backgroundPosition = 'center center';
            }
        }

        if (params.imgSrc) {
            const img = document.createElement("img");
            img.src = params.imgSrc;
            img.alt = "Shared File action button";
            img.style.width = "20px";
            img.style.height = "20px";
            img.style.marginRight = "5px";
            this.eButton.appendChild(img);
        }

        this.eButton.appendChild(document.createTextNode(params.buttonTitle));

        this.eventListener = () => {
            params.clickHandler(params.data); // Use passed click handler
        };
        this.eButton.addEventListener("click", this.eventListener);
        this.eGui.appendChild(this.eButton);

        if (typeof params.afterCreatedHandler === 'function') {
            params.afterCreatedHandler(this.eButton, params.data);
        }
    }

    getGui() {
        return this.eGui;
    }

    refresh() {
        return true;
    }

    destroy() {
        if (this.eButton) {
            this.eButton.removeEventListener("click", this.eventListener);
        }
    }
}

class GridHeaderWithImage {
    init(params) {
        this.eGui = document.createElement('div');
        this.eGui.innerHTML = `
            <div style="display: flex; align-items: center;">
                <img src="${params.imgSrc}" style="width: 20px; height: 20px; margin-right: 5px;" alt="header image">
                <span>${params.displayName}</span>
            </div>`;
    }

    getGui() {
        return this.eGui;
    }
}

class GridHeaderWithCheckBox {
    init(params) {
        this.eGui = document.createElement('div');
        this.eGui.style.alignItems = 'center';
        this.eGui.style.textAlign = 'center';
        this.eGui.innerHTML = `
            <div style="margin-bottom: 3px">${params.headerName}</div>
            <div style="display: flex; align-items: center; text-align: inherit; height: 1px">
                <label style="display: inline-block; text-align: inherit">
                    <input type="checkbox" id="${params.elementId}" checked/>
                    ${params.displayName}
                </label>
            </div>`;
    }

    getGui() {
        return this.eGui;
    }
}

function removeGridColumn(field) {
    FileManager.gridApi.applyColumnState({
        state: [{colId: field, sort: null, hide: true}]
    });
}

function removeGridColumns(fields) {
    fields.forEach(field => removeGridColumn(field));
}

class GridHeaderWithRemoveColumnButton {
    init(params) {
        this.eGui = document.createElement('div');
        this.eGui.style.alignItems = 'center';
        this.eGui.style.textAlign = 'center';
        this.eGui.innerHTML = `
            <div style="display: flex; align-items: center; text-align: inherit; justify-content: center;  height: 1px; margin-top: 0">
                <label style="display: inline-block; text-align: inherit;margin-bottom: 15px">
                    ${params.headerName}
                    <button class="remove-btn" style="margin-left: 20px" title="remove column" onclick="removeGridColumn('${params.field}')">&#10006;</button>
                </label>
            </div>`;
    }

    getGui() {
        return this.eGui;
    }
}

function initFileManager() {
    if (FileManager.gridApi) {
        FileManager.gridApi.clear();
    }
    const isNotMobile = !isMobile();
    getAllManifests(function (manifests) {
        FileManager.manifests = manifests;
        updateTotalSize();
        const columnDefs = [];
        columnDefs.push(
            {headerName: "File name", field: "name", filter: true, floatingFilter: true, sortable: true}
        );
        columnDefs.push(
            {
                headerName: "Size, MB",
                sortable: true,
                valueGetter: params => Math.round((params.data.totalSize * 100) / MemoryBlock.MB) / 100
            }
        );
        columnDefs.push(
            {
                field: "mimeType",
                sortable: true,
                valueGetter: params => params.data.base64Key ? `${params.data.mimeType}(encrypted)` : params.data.mimeType
            }
        );
        columnDefs.push(
            {
                headerName: "Created at",
                /*headerComponent: GridHeaderWithRemoveColumnButton,
                headerComponentParams: {
                    field: "createdAt",
                    headerName: "Created at"
                },*/
                field: "createdAt",
                sortable: true,
                valueGetter: params => printPreciseDateTime(params.data.created)
            }
        );
        columnDefs.push(
            {
                headerComponent: GridHeaderWithCheckBox,
                headerComponentParams: {
                    elementId: exposeWorkspaceIdCheckBoxId,
                    headerName: "Public URL",
                    displayName: 'Expose workspace ID'
                },
                field: "copyLinkButton",
                cellRenderer: GridCellButton,
                cellRendererParams: {
                    imgSrc: "../images/copy-link-256.png",
                    buttonTitle: "",
                    clickHandler: (data) => {
                        copyTextToClipboard(data.getPublicUrl(Fileshare.workSpaceId, isWorkspaceIdExposed()));
                    }
                }
            }
        );
        columnDefs.push(
            {
                //headerName: "Credentials",
                headerComponent: GridHeaderWithRemoveColumnButton,
                headerComponentParams: {
                    field: "copyCredentialsButton",
                    headerName: "Credentials"
                },
                field: "copyCredentialsButton",
                cellRenderer: GridCellButton,
                cellRendererParams: {
                    imgSrc: "../images/secure-file-sharing.png",
                    columnName: "credentials",
                    buttonTitle: "",
                    clickHandler: (data) => {
                        if (isWorkspaceIdExposed()) {
                            copyTextToClipboard(data.password);
                        } else {
                            copyTextToClipboard(JSON.stringify(
                                {
                                    workspaceId: Fileshare.workSpaceId,
                                    password: data.password,
                                    signature: Fileshare.ownerSignatureHash
                                }
                            ));
                        }
                    },
                    afterCreatedHandler: function (eButton, data) {
                        const credentials = {
                            workspaceId: Fileshare.workSpaceId,
                            password: data.password,
                            signature: Fileshare.ownerSignatureHash
                        };
                        eButton.title = JSON.stringify(credentials);
                        if (isEmpty(credentials.password)) {
                            eButton.style.visibility = 'hidden';
                        }
                    }
                }
            },
        );
        if (isNotMobile) {
            columnDefs.push(
                {
                    //headerName: "Download",
                    headerComponent: GridHeaderWithRemoveColumnButton,
                    headerComponentParams: {
                        field: "downloadButton",
                        headerName: "Download"
                    },
                    field: "downloadButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/downloads-icon.png",
                        buttonTitle: "",
                        clickHandler: (data) => {
                            window.open(data.getPublicUrl(Fileshare.workSpaceId, isWorkspaceIdExposed()), '_blank');
                        }
                    }
                }
            );
        }

        if (isNotMobile) {
            columnDefs.push(
                {
                    headerComponent: GridHeaderWithRemoveColumnButton,
                    headerComponentParams: {
                        field: "testButton",
                        headerName: "Cached in Cloud"
                    },
                    field: "testButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/file-transfer1.png",
                        buttonTitle: "",
                        clickHandler: () => {
                        },
                        afterCreatedHandler: function (eButton, data) {
                            if (!data.cachedInCloud) {
                                eButton.style.visibility = 'hidden';
                            }
                        }
                    }
                }
            );
        }
        if (isNotMobile) {
            columnDefs.push(
                {
                    headerName: "Download counter",
                    /*headerComponent: GridHeaderWithRemoveColumnButton,
                    headerComponentParams: {
                        field: "downloadCounter",
                        headerName: "Download counter"
                    },*/
                    field: "downloadCounter",
                    sortable: true
                }
            );
        }
        columnDefs.push(
            {
                headerName: "Remove",
                field: "removeButton",
                cellRenderer: GridCellButton,
                cellRendererParams: {
                    imgSrc: "../images/delete-file.png",
                    buttonTitle: "",
                    clickHandler: (data) => {
                        if (data.cachedInCloud) {
                            PushcaClient.sendDeleteBinaryAppeal(data.id, Fileshare.deviceSecret).then(r => {
                                const responseObject = JSON.parse(r);
                                if (responseObject.body !== 'true') {
                                    console.log(r);
                                    if (responseObject.error) {
                                        showErrorMsg(responseObject.error, null);
                                    }
                                }
                            });
                        }
                        removeBinary(data.id, function () {
                            console.log(`Binary with id ${data.id} was completely removed from DB`);
                            decrementTotalSize(data.getTotalSize());
                            const rowIndex = manifests.findIndex(manifest => manifest.id === data.id);
                            if (rowIndex !== -1) {
                                FileManager.gridApi.applyTransaction({
                                    remove: [manifests[rowIndex]] // Remove the row at the specified index
                                });
                            }
                        });
                    }
                }
            }
        );
        const gridOptions = {
            // Row Data: The data to be displayed.
            rowData: manifests,
            pagination: isNotMobile,
            paginationPageSize: 5,
            paginationPageSizeSelector: [5, 10, 50, 100],
            headerHeight: 60,
            defaultColDef: {
                sortable: false
            },
            // Column Definitions: Defines the columns to be displayed.
            columnDefs: columnDefs
        };
        let fileManagerGrid = document.getElementById('fileManagerGrid');
        if (fileManagerGrid) {
            fileManagerGrid.remove();
        }
        fileManagerContainer.style.width = '100%'
        fileManagerContainer.style.margin = '0'
        fileManagerGrid = document.createElement('div');
        fileManagerGrid.id = 'fileManagerGrid';
        fileManagerGrid.className = 'ag-theme-quartz fm-grid';
        fileManagerContainer.appendChild(fileManagerGrid);
        FileManager.gridApi = agGrid.createGrid(fileManagerGrid, gridOptions);
        FileManager.gridApi.applyColumnState({
            state: [{colId: "createdAt", sort: "desc"}],
            defaultState: {sort: null}
        });
        FileManager.columnDefs = columnDefs;
        FileManager.gridApi.applyColumnState({
            state: [{colId: "downloadCounter", sort: null, hide: true}]
        });
        delay(500).then(() => {
            const exposeWorkspaceIdCheckBox = document.getElementById(exposeWorkspaceIdCheckBoxId);
            if (exposeWorkspaceIdCheckBox) {
                exposeWorkspaceIdCheckBox.addEventListener('change', function () {
                    document.querySelectorAll(".fm-grid-button").forEach(el0 => {
                        const url = el0.title;
                        if (exposeWorkspaceIdCheckBox.checked) {
                            el0.title = (!url.includes('workspace')) ? url + `?workspace=${Fileshare.workSpaceId}` : url;
                        } else {
                            el0.title = url.replace(`?workspace=${Fileshare.workSpaceId}`, '');
                        }
                    });
                });
            }
        });
    });
}

function updateTotalSize() {
    FileManager.totalSize = 0;
    FileManager.manifests.forEach(manifest => {
        FileManager.totalSize += manifest.getTotalSize();
    });
    const totalSizeMb = Math.round(FileManager.totalSize / MemoryBlock.MB);
    document.getElementById("totalSizeCaption").textContent = `${totalSizeMb} Mb`;
}

function decrementTotalSize(delta) {
    FileManager.totalSize = FileManager.totalSize - delta;
    const totalSizeMb = Math.round(FileManager.totalSize / MemoryBlock.MB);
    document.getElementById("totalSizeCaption").textContent = `${totalSizeMb} Mb`;
}

function addManifestToManagerGrid(newManifest) {
    FileManager.manifests.push(newManifest);
    FileManager.gridApi.applyTransaction({
        add: [newManifest]
    });
    updateTotalSize()
    delay(1000).then(() => {
        const publicUr = newManifest.getPublicUrl(Fileshare.workSpaceId, isWorkspaceIdExposed());
        const rowIndex = FileManager.manifests.findIndex(manifest => manifest.id === newManifest.id);
        const rowNode = FileManager.gridApi.getRowNode(rowIndex);
        rowNode.setSelected(true, true);
        copyTextToClipboard(publicUr);
        showInfoMsg(`Public url was copied to clipboard`, publicUr, newManifest.name);
    });
}

async function showNativeShareDialog(vText, vUrl) {
    if (navigator.share) {
        try {
            await navigator.share({
                title: vText,
                text: `Download link ${vText}`,
                url: vUrl
            });
            return true;
        } catch (error) {
            console.error('Error sharing:', error);
        }
    } else {
        console.log('Web Share API not supported on this browser.');
    }
    return false;
}

function incrementDownloadCounterOfManifestRecord(binaryId) {
    if (binaryId) {
        incrementDownloadCounter(binaryId);
        const manifest = FileManager.manifests.find(manifest => manifest.id === binaryId);
        if (manifest) {
            manifest.downloadCounter += 1;
            FileManager.gridApi.applyTransaction({
                update: [manifest]
            });
        }
    }
}

function isWorkspaceIdExposed() {
    const exposeWorkspaceIdCheckBox = document.getElementById(exposeWorkspaceIdCheckBoxId);
    if (exposeWorkspaceIdCheckBox) {
        return exposeWorkspaceIdCheckBox.checked;
    } else {
        return true;
    }
}

function removeParentDiv(button) {
    const parentDiv = button.parentElement;
    parentDiv.remove();
}

function removeFastToolBar(button) {
    const fastNavBarTogglerBtn = document.getElementById("fastNavBarTogglerBtn");
    if (fastNavBarTogglerBtn) {
        fastNavBarTogglerBtn.remove();
    }
    removeParentDiv(button.parentElement.parentElement.parentElement);
}

async function chunkEncryptionTest() {
    const str = "Hello world!";
    const testData = stringToArrayBuffer(str);

    const encryptionContract = await generateEncryptionContract();
    const encChunk = await encryptBinaryChunk(testData, encryptionContract);

    const decChunk = await decryptBinaryChunk(encChunk, encryptionContract);
    const resStr = arrayBufferToString(decChunk);
    if (str !== resStr) {
        alert("Failed binary chunk decryption!");
    }

    const {publicKey, privateKey} = await generateRSAKeyPair();

    const publicKeyString = await exportPublicKey(publicKey);

    const importedPublicKey = await importPublicKeyFromString(publicKeyString);

    const encryptedText = await encryptWithPublicKey(importedPublicKey, str);

    const decryptedText = await decryptWithPrivateKey(privateKey, encryptedText);

    if (str !== decryptedText) {
        alert("Failed asymmetric decryption!");
    }
}

chunkEncryptionTest();