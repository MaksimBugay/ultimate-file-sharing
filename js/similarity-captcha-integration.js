const ChallengeAttributes = {};
ChallengeAttributes.apiKey = null;
ChallengeAttributes.sessionId = null;
ChallengeAttributes.clientIp = null;
ChallengeAttributes.pageId = null;
ChallengeAttributes.origin = window.location.origin;

async function initChallengeAttributes() {
    ChallengeAttributes.apiKey = uuid.v4().toString();
    ChallengeAttributes.sessionId = uuid.v4().toString();
    ChallengeAttributes.clientIp = await getClientIp();
    ChallengeAttributes.pageId = await generatePageId(
        ChallengeAttributes.apiKey,
        ChallengeAttributes.sessionId,
        ChallengeAttributes.clientIp
    );
}

function createSimilarityChallengeDialog(container, removeOnCancel, humanTokenConsumer) {
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
        await initChallengeAttributes();
        // open immediately (safe from popup blocker)
        const popupRef = window.open("about:blank", "_blank");
        popupRef.location.href = `https://secure.fileshare.ovh/similarity-captcha.html?orn=${encodeURIComponent(ChallengeAttributes.origin)}&pid=${ChallengeAttributes.pageId}`;

        // Optional: hide dialog after launch
        dialog.style.display = "none";
    };

    cancelBtn.onclick = function () {
        dialog.innerHTML = "<p>Challenge canceled.</p>";
        if (removeOnCancel) {
            dialog.remove();
        }
    };

    // receive message from child captcha
    window.addEventListener("message", async function (event) {
        console.log("Child says:", event.data);

        const token = event.data.value.token;
        const msgPageId = event.data.value.pageId;

        if (msgPageId !== ChallengeAttributes.pageId) {
            renderIsHumanResponse(
                `<h1 class="error-text">Error</h1><p>Tampered Human token was received</p>`
            );
            return;
        }

        const isValid = await validateAdvancedHumanToken(
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
            renderIsHumanResponse(
                `<h1 class="error-text">Error</h1><p>Invalid Human token was received</p>`
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

