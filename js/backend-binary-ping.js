function enableBinaryPing() {
    PushcaClient.onOpenHandler = async function () {
        const message = `Connected to Pushca: device id ${PushcaClient.ClientObj.deviceId}`;
        console.log(message);
    }
    FingerprintJS.load().then(fp => {
        fp.get().then(result => {
            openWsConnection(result.visitorId)
                .then(() => console.log("Open WS connection attempt"));
        });
    });
    delay(5000).then(() => {
        PushcaClient.stopWebSocketPermanently();
    })
}

async function openWsConnection(deviceId) {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "WsBackend",
            uuid.v4().toString(),
            deviceId,
            "SERVER_PING"
        );
        await PushcaClient.openWsConnection(
            'wss://secure.fileshare.ovh:31085',
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            },
            null
        );
    }
}

enableBinaryPing();


