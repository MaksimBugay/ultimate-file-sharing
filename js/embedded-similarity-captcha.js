async function addVisualSimilarityChallenge(captchaContainer, pageId, humanTokenConsumer) {
    if (!captchaContainer) return;

    // Add the class to the existing container
    captchaContainer.style.width = "auto";
    captchaContainer.style.transformOrigin = "top left !important";
    captchaContainer.style.display = 'inline-block';

    let captchaFrame = document.getElementById('captchaFrame');
    // Create and configure the iframe
    if (!captchaFrame) {
        captchaFrame = document.createElement('iframe');
        captchaFrame.id = 'captchaFrame';
        captchaFrame.className = "similarity-captcha-iframe";
        captchaFrame.style.padding = '0';
        captchaFrame.style.margin = '0';

        // Append the iframe to the container
        captchaContainer.appendChild(captchaFrame);
    }
    captchaFrame.style.width = '610px';
    captchaFrame.style.height = '1280px';
    captchaFrame.src = `https://secure.fileshare.ovh/similarity-captcha-min.html?page-id=${pageId}&piece-length=300`;

    let scaleK = 1;
    if (captchaContainer && captchaFrame) {
        while ((!isElementFullyVisible(captchaFrame)) && (scaleK > 0.4)) {
            scaleK = scaleK - 0.1;
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