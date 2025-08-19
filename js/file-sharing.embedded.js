const ProtectionType = Object.freeze({
    PASSWORD: 'pPassword',
    CAPTCHA: 'pCaptcha'
});

FileSharing = {}

const protectWithPasswordChoice = document.getElementById("protectWithPasswordChoice");
const protectWithCaptchaChoice = document.getElementById("protectWithCaptchaChoice");
const passwordInputContainer = document.getElementById("passwordInputContainer");
const passwordInput = document.getElementById("passwordInput");
const selectFilesBtn = document.getElementById('selectFilesBtn');
const fileTransferProgressBtn = document.getElementById('fileTransferProgressBtn');
const fileInput = document.getElementById('fileInput');
fileInput.removeAttribute('webkitdirectory');
fileInput.setAttribute('multiple', '');

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
    for (let i = 0; i < files.length; i++) {
        console.log(files[i].name)
        await delay(3000);
        /*await TransferFileHelper.transferFileToVirtualHostBase(
            files[i],
            receiverVirtualHost.value,
            ownerVirtualHost.value,
            "Failed file transfer attempt: receiver is not unavailable",
            FileSharing
        );*/
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

