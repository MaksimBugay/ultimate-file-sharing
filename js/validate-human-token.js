
async function getClientIp() {
    const res = await fetch("https://api.ipify.org?format=json");
    const { ip } = await res.json();
    return ip;
}
async function generatePageId(apiKey, sessionId) {
    const url = 'https://secure.fileshare.ovh/binary/generate-page-id';
    const clientIp = await getClientIp();
    const payload = {
        apiKey: apiKey,
        clientIp: clientIp,
        sessionId: sessionId
    };

    try {
        const response = await fetch(url, {
            method: 'POST', // HTTP method
            headers: {
                'Content-Type': 'application/json' // Specify JSON content type
            },
            body: JSON.stringify(payload) // Convert the payload to JSON
        });

        if (response.ok) {
            const responseJson = await response.json(); // Parse the JSON response
            console.log('Generate page id response:', responseJson);
            const {pageId} = responseJson;
            return pageId;
        } else {
            console.error('Failed to generate page id. Status:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Error occurred during generate page id attempt:', error);
        return false;
    }
}

async function validateAdvancedHumanToken(pageId, token, apiKey){
    const url = 'https://secure.fileshare.ovh/pushca/similarity-captcha/validate-human-token';
    const payload = {
        pageId: pageId,
        token: token,
        apiKey: apiKey
    };

    try {
        const response = await fetch(url, {
            method: 'POST', // HTTP method
            headers: {
                'Content-Type': 'application/json' // Specify JSON content type
            },
            body: JSON.stringify(payload) // Convert the payload to JSON
        });

        if (response.ok) {
            const validateResponse = await response.json(); // Parse the JSON response
            console.log('Validation response:', validateResponse);
            const {valid} = validateResponse;
            return valid;
        } else {
            console.error('Failed to validate advanced human token. Status:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Error occurred while validating advanced human token:', error);
        return false;
    }
}

async function validateHumanToken(pageId, token) {
    const url = 'https://secure.fileshare.ovh/pushca/dynamic-captcha/validate-human-token';
    const payload = {
        pageId: pageId,
        token: token
    };

    try {
        const response = await fetch(url, {
            method: 'POST', // HTTP method
            headers: {
                'Content-Type': 'application/json' // Specify JSON content type
            },
            body: JSON.stringify(payload) // Convert the payload to JSON
        });

        if (response.ok) {
            const isValid = await response.json(); // Parse the JSON response
            console.log('Validation result:', isValid);
            return 'true' === `${isValid}`;
        } else {
            console.error('Failed to validate human token. Status:', response.status);
            return false;
        }
    } catch (error) {
        console.error('Error occurred while validating human token:', error);
        return false;
    }
}