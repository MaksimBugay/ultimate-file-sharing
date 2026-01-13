const wsUrl = 'wss://secure.fileshare.ovh:31085';

async function webSocketAvailabilityCheck() {
    const result = await CallableFuture.callAsynchronously(1000, null, function (waiterId) {
        try {
            const ws = new WebSocket("wss://echo.websocket.org");
            ws.onopen = () => {
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, "true");
                ws.close(1000, "Testing was finished")
            };
            ws.onerror = err => {
                CallableFuture.releaseWaiterIfExistsWithError(waiterId, err);
                ws.close(1000, "Testing was finished");
            };
        } catch (err) {
            CallableFuture.releaseWaiterIfExistsWithError(waiterId, err);
        }
    });
    return WaiterResponseType.SUCCESS === result.type;
}

async function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            `SecureFileShare_main`,
            "anonymous-sharing",
            uuid.v4().toString(),
            "fileshare-main-page"
        );
        await PushcaClient.openWsConnection(
            wsUrl,
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            },
            false
        );
    }
}

webSocketAvailabilityCheck().then(result => {
    if (result) {
        openWsConnection().then(
            () => {
                delay(5000).then(
                    () => {
                        PushcaClient.stopWebSocketPermanently();
                    }
                );
            }
        );
    }
});