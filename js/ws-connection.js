console.log('ws-connection.js running on', window.location.href);

const wsUrl = 'wss://vasilii.prodpushca.com:30085';
let pingIntervalId = null;

openWsConnection();
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.message === "send-binary-chunk") {
        sendResponse({result: 'all good', binaryId: request.binaryId, order: request.order});
        return true;
    }

    if (request.message === "get-connection-attributes") {
        sendResponse({clientObj: PushcaClient.ClientObj, pusherInstanceId: PushcaClient.pusherInstanceId});
    }
});

function openWsConnection() {
    if (!PushcaClient.isOpen()) {
        PushcaClient.openWsConnection(
            wsUrl,
            new ClientFilter(
                IndexDbDeviceId,
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
            },
            function () {
                console.log("Connected to Pushca!");
                pingIntervalId = window.setInterval(function () {
                    PushcaClient.sendPing();
                }, 30000);
                openDataBase();
            },
            function (ws, event) {
                window.clearInterval(pingIntervalId);
                closeDataBase();
                if (!event.wasClean) {
                    console.error("Your connection died, refresh the page please");
                }
            },
            function (ws, messageText) {
                if (messageText !== "PONG") {
                    console.log(messageText);
                }
            },
            function (channelEvent) {
                //console.log(channelEvent);
            },
            function (channelMessage) {
                //console.log(channelMessage);
            },
            function (binary) {
                //console.log(binary.length)
            }
        );
    }
}

delay(5000).then(() => {
    getAllManifests(function (manifests) {
        console.log("Fetched manifests");
        console.log(manifests);
        manifests.forEach(manifest => removeBinary(manifest.id));
    });
});


