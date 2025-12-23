const ProtectionType = Object.freeze({
    PASSWORD: 'pPassword',
    CAPTCHA: 'pCaptcha'
});

FileSharing = {}
FileSharing.applicationId = 'SIMPLE_FILE_SHARING';
FileSharing.wsUrl = 'wss://secure.fileshare.ovh:31085';
FileSharing.parentClient = null;
FileSharing.saveInCloudProcessor = async function (thumbnailId, thumbnailWorkspaceId, thumbnailName,
                                                   type, thumbnailBlob, expiredAt) {
    await FileSharing.saveBlobWithIdInCloud(
        thumbnailId,
        thumbnailWorkspaceId,
        thumbnailName,
        type,
        FileSharing.defaultReadMeText,
        thumbnailBlob,
        false,
        null,
        expiredAt
    )
}
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('page-id')) {
    const pageId = urlParams.get('page-id');
    FileSharing.parentClient = new ClientFilter(
        "SecureFileShare",
        "file-sharing-embedded",
        pageId,
        "FILE-SHARING-CHROME-EXTENSION"
    );
}

const protectWithPasswordChoice = document.getElementById("protectWithPasswordChoice");
const protectWithCaptchaChoice = document.getElementById("protectWithCaptchaChoice");
const passwordInputContainer = document.getElementById("passwordInputContainer");
const passwordInput = document.getElementById("passwordInput");
const selectFilesBtn = document.getElementById('selectFilesBtn');
const fileTransferProgressBtn = document.getElementById('fileTransferProgressBtn');
const readMeTextMemo = document.getElementById("readMeTextMemo");
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

async function shareContent(processContentFunction) {
    fileTransferProgressBtn.style.display = 'block';
    selectFilesBtn.disabled = true;
    dropZone.disabled = true;
    dropZone.classList.add('disabled-zone');

    if (typeof processContentFunction === 'function') {
        await processContentFunction();
    }

    await afterAllCleanup(null, false);
}

async function afterAllCleanup(binaryId, withPageRefresh) {
    if (binaryId) {
        removeBinary(binaryId, function () {
            console.debug(`Binary with id ${binaryId} was completely removed from DB`);
        });
        const result = await PushcaClient.sendDeleteBinaryAppeal(binaryId, FileSharing.deviceSecret);
        const responseObject = JSON.parse(result);
        if (responseObject.body !== 'true') {
            console.log(result);
            if (responseObject.error) {
                showErrorMsg(responseObject.error, null);
            }
        }
    }
    FileSharing.extraProgressHandler = null;
    fileTransferProgressBtn.style.display = 'none';
    fileInput.value = "";
    selectFilesBtn.disabled = false;
    dropZone.disabled = false;
    dropZone.classList.remove('disabled-zone');

    if (withPageRefresh) {
        window.location.assign(window.location.href);
    }
}

function currentTimestampPlusDays(n) {
    const now = Date.now(); // milliseconds
    const msInDay = 24 * 60 * 60 * 1000;
    return Math.floor((now + n * msInDay) / 1000);
}

function getBinaryLinkExpirationTime() {
    return currentTimestampPlusDays(30);
}

async function processSelectedFiles(files) {
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
            (protectionAttributes && (ProtectionType.PASSWORD === protectionAttributes.type)) ? protectionAttributes.pwd : null,
            getBinaryLinkExpirationTime()
        );
    }
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

//=================================Drop zone============================================================================
const dropZone = document.getElementById('dropZone');

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

function initDropZone(dzElement) {
// Prevent default behavior for drag and drop events (to prevent opening the file in the browser)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dzElement.addEventListener(eventName, preventDefaults, false);
    });

// Add visual feedback for when file is being dragged over the drop zone
    ['dragenter', 'dragover'].forEach(eventName => {
        dzElement.addEventListener(eventName, () => dzElement.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dzElement.addEventListener(eventName, () => dzElement.classList.remove('dragover'), false);
    });
}

initDropZone(dropZone);

dropZone.addEventListener('drop', async function (event) {
    await shareContent(
        () => processSelectedFiles(event.dataTransfer.files)
    )
    delay(500).then(() => {
        event.dataTransfer.clearData();
    });
});

//======================================================================================================================

//=================================Copy/Paste area======================================================================

function passwordInputIsActive() {
    return document.activeElement.id === passwordInput.id;
}

function readMeMemoIsActive() {
    return document.activeElement.id === readMeTextMemo.id;
}

function initEventsForCopyPasteArea() {
    if (document.getElementById('selectFilesSubContainer')) {
        document.getElementById('selectFilesSubContainer').addEventListener(
            'mousemove', function () {
                if (passwordInputIsActive() || readMeMemoIsActive()) {
                    return;
                }
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

        await shareContent(
            () => processClipboardItems(clipboardItems)
        );
    });
}

async function processClipboardItems(clipboardItems) {
    let textItems = null;
    const protectionAttributes = getProtectionAttributes();
    const forHuman = protectionAttributes ? (ProtectionType.CAPTCHA === protectionAttributes.type) : false;
    const binaryPassword = (protectionAttributes && (ProtectionType.PASSWORD === protectionAttributes.type)) ? protectionAttributes.pwd : null;
    const expiredAt = getBinaryLinkExpirationTime();

    for (let item of clipboardItems) {
        if (item.kind === 'file') {
            const blob = item.getAsFile();
            //console.log(blob);
            const mimeType = blob.type;
            const name = getCopyPastName(mimeType, blob.name);
            console.log(name);
            await FileSharing.saveBlobInCloud(
                name,
                blob.type,
                await getReadMeText(),
                blob,
                forHuman,
                binaryPassword,
                expiredAt
            );
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
            await FileSharing.saveBlobInCloud(
                name,
                textBlob.type,
                await getReadMeText(),
                textBlob,
                forHuman,
                binaryPassword,
                expiredAt
            );
        }
    }
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
    if (passwordInputIsActive() || readMeMemoIsActive()) {
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
            await shareContent(
                () => processSelectedFiles(files)
            )
        }
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            if (isErrorDialogVisible()) {
                closeErrorDialog();
            } else if (isInfoDialogVisible()) {
                closeInfoDialog();
            }
        }
    });
    initEventsForCopyPasteArea();
    if (toolBarPasteArea) {
        toolBarPasteArea.focus();
    }
});

//==================================File sharing implementation=========================================================
FileSharing.saveFileInCloud = async function (file, inReadMeText, forHuman, password, expiredAt) {
    const binaryId = uuid.v4().toString();
    //generate and save thumbnail here
    await ThumbnailGenerator.buildAndSaveThumbnail(
        binaryId,
        file,
        file.name,
        file.type,
        `name = ${file.name}; size = ${calculateDisplaySizeMb(file.size)} Mb; content-type = ${file.type}`,
        FileSharing.saveInCloudProcessor,
        expiredAt
    );
    return await FileSharing.saveContentInCloud(
        binaryId,
        file.name, file.type, file.size, inReadMeText,
        async function (manifest, storeInCloud, encryptionContract) {
            return await readFileSequentially(file, async function (inOrder, arrayBuffer) {
                return await processBinaryChunk(manifest, inOrder, arrayBuffer, storeInCloud, encryptionContract);
            }, `Failed file sharing attempt: ${file.name}`);
        },
        forHuman,
        password,
        expiredAt
    );
}

FileSharing.saveBlobInCloud = async function (name, type, inReadMeText, blob, forHuman, password, expiredAt) {
    const binaryId = uuid.v4().toString();
    //generate and save thumbnail here
    await ThumbnailGenerator.buildAndSaveThumbnail(
        binaryId,
        blob,
        name,
        type,
        `name = ${name}; size = ${calculateDisplaySizeMb(blob.size)} Mb; content-type = ${type}`,
        FileSharing.saveInCloudProcessor,
        expiredAt
    );
    return await FileSharing.saveBlobWithIdInCloud(
        binaryId,
        FileSharing.workSpaceId,
        name,
        type,
        inReadMeText,
        blob,
        forHuman,
        password,
        expiredAt
    )
}

FileSharing.saveBlobWithIdInCloud = async function (binaryId, workSpaceId, name, type, readMeText, blob,
                                                    forHuman, password, expiredAt) {
    return await FileSharing.saveContentWithWorkSpaceIdInCloud(
        binaryId,
        workSpaceId,
        name, type, blob.size, readMeText,
        async function (manifest, storeInCloud, encryptionContract) {
            const chunks = await blobToArrayBuffers(blob, MemoryBlock.MB);
            let pipeWasBroken = false;
            await executeWithShowProgressBar(async function (progressBarWidget) {
                for (let i = 0; i < chunks.length; i++) {
                    const processChunkResult = await processBinaryChunk(
                        manifest,
                        i + 1,
                        chunks[i],
                        true,
                        encryptionContract
                    );
                    const progress = Math.round(((i + 1) / chunks.length) * 100);
                    progressBarWidget.setProgress(progress);
                    if (typeof FileSharing.extraProgressHandler === 'function') {
                        FileSharing.extraProgressHandler();
                    }
                    if (!processChunkResult) {
                        showErrorMsg(
                            `Failed share file attempt: ${name}`,
                            function () {
                                afterAllCleanup(binaryId, true);
                            }
                        );
                        pipeWasBroken = true;
                        return;
                    }
                }
            }, FileSharing);
            chunks.length = 0;
            return !pipeWasBroken;
        },
        forHuman,
        password,
        expiredAt
    );
}

FileSharing.saveContentInCloud = async function (binaryId, name, type, size, inReadMeText, splitAndStoreProcessor,
                                                 forHuman, password, expiredAt) {
    return await FileSharing.saveContentWithWorkSpaceIdInCloud(
        binaryId,
        FileSharing.workSpaceId,
        name,
        type,
        size,
        inReadMeText,
        splitAndStoreProcessor,
        forHuman,
        password,
        expiredAt
    );
}

function calculateDisplaySizeMb(size) {
    let sizeMb = Math.round(size / MemoryBlock.MB);
    if (sizeMb === 0) {
        sizeMb = 0.001;
    }
    return sizeMb;
}

FileSharing.saveContentWithWorkSpaceIdInCloud = async function (binaryId, workSpaceId, name, type, size, inReadMeText,
                                                                splitAndStoreProcessor, forHuman, password, expiredAt) {
    let readMeText = inReadMeText ? inReadMeText : '';
    if (FileSharing.defaultReadMeText === inReadMeText) {
        readMeText = `name = ${name}; size = ${calculateDisplaySizeMb(size)} Mb; content-type = ${type}`;
    }
    const encryptionContract = password ? await generateEncryptionContract() : null;
    const createManifestResult = await createBinaryManifest(
        binaryId,
        name,
        type,
        readMeText,
        password,
        encryptionContract,
        true,
        forHuman,
        workSpaceId,
        expiredAt
    );
    if ((WaiterResponseType.ERROR === createManifestResult.type) && createManifestResult.body) {
        showErrorMsg(
            `Cannot create manifest for file ${name}`,
            () => afterAllCleanup(null, true)
        );
        return false;
    }
    const manifest = createManifestResult.body;
    const saveResult = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === saveResult.type) {
        showErrorMsg(
            saveResult.body.body,
            () => afterAllCleanup(manifest.id, true)
        );
        return false;
    }
    const processFileResult = await splitAndStoreProcessor(manifest, true, encryptionContract);

    if (!processFileResult) {
        await afterAllCleanup(binaryId, true);
        return false;
    }
    const cacheInCloudResult = await cacheBinaryManifestInCloud(manifest);
    if (WaiterResponseType.ERROR === cacheInCloudResult.type) {
        return false;
    }
    const result = await saveBinaryManifestToDatabase(manifest);
    if (WaiterResponseType.ERROR === result.type) {
        showErrorMsg(
            result.body.body,
            () => afterAllCleanup(manifest.id, true)
        );
        return false;
    }
    if (name.startsWith('thumbnail')) {
        return true;
    }
    const urlWithThumbnail = await buildPublicUrl(manifest);
    if (FileSharing.parentClient) {
        await PushcaClient.broadcastMessage(
            null,
            FileSharing.parentClient,
            false,
            urlWithThumbnail
        );
    }
    const dialogId = uuid.v4().toString();
    const dialogResult = await CallableFuture.callAsynchronously(
        300_000,
        dialogId,
        () => {
            sharePublicUrlViaInfoMessage(urlWithThumbnail, dialogId);
        }
    );
    if (WaiterResponseType.SUCCESS !== dialogResult.type) {
        console.warn("Failed attempt to register close modal window event");
    }
    if (FileSharing.parentClient) {
        delay(100).then(() => {
            window.close();
        });
    }
    return true;
}

async function getFinalProtectedUrl(url) {
    await delay(1000);
    const response = await fetch(url, {
        method: "GET",
        redirect: "follow" // default, but explicit here
    });

    return response.url;
}

async function removeLocalBinary(manifest) {
    const result = await CallableFuture.callAsynchronously(
        1000, null, function (waiterId) {
            removeBinary(manifest.id, function () {
                console.debug(`Binary with id ${manifest.id} was completely removed from DB`);
                CallableFuture.releaseWaiterIfExistsWithSuccess(waiterId, manifest.id);
            });
        });
    if (WaiterResponseType.SUCCESS === result.type) {
        return true;
    } else {
        console.warn(`Failed attempt to remove local binary with id ${manifest.id}`);
        return false;
    }
}

async function buildPublicUrl(manifest) {
    await removeLocalBinary(manifest);

    const publicUrWithoutThumbnail = manifest.getPublicUrl(FileSharing.workSpaceId, true);

    let publicUrl = publicUrWithoutThumbnail;
    if (!publicUrWithoutThumbnail.includes('tn=')) {
        publicUrl = `${publicUrWithoutThumbnail}&tn=${buildThumbnailId(manifest.id)}`;
    }
    if (manifest.password) {
        return await getFinalProtectedUrl(publicUrl);
    }

    return publicUrl.replace("public-binary.html", "public-binary-ex.html");
}

async function sharePublicUrlViaInfoMessage(publicUrlWithThumbnail, dialogId) {
    //copyTextToClipboard(publicUrlWithThumbnail);
    showInfoMsg(dialogId, `Public url was copied to clipboard`, publicUrlWithThumbnail);
}

//======================================================================================================================

//=========================================Dialogs======================================================================

const infoDialog = document.getElementById("infoDialog");
const infoMsg = document.getElementById("infoMsg");
const closeInfoBtn = document.getElementById("closeInfoBtn");

function isInfoDialogVisible() {
    return infoDialog.classList.contains('visible');
}

function closeInfoDialog() {
    infoDialog.classList.remove('visible');
    if (FileSharing.actveInfoMsgId) {
        CallableFuture.releaseWaiterIfExistsWithSuccess(FileSharing.actveInfoMsgId, "closed");
        FileSharing.actveInfoMsgId = null;
    }
    if (FileSharing.activeInfoUrl) {
        copyTextToClipboard(FileSharing.activeInfoUrl);
        if (isMobile()) {
            showNativeShareDialog(name, FileSharing.activeInfoUrl).then(ableToShow => {
                if (!ableToShow) {
                    console.log('Cannot show native share dialog');
                }
            });
        }
        FileSharing.activeInfoUrl = null;
    }
}

async function showNativeShareDialog(vText, vUrl) {
    if (navigator.share) {
        try {
            await navigator.share({
                title: vText,
                text: `Download link ${vText}`,
                url: vUrl
            });
            return true;
        } catch (error) {
            console.error('Error sharing:', error);
        }
    } else {
        console.log('Web Share API not supported on this browser.');
    }
    return false;
}

function showInfoDialog() {
    infoDialog.classList.add('visible');
}

closeInfoBtn.addEventListener('click', function () {
    closeInfoDialog();
});

function showInfoMsg(dialogId, msg, url = null) {
    FileSharing.actveInfoMsgId = dialogId;
    FileSharing.activeInfoUrl = url;
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

const errorDialog = document.getElementById("errorDialog");
const errorMsg = document.getElementById("errorMsg");
const closeErrorBtn = document.getElementById("closeErrorBtn");

function showErrorMsg(msg, afterCloseHandler) {
    errorMsg.textContent = msg;
    FileSharing.afterErrorMsgClosedHandler = afterCloseHandler;
    errorDialog.classList.add('visible');
}

closeErrorBtn.addEventListener('click', function () {
    closeErrorDialog();
});

function isErrorDialogVisible() {
    return errorDialog.classList.contains('visible');
}

function closeErrorDialog() {
    errorDialog.classList.remove('visible');
    if (typeof FileSharing.afterErrorMsgClosedHandler === 'function') {
        FileSharing.afterErrorMsgClosedHandler();
        FileSharing.afterErrorMsgClosedHandler = null;
    }
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