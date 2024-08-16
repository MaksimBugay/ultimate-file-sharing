console.log('ws-connection.js running on', window.location.href);

let FileManager = {};
const wsUrl = 'wss://vasilii.prodpushca.com:30085';
let pingIntervalId = null;

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openWsConnection(result.visitorId);
    });
});

PushcaClient.verbose = true;
PushcaClient.onOpenHandler = function () {
    console.log("Connected to Pushca!");
    pingIntervalId = window.setInterval(function () {
        PushcaClient.sendPing();
        if (!dbConnectionHealthCheck()) {
            closeDataBase();
            openDataBase(PushcaClient.ClientObj.workSpaceId, initFileManager);
        } else {
            console.log("Connection to DB is healthy");
        }
    }, 30000);
    openDataBase(PushcaClient.ClientObj.workSpaceId, initFileManager);
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
        const pClient = new ClientFilter(
            deviceFpId,
            "anonymous-sharing",
            deviceFpId,
            "ultimate-file-sharing-listener"
        );
        PushcaClient.openWsConnection(
            wsUrl,
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
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
        this.publicUrl = `${params.data.getPublicUrl(PushcaClient.ClientObj.workSpaceId)}`;
        this.eButton.title = this.publicUrl;


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

function initFileManager() {
    if (FileManager.gridApi) {
        FileManager.gridApi.clear();
    }
    getAllManifests(function (manifests) {
        FileManager.manifests = manifests;
        let totalSize = 0;
        manifests.forEach(manifest => {
            totalSize += manifest.getTotalSize();
        });
        console.log(`Total size = ${Math.round(totalSize / MemoryBlock.MB)} Mb`);
        const gridOptions = {
            // Row Data: The data to be displayed.
            rowData: manifests,
            pagination: true,
            paginationPageSize: 10,
            paginationPageSizeSelector: [10, 50, 100],
            defaultColDef: {
                sortable: false
            },
            // Column Definitions: Defines the columns to be displayed.
            columnDefs: [
                {headerName: "File name", field: "name", filter: true, floatingFilter: true, sortable: true},
                {
                    headerName: "Size, MB",
                    sortable: true,
                    valueGetter: params => Math.round((params.data.totalSize * 100) / MemoryBlock.MB) / 100
                },
                {field: "mimeType", sortable: true},
                {
                    headerName: "Created at",
                    field: "createdAt",
                    sortable: true,
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
                                    FileManager.gridApi.applyTransaction({
                                        remove: [manifests[rowIndex]] // Remove the row at the specified index
                                    });
                                }
                            });
                        }
                    }
                }
            ]
        };
        let fileManagerGrid = document.getElementById('fileManagerGrid');
        if (fileManagerGrid) {
            fileManagerGrid.remove();
        }
        const fileManagerContainer = document.getElementById("fileManagerContainer");
        fileManagerGrid = document.createElement('div');
        fileManagerGrid.id = 'fileManagerGrid';
        fileManagerGrid.className = 'ag-theme-quartz fm-grid';
        fileManagerContainer.appendChild(fileManagerGrid);
        FileManager.gridApi = agGrid.createGrid(fileManagerGrid, gridOptions);
        FileManager.gridApi.applyColumnState({
            state: [{colId: "createdAt", sort: "desc"}],
            defaultState: {sort: null},
        });
        generateKeyFromPassword("password").then(key => {
            console.log("Signature key");
            console.log(key);
            signString(key, 'TestString').then(signature => {
                console.log(`Test string signature`);
                console.log(signature);
                const signatureParam = arrayBufferToUrlSafeBase64(signature);
                console.log(signatureParam);
                const signatureFromParam = urlSafeBase64ToArrayBuffer(signatureParam);
                if (!arrayBuffersAreEqual(signature, signatureFromParam)) {
                    alert("!!!");
                }
                verifySignature(key, 'TestString', signatureParam).then(result => {
                    console.log(result);
                })
            });
        });
    });
}

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.message === "send-binary-chunk") {
        sendResponse({result: 'all good', binaryId: request.binaryId, order: request.order});
        return true;
    }

    if (request.message === "get-connection-attributes") {
        sendResponse({clientObj: PushcaClient.ClientObj, pusherInstanceId: PushcaClient.pusherInstanceId});
    }

    if (request.message === "add-manifest-to-manager-grid") {
        if (request.manifest) {
            const newManifest = BinaryManifest.fromJSON(request.manifest, request.totalSize, request.created);
            FileManager.manifests.push(newManifest);
            FileManager.gridApi.applyTransaction({
                add: [newManifest]
            });

            delay(1000).then(() => {
                const publicUr = newManifest.getPublicUrl(PushcaClient.ClientObj.workSpaceId);
                copyToClipboard(publicUr);

                const rowIndex = FileManager.manifests.findIndex(manifest => manifest.id === newManifest.id);
                const rowNode = FileManager.gridApi.getRowNode(rowIndex);
                rowNode.setSelected(true, true);
            });
        }
    }
});

