const ChallengeAttributes = {};
ChallengeAttributes.apiKey = null;
ChallengeAttributes.sessionId = null;
ChallengeAttributes.clientIp = null;
ChallengeAttributes.pageId = null;
ChallengeAttributes.origin = window.location.origin;
ChallengeAttributes.successfullyOpen = false;
ChallengeAttributes.numberOfFailedAttempt = 0;
ChallengeAttributes.popupRef = null;
ChallengeAttributes.hideValidationError = false;
ChallengeAttributes.generatePageIdFunction = async function (apiKey, sessionId, clientIp) {
    return await generatePageId(
        apiKey,
        sessionId,
        clientIp
    );
}
ChallengeAttributes.validateHumanTokenFunction = async function (pageId, token, apiKey, sessionId, clientIp) {
    return await validateAdvancedHumanToken(
        pageId,
        token,
        apiKey,
        sessionId,
        clientIp);
}

async function initChallengeAttributes() {
    ChallengeAttributes.apiKey = uuid.v4().toString();
    ChallengeAttributes.sessionId = uuid.v4().toString();
    ChallengeAttributes.clientIp = await getClientIp();
    ChallengeAttributes.pageId = await ChallengeAttributes.generatePageIdFunction(
        ChallengeAttributes.apiKey,
        ChallengeAttributes.sessionId,
        ChallengeAttributes.clientIp
    );
}

function createSimilarityChallengeDialog(container,
                                         removeOnCancel,
                                         humanTokenConsumer,
                                         hideValidationError,
                                         generatePageIdCustomFunction,
                                         validateHumanTokenCustomFunction) {
    if (hideValidationError) {
        ChallengeAttributes.hideValidationError = true;
    }
    if (typeof generatePageIdCustomFunction === 'function') {
        ChallengeAttributes.generatePageIdFunction = generatePageIdCustomFunction;
    }
    if (typeof validateHumanTokenCustomFunction === 'function') {
        ChallengeAttributes.validateHumanTokenFunction = validateHumanTokenCustomFunction;
    }
    initChallengeAttributes().then(
        () => createSimilarityChallengeDialogElements(container, removeOnCancel, humanTokenConsumer)
    );
}

function createSimilarityChallengeDialogElements(container, removeOnCancel, humanTokenConsumer) {
    // container
    const dialog = document.createElement("div");
    dialog.id = "scDialog";
    dialog.className = "sc-dialog-container";

    // header
    const header = document.createElement("h1");
    header.className = "sc-dialog-header";
    header.textContent = "Are you ready?";
    dialog.appendChild(header);

    // description
    const text = document.createElement("p");
    text.className = "sc-dialog-normal-text";
    text.textContent = "Take a visual similarity challenge to prove you are a human.";
    dialog.appendChild(text);

    // cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.id = "scCancelBtn";
    cancelBtn.className = "sc-dialog-button sc-dialog-cancel-btn";
    cancelBtn.textContent = "Cancel";
    dialog.appendChild(cancelBtn);

    // yes button
    const yesBtn = document.createElement("button");
    yesBtn.id = "scYesBtn";
    yesBtn.className = "sc-dialog-button sc-dialog-yes-btn";
    yesBtn.textContent = "Yes, start";
    dialog.appendChild(yesBtn);

    // append to provided parent
    if (container) {
        container.appendChild(dialog);
    }

    yesBtn.onclick = async function () {
        await openSimilarityChallengeTab();

        // Optional: hide dialog after launch
        dialog.style.display = "none";
    };

    cancelBtn.onclick = function () {
        dialog.innerHTML = "<p>Challenge canceled.</p>";
        if (removeOnCancel) {
            delay(2000).then(
                () => dialog.remove()
            );
        }
    };

    // receive message from child captcha
    window.addEventListener("message", async function (event) {
        console.log("Child says:", event.data);

        const msgPageId = event.data.value.pageId;

        if (event.data.msg === 'challenge_tab_was_open') {
            if (msgPageId === ChallengeAttributes.pageId) {
                console.log("Challenge tab was successfully open");
                ChallengeAttributes.successfullyOpen = true;
            }
            return;
        }

        if (event.data.msg === 'challenge_was_not_solved') {
            if (msgPageId === ChallengeAttributes.pageId) {
                console.log("Challenge was not solved");
                ChallengeAttributes.successfullyOpen = false;
                initChallengeAttributes().then(
                    () => openSimilarityChallengeTab()
                );
            }
            return;
        }

        const token = event.data.value.token;

        if (msgPageId !== ChallengeAttributes.pageId) {
            renderIsHumanErrorResponse(
                `<h1 class="error-text">Error</h1><p>Tampered Human token was received</p>`
            );
            return;
        }

        const isValid = await ChallengeAttributes.validateHumanTokenFunction(
            ChallengeAttributes.pageId,
            token,
            ChallengeAttributes.apiKey,
            ChallengeAttributes.sessionId,
            ChallengeAttributes.clientIp);

        if (isValid) {
            if (typeof humanTokenConsumer === 'function') {
                humanTokenConsumer(token, msgPageId);
            } else {
                renderIsHumanResponse(
                    `<h1>Thank you!</h1><p>Human token was acquired: </p><div class="small-text">${token}</div>`
                );
            }
        } else {
            renderIsHumanErrorResponse(
                `<h1 class="error-text">Error</h1><p>Invalid Human token was received</p>`
            );
        }
    });
}

async function openSimilarityChallengeTab() {
    if (ChallengeAttributes.numberOfFailedAttempt > 3) {
        if (ChallengeAttributes.popupRef && (!ChallengeAttributes.popupRef.closed)) {
            ChallengeAttributes.popupRef.close();
        }
        renderIsHumanResponse('<h1 class="error-text">Error</h1><p>Your internet connection is very unstable, try later.</p>');
        return null;
    }

    // open immediately (safe from popup blocker)
    const url = `https://secure.fileshare.ovh/similarity-captcha.html?orn=${encodeURIComponent(ChallengeAttributes.origin)}&pid=${ChallengeAttributes.pageId}`;
    if (ChallengeAttributes.popupRef) {
        ChallengeAttributes.popupRef.location.href = url;
    } else {
        ChallengeAttributes.popupRef = window.open(url, "_blank");
    }

    if (!ChallengeAttributes.popupRef) {
        alert("Please allow popups to start the challenge");
        return null;
    }

    delay(8000).then(() => {
        if (!ChallengeAttributes.successfullyOpen) {
            ChallengeAttributes.numberOfFailedAttempt = ChallengeAttributes.numberOfFailedAttempt + 1;
            initChallengeAttributes().then(
                () => openSimilarityChallengeTab()
            );
        }
    });
}

function renderIsHumanResponse(htmlStr) {
    const captchaDialog = document.getElementById("scDialog");
    if (!captchaDialog) {
        return
    }
    captchaDialog.innerHTML = htmlStr;
    captchaDialog.style.display = "block";
}

function renderIsHumanErrorResponse(htmlStr) {
    if (!ChallengeAttributes.hideValidationError) {
        return;
    }
    renderIsHumanResponse(htmlStr);
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

