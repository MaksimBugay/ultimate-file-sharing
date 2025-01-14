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

const deviceFromArea = deviceFromImage.getBoundingClientRect();
selectFilesBtn.style.top = `${deviceFromArea.top + 30}px`;
selectFilesBtn.style.left = `${deviceFromArea.left + 50}px`;
selectFilesBtn.style.display = 'block';

const deviceToArea = deviceToImage.getBoundingClientRect();
dropZone.style.width = `${0.86 * deviceToArea.width}px`;
dropZone.style.height = `${0.45 * deviceToArea.width}px`;
dropZone.style.top = `${deviceToArea.top + 30}px`;
dropZone.style.left = `${deviceToArea.left + 20}px`;

function setDeviceFromVirtualHost(alias) {
    ownerVirtualHost.value = alias;
    ownerVirtualHost.classList.add('embedded-link');
}

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
