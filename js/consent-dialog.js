
// Elements
const consentDialog = document.getElementById('consentDialog');
const allowClipboard = document.getElementById('allowClipboard');
const denyClipboard = document.getElementById('denyClipboard');

// Function to check both read and write permissions
async function checkClipboardAccess() {
    try {
        // Attempt to read the clipboard (this will fail if no permission is granted)
        await navigator.clipboard.readText();
        // If successful, perform clipboard operations
        handleClipboardOperations();
    } catch (err) {
        // If an error occurs (lack of permission or support), show the consent dialog
        consentDialog.classList.add('visible');
    }
}

// Function to handle clipboard read/write operations
function handleClipboardOperations() {
    navigator.clipboard.writeText("Copied text to clipboard").then(() => {
        console.log("Text successfully written to clipboard!");
        navigator.clipboard.readText().then(text => {
            console.log("Clipboard content: " + text);
        });
    }).catch(err => {
        console.error("Error accessing clipboard: ", err);
    });
}

// Handle Allow button click to request permissions and perform clipboard operations
allowClipboard.addEventListener('click', async function () {
    // Requesting clipboard access on user interaction
    try {
        handleClipboardOperations();
        consentDialog.classList.remove('visible');
    } catch (err) {
        console.error("Clipboard permission denied or failed: ", err);
    }
});

// Handle Deny button click (Close the dialog)
denyClipboard.addEventListener('click', function () {
    consentDialog.classList.remove('visible');
});

// Show consent dialog when the page loads if permissions are not granted
window.onload = checkClipboardAccess;