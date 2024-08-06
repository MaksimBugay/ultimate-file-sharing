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
        this.publicUrl = `https://vasilii.prodpushca.com:30443/binary/${PushcaClient.ClientObj.workSpaceId}/${params.data.id}?mimeType=${params.data.mimeType}`;

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
    }

    getGui() {
        return this.eGui;
    }

    refresh(params) {
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
        //sendBinary("b504a910-131d-423a-91a9-8dcff825f041", false, null, dest);
        let totalSize = 0;
        manifests.forEach(manifest => {
            console.log(`https://vasilii.prodpushca.com:30443/binary/${PushcaClient.ClientObj.workSpaceId}/${manifest.id}?mimeType=${manifest.mimeType}`);
            //console.log(`http://vasilii.prodpushca.com:8060/binary/${PushcaClient.ClientObj.workSpaceId}/${manifest.id}?mimeType=${manifest.mimeType}`);
            totalSize += manifest.getTotalSize();
        });
        console.log(`Total size = ${Math.round(totalSize / MemoryBlock.MB)} Mb`);
        const gridOptions = {
            // Row Data: The data to be displayed.
            rowData: manifests,
            // Column Definitions: Defines the columns to be displayed.
            columnDefs: [
                {headerName: "File name", field: "name"},
                {
                    headerName: "Size, MB",
                    valueGetter: params => Math.round((params.data.totalSize * 100) / MemoryBlock.MB) / 100
                },
                {field: "mimeType"},
                {
                    headerName: "Created at",
                    valueGetter: params => printDateTime(params.data.created)
                },
                {
                    headerName: "Public URL",
                    field: "copyLinkButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/copy-link-256.png",
                        buttonTitle: "",
                        clickHandler: (data) => {
                            copyToClipboard(data.getPublicUrl(PushcaClient.ClientObj.workSpaceId));
                        }
                    }
                },
                {
                    /*headerComponent: GridHeaderWithImage,
                    headerComponentParams: {
                        imgSrc: '../images/downloads-icon.png',
                        displayName: ''
                    },*/
                    headerName: "Download",
                    field: "downloadButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/downloads-icon.png",
                        buttonTitle: "",
                        clickHandler: (data) => {
                            loadAllBinaryChunks(data.id, data.datagrams.length, (loadedChunks) => {
                                downloadBinary(loadedChunks, data.name, data.mimeType);
                            });
                        }
                    }
                },
                {
                    headerName: "Test",
                    field: "testButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/test-public-url.png",
                        buttonTitle: "",
                        clickHandler: (data) => {
                            window.open(data.getPublicUrl(PushcaClient.ClientObj.workSpaceId), '_blank');
                        }
                    }
                },
                {
                    headerName: "Remove",
                    field: "removeButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/delete-file.png",
                        buttonTitle: "",
                        clickHandler: (data) => {
                            removeBinary(data.id, function () {
                                console.log(`Binary with id ${data.id} was completely removed from DB`);
                                const rowIndex = manifests.findIndex(manifest => manifest.id === data.id);
                                if (rowIndex !== -1) {
                                    gridApi.applyTransaction({
                                        remove: [manifests[rowIndex]] // Remove the row at the specified index
                                    });
                                }
                            });
                        }
                    }
                }
            ]
        };
        const fileManagerGrid = document.getElementById('fileManagerGrid');
        const gridApi = agGrid.createGrid(fileManagerGrid, gridOptions);
    });
});


