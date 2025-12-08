document.addEventListener('DOMContentLoaded', async function () {
    const apiKey = uuid.v4().toString();
    const sessionId = uuid.v4().toString();
    const pageId = await generatePageId(apiKey, sessionId);
    const captchaContainer = document.getElementById('captchaContainer');
    if (!captchaContainer) return;

    await addVisualSimilarityChallenge(
        captchaContainer,
        apiKey,
        pageId,
        async function (token) {
            //alert(`Human token was received for page with id = ${pageId}: ${token}`);
            const isValid = await validateAdvancedHumanToken(pageId, token, apiKey);
            if (isValid) {
                console.log(`"${pageId}", "${token}"`);
                alert(`Advanced human token is valid: ${token}`);
            }
        }
    );
});

async function addVisualSimilarityChallenge(captchaContainer, apiKey, pageId, humanTokenConsumer) {
    if (!captchaContainer) return;

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
        while ((!isElementFullyVisible(captchaFrame)) && (scaleK > 0.0)) {
            scaleK = scaleK - 0.1;
            captchaContainer.style.transform = `scale(${scaleK})`;
        }
    }

    PushcaClient.onHumanTokenHandler = async function (token) {
        if (typeof humanTokenConsumer === 'function') {
            await humanTokenConsumer(token);
        }

        closeAll();
    }

    PushcaClient.onOpenHandler = function () {
        delay(120000).then(() => closeAll());
    };

    await openWsConnection(apiKey, pageId);
}

function getVisibleWidth() {
    const bodyRect = document.body.getBoundingClientRect();
    const htmlRect = document.documentElement.getBoundingClientRect();

    // Pick the smaller width that fits inside viewport
    const viewportWidth = Math.min(
        bodyRect.width,
        htmlRect.width,
        window.innerWidth,
        window.visualViewport?.width || Infinity
    );

    return Math.round(viewportWidth);
}

function getVisibleHeight() {
    const bodyRect = document.body.getBoundingClientRect();
    const htmlRect = document.documentElement.getBoundingClientRect();

    const viewportHeight = Math.min(
        bodyRect.height,
        htmlRect.height,
        window.innerHeight,
        window.visualViewport?.height || Infinity
    );

    return Math.round(viewportHeight);
}

function getVisibleViewportSize() {
    // visualViewport gives the visible area of the page
    const width = getVisibleWidth();
    const height = getVisibleHeight();

    return {width, height};
}

function reCenterCaptchaFrame(captchaContainer) {
    if (!captchaContainer) {
        return;
    }
    const viewport = getVisibleViewportSize();
    captchaContainer.style.position = 'absolute';
    const rect = captchaContainer.getBoundingClientRect();
    captchaContainer.style.left = Math.round((viewport.width - rect.width) / 2) + 'px';
    captchaContainer.style.top = Math.round((viewport.height - rect.height) / 2) + 'px';
    captchaContainer.style.visibility = 'visible';
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
        delay(1000).then(
            () => reCenterCaptchaFrame(document.getElementById("captchaContainer"))
        );
    }
}

function closeAll() {
    if (PushcaClient.isOpen()) {
        PushcaClient.stopWebSocketPermanently();
    }
    const captchaContainer = document.getElementById("captchaContainer");
    if (captchaContainer) {
        captchaContainer.remove();
    }
    window.close();
}
