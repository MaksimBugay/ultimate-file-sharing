const ProtectionType = Object.freeze({
    PASSWORD: 'pPassword',
    CAPTCHA: 'pCaptcha'
});

FileSharing = {}
FileSharing.applicationId = 'SIMPLE_FILE_SHARING';
FileSharing.wsUrl = 'wss://secure.fileshare.ovh:31085';

const protectWithPasswordChoice = document.getElementById("protectWithPasswordChoice");
const protectWithCaptchaChoice = document.getElementById("protectWithCaptchaChoice");
const passwordInputContainer = document.getElementById("passwordInputContainer");
const passwordInput = document.getElementById("passwordInput");
const selectFilesBtn = document.getElementById('selectFilesBtn');
const fileTransferProgressBtn = document.getElementById('fileTransferProgressBtn');
const fileInput = document.getElementById('fileInput');
fileInput.removeAttribute('webkitdirectory');
fileInput.setAttribute('multiple', '');

const progressBarContainer = document.getElementById('progressBarContainer');
const uploadProgress = document.getElementById('uploadProgress');
const uploadProgressPercentage = document.getElementById('uploadProgressPercentage');
FileSharing.progressBarWidget = new ProgressBarWidget(
    progressBarContainer,
    uploadProgress,
    uploadProgressPercentage
);

FileSharing.defaultReadMeText = "Default description";

async function processSelectedFiles(files) {
    fileTransferProgressBtn.style.display = 'block';
    selectFilesBtn.disabled = true;
    dropZone.disabled = true;
    let i = 0;
    FileSharing.extraProgressHandler = function () {
        i += 1;
        if (i % 5 === 0) {
            if (fileTransferProgressBtn.style.transform === 'scale(0.95)') {
                fileTransferProgressBtn.style.transform = 'scale(1.1)';
            } else {
                fileTransferProgressBtn.style.transform = 'scale(0.95)';
            }
        }
    }
    const protectionAttributes = getProtectionAttributes();
    for (let i = 0; i < files.length; i++) {
        console.log(files[i].name)
        await FileSharing.saveFileInCloud(
            files[i],
            await getReadMeText(),
            protectionAttributes ? (ProtectionType.CAPTCHA === protectionAttributes.type) : false,
            (protectionAttributes && (ProtectionType.PASSWORD === protectionAttributes.type)) ? protectionAttributes.pwd : null
        );
    }
    FileSharing.extraProgressHandler = null;
    fileTransferProgressBtn.style.display = 'none';
}

function setProtectionTypeChoice(choiceName) {
    if (choiceName === ProtectionType.PASSWORD) {
        protectWithPasswordChoice.checked = true;
        protectWithCaptchaChoice.checked = false;
        passwordInputContainer.style.display = 'block';
        passwordInput.focus();
    } else if (choiceName === ProtectionType.CAPTCHA) {
        protectWithCaptchaChoice.checked = true;
        protectWithPasswordChoice.checked = false;
        passwordInputContainer.style.display = 'none';
    }
}

function getProtectionAttributes() {
    if (protectWithPasswordChoice.checked && (passwordInput.value.trim() !== "")) {
        return {
            type: ProtectionType.PASSWORD,
            pwd: passwordInput.value
        };
    } else if (protectWithCaptchaChoice.checked) {
        return {
            type: ProtectionType.CAPTCHA
        };
    } else {
        return null;
    }
}

//=================================Copy/Paste area======================================================================
function initEventsForCopyPasteArea() {
    if (document.getElementById('selectFilesSubContainer')) {
        document.getElementById('selectFilesSubContainer').addEventListener(
            'mousemove', function () {
                if (toolBarPasteArea && document.activeElement === toolBarPasteArea) {
                    return;
                }
                if (toolBarPasteArea) {
                    toolBarPasteArea.focus();
                    toolBarPasteArea.style.border = "0 none transparent";
                }
            }
        );
    }

    document.addEventListener('mousemove', containerWithCopyPastElementMouseMoveEventHandler);

    toolBarPasteArea.addEventListener('paste', async function (event) {
        const clipboardItems = event.clipboardData.items;

        event.stopPropagation();
        event.preventDefault();
        selectFilesBtn.disabled = true;
        dropZone.disabled = true;

        let textItems = null;

        for (let item of clipboardItems) {
            if (item.kind === 'file') {
                const blob = item.getAsFile();
                //console.log(blob);
                const mimeType = blob.type;
                const name = getCopyPastName(mimeType, blob.name);
                console.log(name);
                /*await TransferFileHelper.transferBlobToVirtualHostBase(
                    blob, name, blob.type,
                    receiverVirtualHost.value,
                    ownerVirtualHost.value,
                    FileTransfer
                );*/
            } else if (item.kind === 'string') {
                if (textItems) {
                    textItems = textItems + " " + await readTextFromClipboardItem(item);
                } else {
                    textItems = await readTextFromClipboardItem(item);
                }
            }
        }

        if (textItems) {
            const mimeType = 'text/plain';
            const name = `text-message-${new Date().getTime()}.txt`;
            const text = DOMPurify.sanitize(textItems);
            if (isNotEmpty(text)) {
                console.log(name);
                const textBlob = new Blob([text], {type: mimeType});
                /*await TransferFileHelper.transferBlobToVirtualHostBase(
                    textBlob, name, textBlob.type,
                    receiverVirtualHost.value,
                    ownerVirtualHost.value,
                    FileTransfer
                );*/
            }
        }
    });
}

function hasFileExtension(fileName) {
    return /\.[a-zA-Z0-9]+$/.test(fileName); // Matches .extension at the end of the string
}

function getCopyPastName(mimeType, blobName) {
    if (hasFileExtension(blobName)) {
        return blobName;
    }
    let ext = "";
    if (mimeType.includes('png')) {
        ext = '.png';
    }
    if (mimeType.includes('bmp')) {
        ext = '.bmp';
    }
    const prefix = blobName ? blobName : 'binary';
    return `${prefix}-${new Date().getTime()}${ext}`
}

async function readTextFromClipboardItem(item) {
    const getClipboardTextItemResult = await CallableFuture.callAsynchronously(
        2000, null, function (waiterId) {
            item.getAsString(function (pasteText) {
                    CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, pasteText);
                }
            );
        });
    if (WaiterResponseType.SUCCESS === getClipboardTextItemResult.type) {
        return getClipboardTextItemResult.body;
    } else {
        console.warn("Failed attempt to get text from clipboard item");
        return null;
    }
}

function containerWithCopyPastElementMouseMoveEventHandler(event) {
    if (!hasParentWithIdOrClass(event.target, ['main-flow-container'])) {
        return;
    }
    if (toolBarPasteArea && document.activeElement === toolBarPasteArea) {
        return;
    }
    if (toolBarPasteArea) {
        toolBarPasteArea.focus();
    }
}

//======================================================================================================================

document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('input[name="protectWithPasswordChoice"]').forEach((element) => {
        element.addEventListener('change', function () {
            setProtectionTypeChoice(this.value);
        });
    });
    document.querySelectorAll('input[name="protectWithCaptchaChoice"]').forEach((element) => {
        element.addEventListener('change', function () {
            setProtectionTypeChoice(this.value);
        });
    });
    selectFilesBtn.addEventListener('click', function () {
        fileInput.click();
    });
    fileInput.addEventListener('change', async function (event) {
        if (event.target.files && fileInput.value && event.target.files.length > 0) {
            const files = event.target.files;
            await processSelectedFiles(files);
        }
    });
    initEventsForCopyPasteArea();
});

//==================================File sharing implementation=========================================================
FileSharing.saveFileInCloud = async function (file, readMeText, forHuman, password) {
    return await FileSharing.saveContentInCloud(
        file.name, file.type, file.size, readMeText,
        async function (manifest, storeInCloud, encryptionContract) {
            return await readFileSequentially(file, async function (inOrder, arrayBuffer) {
                return await processBinaryChunk(manifest, inOrder, arrayBuffer, storeInCloud, encryptionContract);
            }, `Failed file sharing attempt: ${file.name}`);
        },
        forHuman,
        password
    );
}

FileSharing.saveContentInCloud = async function (name, type, size, inReadMeText, splitAndStoreProcessor, forHuman, password) {
    let readMeText = inReadMeText ? inReadMeText : '';
    if (FileSharing.defaultReadMeText === inReadMeText) {
        readMeText = `name = ${name}; size = ${Math.round(size / MemoryBlock.MB)} Mb; content-type = ${type}`;
    }
    const binaryId = uuid.v4().toString();
    const encryptionContract = password ? await generateEncryptionContract() : null;
    const createManifestResult = await createBinaryManifest(
        binaryId,
        name,
        type,
        readMeText,
        password,
        encryptionContract,
        true,
        forHuman
    );
    if ((WaiterResponseType.ERROR === createManifestResult.type) && createManifestResult.body) {
        showErrorMsg(`Cannot create manifest for file ${name}`, null);
        return false;
    }
    const manifest = createManifestResult.body;
    const saveResult = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === saveResult.type) {
        showErrorMsg(saveResult.body.body, null);
        return false;
    }
    const processFileResult = await splitAndStoreProcessor(manifest, true, encryptionContract);

    if (!processFileResult) {
        removeBinary(binaryId, function () {
            console.log(`Binary with id ${binaryId} was completely removed from DB`);
        });
        return false;
    }
    const cacheInCloudResult = await cacheBinaryManifestInCloud(manifest);
    if (WaiterResponseType.ERROR === cacheInCloudResult.type) {
        return false;
    }
    const result = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === result.type) {
        showErrorMsg(result.body.body, function () {
            removeBinary(binaryId, function () {
                console.log(`Binary with id ${binaryId} was completely removed from DB`);
            });
        });
        return false;
    }
    extractAndSharePublicUrl(manifest);
    return true;
}

function extractAndSharePublicUrl(newManifest) {
    delay(1000).then(() => {
        const publicUr = newManifest.getPublicUrl(FileSharing.workSpaceId, true);
        copyTextToClipboard(publicUr);
        showInfoMsg(`Public url was copied to clipboard`, publicUr);
    });
}

//======================================================================================================================

//=========================================Dialogs======================================================================

const infoDialog = document.getElementById("infoDialog");
const infoMsg = document.getElementById("infoMsg");

function showInfoMsg(msg, url = null) {
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
    }
    showInfoDialog();
}

function showInfoDialog() {
    infoDialog.classList.add('visible');
}

const errorDialog = document.getElementById("errorDialog");
const errorMsg = document.getElementById("errorMsg");
const closeErrorBtn = document.getElementById("closeErrorBtn");

function showErrorMsg(msg, afterCloseHandler) {
    errorMsg.textContent = msg;
    FileSharing.afterErrorMsgClosedHandler = afterCloseHandler;
    errorDialog.classList.add('visible');
}

//======================================================================================================================

//===============================================Initialize WS connection===============================================

function openBrowserDataBase() {
    openDataBase(
        FileSharing.deviceFpId,
        () => {
            console.log("Connection to browser DB was successfully open.");
        });
}

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        FileSharing.deviceFpId = result.visitorId;
        FileSharing.workSpaceId = FileSharing.deviceFpId;
        openWsConnection(result.visitorId);
        openBrowserDataBase();
        FileSharing.pingIntervalId = window.setInterval(function () {
            PushcaClient.sendPing();
            if (!dbConnectionHealthCheck()) {
                closeDataBase();
                openBrowserDataBase();
            } else {
                console.log("Connection to DB is healthy");
            }
        }, 30000);
    });
});

PushcaClient.onCloseHandler = function (ws, event) {
    if (!event.wasClean) {
        console.log(event);
        console.error(`Your connection died with exit code ${event.code}, refresh the page please`);
    }
    //channelIndicator.style.backgroundColor = 'red';
};

async function openWsConnection(deviceFpId) {
    FileSharing.deviceSecret = await getDeviceSecret();
    if (!PushcaClient.isOpen()) {
        FileSharing.sessionId = uuid.v4().toString();
        FileSharing.deviceFpHash = await calculateSha256(stringToArrayBuffer(deviceFpId));
        const pClient = new ClientFilter(
            `${calculateStringHashCode(deviceFpId)}`,
            "anonymous-sharing",
            JSON.stringify({fp: FileSharing.deviceFpHash, session: FileSharing.sessionId}),
            FileSharing.applicationId
        );

        return await PushcaClient.openWsConnection(
            FileSharing.wsUrl,
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            },
            true
        );
    }
}

window.addEventListener("beforeunload", function () {
    if (FileSharing.pingIntervalId) {
        clearInterval(FileSharing.pingIntervalId);
    }
});
//======================================================================================================================