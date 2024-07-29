console.log('ws-connection.js running on', window.location.href);

const wsUrl = 'wss://vasilii.prodpushca.com:30085';
let pingIntervalId = null;

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openWsConnection(result.visitorId);
    });
});
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.message === "send-binary-chunk") {
        sendResponse({result: 'all good', binaryId: request.binaryId, order: request.order});
        return true;
    }

    if (request.message === "get-connection-attributes") {
        sendResponse({clientObj: PushcaClient.ClientObj, pusherInstanceId: PushcaClient.pusherInstanceId});
    }
});

PushcaClient.verbose = true;
PushcaClient.onOpenHandler = function () {
    console.log("Connected to Pushca!");
    pingIntervalId = window.setInterval(function () {
        PushcaClient.sendPing();
    }, 30000);
    openDataBase(PushcaClient.ClientObj.workSpaceId);
};

PushcaClient.onCloseHandler = function (ws, event) {
    window.clearInterval(pingIntervalId);
    closeDataBase();
    if (!event.wasClean) {
        console.error("Your connection died, refresh the page please");
    }
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

function openWsConnection(deviceFpId) {
    if (!PushcaClient.isOpen()) {
        PushcaClient.openWsConnection(
            wsUrl,
            new ClientFilter(
                deviceFpId,
                "anonymous-sharing",
                uuid.v4().toString(),
                "ultimate-file-sharing-listener"
            ),
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    uuid.v4().toString(),
                    clientObj.applicationId
                );
            }
        );
    }
}

delay(3000).then(() => {
    getAllManifests(function (manifests) {
        //clearAllManifests();
        //clearAllBinaries();
        console.log("Fetched manifests");
        console.log(manifests);
        /*manifests.forEach(manifest => removeBinary(manifest.id, function () {
            console.log(`Binary with id ${manifest.id} was completely removed from DB`);
        }));*/
        console.log(PushcaClient.ClientObj);
        const dest = PushcaClient.ClientObj;
        /*const dest = new ClientFilter(
            "workSpaceMain",
            "clientJava0@test.ee",
            "jmeter",
            "PUSHCA_CLIENT_dfebf6fb-5182-44b8-a0a6-83c966998ed1"
        );*/
        sendBinary(manifests[0].id, false, null, dest);
        manifests.forEach(manifest => {
            //sendBinary(manifest.id, false, null, owner);
            /*PushcaClient.sendUploadBinaryAppeal(
                owner,
                manifest.id,
                MemoryBlock.MB,
                false,
                [0]
            ).then(result => {
                console.log(result.type);
            });
            delay(2000).then(() => {
                PushcaClient.sendUploadBinaryAppeal(
                    owner,
                    manifest.id,
                    MemoryBlock.MB,
                    false,
                    null
                ).then(result => {
                    console.log(result.type);
                });
            });*/
        });
    });
});


