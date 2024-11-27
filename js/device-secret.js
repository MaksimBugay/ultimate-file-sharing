async function getDeviceSecret() {
    const client = new ClientJS();
    const fingerprint = client.getFingerprint();

    const userAgent = navigator.userAgent;
    const detectionResult = detect.parse(userAgent);

    const os = detectionResult?.os?.name || 'Unknown OS';
    const osVersion = detectionResult?.os?.version || 'Unknown Version';
    const browser = detectionResult?.browser?.name || 'Unknown Browser';
    const browserVersion = detectionResult?.browser?.version || 'Unknown Version';
    const deviceType = detectionResult?.device?.type || 'Unknown Device';
    const deviceModel = detectionResult?.device?.model || 'Unknown Model';

    const deviceFP = {
        Id: `${fingerprint}`,
        OS: `${os} ${osVersion}`,
        Browser: `${browser} ${browserVersion}`,
        Device: `${deviceType} ${deviceModel}`
    };

    return await calculateSha256(stringToArrayBuffer(JSON.stringify(deviceFP)));
}