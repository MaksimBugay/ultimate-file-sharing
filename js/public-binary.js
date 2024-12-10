const serverUrl = 'https://secure.fileshare.ovh';
//https://secure.fileshare.ovh/binary/85fb3881ad15bf9ae956cb30f22c5855/cd1030e5-8c6e-4a4f-a14e-79eb2f4e44fb
const workspaceId = "85fb3881ad15bf9ae956cb30f22c5855";
const binaryId = "cd1030e5-8c6e-4a4f-a14e-79eb2f4e44fb";

const workspaceIdLabel = document.getElementById('workspaceIdLabel');
const contentPreviewContainer = document.getElementById('contentPreviewContainer');

function showErrorMessage(errorText) {
    contentPreviewContainer.remove();
    errorMessage.textContent = errorText;
    errorMessage.style.display = 'block';
}

workspaceIdLabel.textContent = `Workspace ID: ${workspaceId}`;

prepareBinary(workspaceId, binaryId);

//======================================== Implementations =============================================================
async function prepareBinary(workspaceId, binaryId) {
    const readMeText = await fetchPublicBinaryDescription(workspaceId, binaryId);
    const readMeTextMemo = document.getElementById("readMeTextMemo");
    if (readMeText && readMeTextMemo) {
        readMeTextMemo.textContent = readMeText;
    }

    const manifest = await downloadPublicBinaryManifest(workspaceId, binaryId);

    alert(manifest.name);
}

async function fetchPublicBinaryDescription(workspaceId, binaryId) {
    const url = serverUrl + `/binary/binary-manifest/${workspaceId}/${binaryId}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            return null;
        }

        return await response.text();
    } catch (error) {
        console.error('Cannot fetch public binary description:', error);
        return null;
    }
}

async function downloadPublicBinaryManifest(workspaceId, binaryId) {
    const response = await fetch(serverUrl + `/binary/m/${workspaceId}/${binaryId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) {
        console.error('Failed download public binary manifest attempt ' + response.statusText);
        showErrorMessage('Failed download public binary attempt ' + response.statusText);
        return null;
    }
    return response.json();
}
