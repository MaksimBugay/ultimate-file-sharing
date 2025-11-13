async function addVisualSimilarityChallenge(captchaContainer, pageId, humanTokenConsumer) {
    if (!captchaContainer) return;

    // Add the class to the existing container
    captchaContainer.classList.add('embedded-similarity-challenge-container');

    // Apply margin styles
    captchaContainer.style.marginTop = '15px';
    captchaContainer.style.marginLeft = '5px';

    // Create and configure the iframe
    const captchaFrame = document.createElement('iframe');
    captchaFrame.id = 'captchaFrame';
    captchaContainer.classList.add('embedded-similarity-challenge-container');
    captchaFrame.style.padding = '0';
    captchaFrame.style.margin = '0';
    captchaFrame.style.width = '620px';
    captchaFrame.style.height = '1280px';
    captchaFrame.src = `https://secure.fileshare.ovh/similarity-captcha-min.html?page-id=${pageId}&piece-length=300`;

    // Append the iframe to the container
    captchaContainer.appendChild(captchaFrame);
    captchaContainer.style.transformOrigin = "top left";
    let scaleK = 1;
    if (captchaContainer && captchaFrame) {
        while (!isElementFullyVisible(captchaFrame)) {
            scaleK = scaleK - 0.1 * (isMobile() ? 1.7 : 1);
            captchaContainer.style.transform = `scale(${scaleK})`;
        }
    }

    PushcaClient.onHumanTokenHandler = async function (token) {
        PushcaClient.stopWebSocketPermanently();
        document.getElementById("captchaFrame").remove();

        if (typeof humanTokenConsumer === 'function') {
            humanTokenConsumer(token);
        }
    }

    await openWsConnection(null, pageId);
}

async function openWsConnection(apiKey, pageId) {
    if (!PushcaClient.isOpen()) {
        const pClient = new ClientFilter(
            "SecureFileShare",
            "dynamic-captcha",
            pageId,
            "CAPTCHA_CLIENT"
        );
        await PushcaClient.openWsConnection(
            'wss://secure.fileshare.ovh:31085',
            pClient,
            function (clientObj) {
                return new ClientFilter(
                    clientObj.workSpaceId,
                    clientObj.accountId,
                    clientObj.deviceId,
                    clientObj.applicationId
                );
            },
            apiKey
        );
    }
}