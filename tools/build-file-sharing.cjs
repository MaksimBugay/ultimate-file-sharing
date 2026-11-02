// Rebuild the shared bundle; secret-message pages use only its crypto/API core.
const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');
const root = path.resolve(__dirname, '..');
const files = 'fp.min.js detect.min.js client.min.js uuid.min.js qrcode.min.js jsQR.js purify.min.js device-secret.js common-utils.js thumbnail-utils.js thumbnail-image.js thumbnail-video.js thumbnail-text.js thumbnail-generator.js callable-future.js pnotifications.js pushca-binary-helper.js security-utils.js gateway-server.js binary-chunks-db.js consent-dialog.js file-sharing-commons.js downloadRemoteStream.js file-sharing-embedded.js'.split(' ');
const bridge = `
if (document.body.hasAttribute('data-secret-message-page')) {
    Object.assign(window, {PushcaClient, generateAESKeyFromPassword, EncryptionContract,
        arrayBufferToBase64, encryptWithAESUsingContract, decryptAESToArrayBuffer,
        calculateSha256, byteArrayToBase64, base64ToArrayBuffer, getDeviceSecret, isMobile});
    return;
}
`;
(async () => {
    const source = files.map(file => (file === 'consent-dialog.js' ? bridge : '') +
        fs.readFileSync(path.join(root, 'js', file), 'utf8')).join('\n;\n');
    const result = await minify('(function () {\n' + source + '\n})();', {
        compress: {passes: 3, drop_console: true, drop_debugger: true},
        mangle: {toplevel: true}, toplevel: true
    });
    fs.writeFileSync(path.join(root, 'js/file.sharing.min.js'), result.code);
})().catch(error => { console.error(error); process.exitCode = 1; });
