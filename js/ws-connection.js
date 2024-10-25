console.log('ws-connection.js running on', window.location.href);

const statusCaption = document.getElementById("statusCaption");
const channelIndicator = document.getElementById("channelIndicator");
const addBinaryButton = document.getElementById("addBinaryButton");
const recordVideoButton = document.getElementById("recordVideoButton");
const recordAudioButton = document.getElementById("recordAudioButton");
const expandableDiv = document.getElementById("expandableDiv");
const pastFromBufferButton = document.getElementById("pastFromBufferButton")
let exposeWorkspaceIdCheckBox;

document.addEventListener("DOMContentLoaded", function () {
    if (isMobile()) {
        const dropZone = document.getElementById('dropZone');
        if (dropZone) {
            dropZone.remove();
        }
        const expandableDiv = document.getElementById("expandableDiv");
        if (expandableDiv) {
            expandableDiv.remove();
        }
        const usageWarning = document.getElementById("usageWarning");
        if (usageWarning) {
            usageWarning.remove();
        }
        const modalContent = document.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.width = "96%";
            modalContent.style.marginTop = "0";
            modalContent.style.marginLeft = '0';
            modalContent.style.left = "0";
            modalContent.style.top = "0";
        }
    } else {
        const gridToolBar = document.getElementById("gridToolBar");
        if (gridToolBar) {
            gridToolBar.style.display = 'flex';
        }
        expandableDiv.style.display = "block";
    }
});

expandableDiv.addEventListener('mouseover', () => {
    expandableDiv.classList.add('expand');
});

// Add mouseout event to shrink the div
expandableDiv.addEventListener('mouseout', () => {
    expandableDiv.classList.remove('expand');
});
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

let FileManager = {};
const wsUrl = 'wss://secure.fileshare.ovh:31085';
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
    channelIndicator.style.backgroundColor = 'limegreen';
    statusCaption.textContent = "(Exactly one instance of that page should be always open to provide sharing of your files!!!)";
};

PushcaClient.onCloseHandler = function (ws, event) {
    window.clearInterval(pingIntervalId);
    closeDataBase();
    statusCaption.textContent = "(Transfer channel is broken)";
    channelIndicator.style.backgroundColor = 'red';
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

PushcaClient.onMessageHandler = function (ws, data) {
    if (data.includes(`::${MessageType.PRIVATE_URL_SUFFIX}::`)) {
        //console.log(`get private url suffix request: ${data}`);
        const parts = data.split("::");
        getPrivateUrlSuffix(parts[2]).then(getSuffixResponse => {
            if (getSuffixResponse) {
                let value = getSuffixResponse.privateUrlSuffix;
                if (getSuffixResponse.encryptionContract) {
                    value = encodeURIComponent(value + `|${getSuffixResponse.encryptionContract}`);
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

function openWsConnection(deviceFpId) {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            deviceFpId,
            "anonymous-sharing",
            `${calculateStringHashCode(deviceFpId)}`,
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
        this.publicUrl = `${params.data.getPublicUrl(PushcaClient.ClientObj.workSpaceId, isWorkspaceIdExposed())}`;
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

class GridHeaderWithCheckBox {
    init(params) {
        this.eGui = document.createElement('div');
        this.eGui.style.alignItems = 'center';
        this.eGui.style.textAlign = 'center';
        this.eGui.innerHTML = `
            <div style="margin-bottom: 3px">${params.headerName}</div>
            <div style="display: flex; align-items: center; text-align: inherit; height: 1px">
                <label style="display: inline-block; text-align: inherit">
                    <input type="checkbox" id="${params.elementId}"/>
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
                    elementId: 'exposeWorkspaceIdCheckBox',
                    headerName: "Public URL",
                    displayName: 'Expose workspace ID'
                },
                field: "copyLinkButton",
                cellRenderer: GridCellButton,
                cellRendererParams: {
                    imgSrc: "../images/copy-link-256.png",
                    buttonTitle: "",
                    clickHandler: (data) => {
                        copyTextToClipboard(data.getPublicUrl(PushcaClient.ClientObj.workSpaceId, isWorkspaceIdExposed()));
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
                                    workspaceId: PushcaClient.ClientObj.workSpaceId,
                                    password: data.password
                                }
                            ));
                        }
                    },
                    afterCreatedHandler: function (eButton, data) {
                        const credentials = {
                            workspaceId: PushcaClient.ClientObj.workSpaceId,
                            password: data.password
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
                            loadAllBinaryChunks(data.id, data.datagrams.length, (loadedChunks) => {
                                downloadBinary(loadedChunks, data.name, data.mimeType);
                            });
                        }
                    }
                }
            );
        }

        if (isNotMobile) {
            columnDefs.push(
                {
                    //headerName: "Test",
                    headerComponent: GridHeaderWithRemoveColumnButton,
                    headerComponentParams: {
                        field: "testButton",
                        headerName: "Test"
                    },
                    field: "testButton",
                    cellRenderer: GridCellButton,
                    cellRendererParams: {
                        imgSrc: "../images/test-public-url.png",
                        buttonTitle: "",
                        clickHandler: (data) => {
                            window.open(data.getPublicUrl(PushcaClient.ClientObj.workSpaceId, isWorkspaceIdExposed()), '_blank');
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
        const fileManagerContainer = document.getElementById("fileManagerContainer");
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
    });
}

function updateTotalSize() {
    FileManager.totalSize = 0;
    FileManager.manifests.forEach(manifest => {
        FileManager.totalSize += manifest.getTotalSize();
    });
    const totalSizeMb = `Total size = ${Math.round(FileManager.totalSize / MemoryBlock.MB)} Mb`;
    document.getElementById("totalSizeCaption").textContent = `[${totalSizeMb}]`;
}

function decrementTotalSize(delta) {
    FileManager.totalSize = FileManager.totalSize - delta;
    const totalSizeMb = `Total size = ${Math.round(FileManager.totalSize / MemoryBlock.MB)} Mb`;
    document.getElementById("totalSizeCaption").textContent = `[${totalSizeMb}]`;
}

function addManifestToManagerGrid(newManifest) {
    FileManager.manifests.push(newManifest);
    FileManager.gridApi.applyTransaction({
        add: [newManifest]
    });
    updateTotalSize()
    delay(1000).then(() => {
        const publicUr = newManifest.getPublicUrl(PushcaClient.ClientObj.workSpaceId, isWorkspaceIdExposed());
        const rowIndex = FileManager.manifests.findIndex(manifest => manifest.id === newManifest.id);
        const rowNode = FileManager.gridApi.getRowNode(rowIndex);
        rowNode.setSelected(true, true);
        copyTextToClipboard(publicUr);
        if (isMobile()) {
            showNativeShareDialog(newManifest.name, publicUr);
        }
    });
}

async function showNativeShareDialog(vText, vUrl) {
    if (navigator.share) {
        try {
            await navigator.share({
                title: vText,
                text: 'Public download link',
                url: vUrl
            });
        } catch (error) {
            console.error('Error sharing:', error);
        }
    } else {
        console.log('Web Share API not supported on this browser.');
    }
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
    if (!exposeWorkspaceIdCheckBox) {
        exposeWorkspaceIdCheckBox = document.getElementById("exposeWorkspaceIdCheckBox");
        exposeWorkspaceIdCheckBox.addEventListener('change', function () {
            document.querySelectorAll(".fm-grid-button").forEach(el0 => {
                const url = el0.title;
                if (exposeWorkspaceIdCheckBox.checked) {
                    el0.title = (!url.includes('workspace')) ? url + `?workspace=${PushcaClient.ClientObj.workSpaceId}` : url;
                } else {
                    el0.title = url.replace(`?workspace=${PushcaClient.ClientObj.workSpaceId}`, '');
                }
            })
        });
    }
    return exposeWorkspaceIdCheckBox.checked;
}

function removeParentDiv(button) {
    const parentDiv = button.parentElement;
    parentDiv.remove();
}