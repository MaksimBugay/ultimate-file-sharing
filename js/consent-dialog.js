const ConsentDialog = {}

// Elements
const consentDialog = document.getElementById('consentDialog');
const allowClipboard = document.getElementById('allowClipboard');
const denyClipboard = document.getElementById('denyClipboard');

// Handle Allow button click to request permissions and perform clipboard operations
allowClipboard.addEventListener('click', async function () {
    // Requesting clipboard access on user interaction
    try {
        if (ConsentDialog.copyTextValue) {
            navigator.clipboard.writeText(ConsentDialog.copyTextValue).then(() => {
                consentDialog.classList.remove('visible');
            });
        }
    } catch (err) {
        console.error("Clipboard permission denied or failed: ", err);
        consentDialog.classList.remove('visible');
    }
});

// Handle Deny button click (Close the dialog)
denyClipboard.addEventListener('click', function () {
    consentDialog.classList.remove('visible');
});

function copyTextToClipboard(text) {
    // Check if the Clipboard API is supported
    if (navigator.clipboard && window.isSecureContext) {
        // Use the Clipboard API
        navigator.clipboard.writeText(text).then(() => {
            console.log('Text copied to clipboard');
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            ConsentDialog.copyTextValue = text;
            //consentDialog.classList.add('visible');
        });
    } else {
        // Fallback for older browsers
        let textArea = document.createElement("textarea");
        textArea.value = text;

        // Avoid scrolling to bottom
        textArea.style.top = "0";
        textArea.style.left = "0";
        textArea.style.position = "fixed";

        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            let successful = document.execCommand('copy');
            let msg = successful ? 'successful' : 'unsuccessful';
            console.log('Fallback: Copying text command was ' + msg);
        } catch (err) {
            console.error('Fallback: Oops, unable to copy', err);
        }

        document.body.removeChild(textArea);
    }
}
