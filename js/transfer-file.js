
const joinTransferGroupDialog = document.getElementById('joinTransferGroupDialog');
const allowJoinTransferGroupBtn = document.getElementById('allowJoinTransferGroupBtn');
const denyJoinTransferGroupBtn = document.getElementById('denyJoinTransferGroupBtn');
const jtgDeviceId = document.getElementById('jtgDeviceId');
const jtgVirtualHostName = document.getElementById('jtgVirtualHostName');
const jtgCity = document.getElementById('jtgCity');
const jtgProxyInfo = document.getElementById('jtgProxyInfo');
const jtgIP = document.getElementById('jtgIP');
const jtgCountry = document.getElementById('jtgCountry');
const transReceiverContainer = document.getElementById('transReceiverContainer');
const transGroupContainer = document.getElementById('transGroupContainer');
const virtualHost = document.getElementById('virtualHost');
const hostAsTransferTargetChoice = document.getElementById('hostAsTransferTargetChoice');
const groupAsTransferTargetChoice = document.getElementById('groupAsTransferTargetChoice');

let isUpdatingProgrammatically = false;

setOriginatorVirtualHostClickHandler(Fileshare.workSpaceId);

virtualHost.addEventListener('click', function () {
    const value = this.value.trim();
    if (value && virtualHost.readOnly) {
        PushcaClient.connectionAliasLookup(value).then(clientWithAlias => {
            if (clientWithAlias) {
                showHostDetailsDialog(null, clientWithAlias);
            }
        });
    }
});
virtualHost.addEventListener('input', (event) => {
    if (isUpdatingProgrammatically) {
        return;
    }

    if (event.target.value.length > 3) {
        PushcaClient.connectionAliasLookup(event.target.value).then(clientWithAlias => {
            if (clientWithAlias) {
                isUpdatingProgrammatically = true;
                event.target.setAttribute('readonly', true);
                event.target.classList.add('embedded-link');
                event.target.value = clientWithAlias.alias;
                isUpdatingProgrammatically = false;
            }
        });
    }
});

document.querySelectorAll('input[name="transferTargetChoice"]').forEach((element) => {
    element.addEventListener('change', function () {
        virtualHost.value = null;
        setTransferTargetChoice(this.value);
    });
});

function setTransferTargetChoice(choiceName) {
    if (choiceName === TransferTargetType.HOST) {
        hostAsTransferTargetChoice.checked = true;
        transReceiverContainer.style.display = 'block';
        transGroupContainer.style.display = 'none';
        virtualHost.focus();
    } else if (choiceName === TransferTargetType.GROUP) {
        groupAsTransferTargetChoice.checked = true;
        transReceiverContainer.style.display = 'none';
        transGroupContainer.style.display = 'block';
    }
}

function getTransferTargetChoice() {
    if (hostAsTransferTargetChoice.checked) {
        return TransferTargetType.HOST;
    } else if (groupAsTransferTargetChoice.checked) {
        return TransferTargetType.GROUP;
    } else {
        return null;
    }
}

joinTransferGroupDialog.addEventListener("click", (event) => {
    if (event.target === acceptFileTransferDialog) {
        event.stopPropagation(); // Prevent click from propagating if outside dialog
    }
});

function showJoinTransferGroupDialog(waiterId, deviceId, gatewayRequestHeader) {
    jtgDeviceId.textContent = deviceId;
    jtgVirtualHostName.textContent = gatewayRequestHeader.alias;
    jtgIP.textContent = gatewayRequestHeader.ip;
    jtgCountry.innerHTML = gatewayRequestHeader.countryCode ?
        getCountryWithFlagInnerHtml(gatewayRequestHeader.countryCode, gatewayRequestHeader.countryName) : null;
    jtgCity.textContent = gatewayRequestHeader.city;
    jtgProxyInfo.textContent = gatewayRequestHeader.proxyInfo ? gatewayRequestHeader.proxyInfo : '-';
    const allowHandler = function () {
        CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, true);
        cleanUp();
        hideJoinTransferGroupDialog();
    }
    const denyHandler = function () {
        CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, false);
        cleanUp();
        hideJoinTransferGroupDialog();
    }

    function cleanUp() {
        allowJoinTransferGroupBtn.removeEventListener('click', allowHandler);
        denyJoinTransferGroupBtn.removeEventListener('click', denyHandler);
    }

    allowJoinTransferGroupBtn.addEventListener('click', allowHandler);
    denyJoinTransferGroupBtn.addEventListener('click', denyHandler);
    joinTransferGroupDialog.classList.add('visible');
}

function isJoinTransferGroupDialogVisible() {
    return joinTransferGroupDialog.classList.contains('visible');
}

function hideJoinTransferGroupDialog() {
    joinTransferGroupDialog.classList.remove('visible');
}

TransferFileHelper.transferFileToVirtualHost = async function (file, receiverVirtualHost) {
    return await TransferFileHelper.transferFileToVirtualHostBase(
        file,
        receiverVirtualHost,
        Fileshare.connectionAlias,
        "Failed file transfer attempt: receiver is not unavailable. Open https://secure.fileshare.ovh on receiver's side and use assigned virtual host as a destination",
        Fileshare
    );
}

TransferFileHelper.transferFile = async function (file, transferGroup, transferGroupPassword, binaryId = null, destHashCode = null) {
    return await TransferFileHelper.transferFileBase(
        file,
        transferGroup,
        transferGroupPassword,
        Fileshare.connectionAlias,
        "Failed file transfer attempt: all group members are unavailable. Open https://secure.fileshare.ovh on receiver's side and join the group",
        Fileshare,
        binaryId,
        destHashCode
    );
}

TransferFileHelper.transferBlobToVirtualHost = async function (blob, name, type, alias) {
    return await TransferFileHelper.transferBlobToVirtualHostBase(
        blob, name, type, alias,
        Fileshare.connectionAlias, Fileshare
    );
}

TransferFileHelper.transferBlob = async function (blob, name, type,
                                                  transferGroup, transferGroupPassword,
                                                  binaryId = null, destHashCode = null) {
    return await TransferFileHelper.transferBlobBase(
        blob, name, type, transferGroup, transferGroupPassword,
        Fileshare.connectionAlias, Fileshare,
        binaryId, destHashCode
    );
}

async function readFileSequentially(file, chunkHandler, errorMsg) {
    return await readFileSequentiallyBase(
        file, chunkHandler, errorMsg, Fileshare
    );
}

async function sendJoinTransferGroupRequest(transferGroupHost, sessionId, deviceFpId, binaryId) {
    const joinTransferGroupRequest = new JoinTransferGroupRequest(
        deviceFpId,
        sessionId,
        null,
        binaryId
    );

    const ownerFilter = new ClientFilter(
        null,
        transferGroupHost,
        null,
        null
    );

    return await sendJoinTransferGroupRequestToClient(ownerFilter, joinTransferGroupRequest);
}

