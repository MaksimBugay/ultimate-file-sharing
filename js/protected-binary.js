const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
const protectedUrlSuffix = urlParams.get('suffix');
const canPlayType = urlParams.get('canPlayType');

const workspaceId = "cec7abf69bab9f5aa793bd1c0c101e99";
const password = "strongPassword";

createSignedDownloadRequest(password, workspaceId, protectedUrlSuffix, canPlayType).then(request => {
    console.log(request);
    fetch('https://vasilii.prodpushca.com:30443' + '/binary/protected', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
    }).then(response => {
        if (!response.ok) {
            console.error(`Failed attempt to download protected binary: ${response.statusText}`);
            return null;
        }
        const contentDisposition = response.headers.get('Content-Disposition');
        const suggestedFileName = contentDisposition ? contentDisposition.split('filename=')[1] : 'protected-binary';
        const contentLength = response.headers.get('Content-Length');

        const total = contentLength ? parseInt(contentLength, 10) : null;
        let loaded = 0;

        const reader = response.body.getReader();
        const stream = new ReadableStream({
            start(controller) {
                function push() {
                    reader.read().then(({done, value}) => {
                        if (done) {
                            controller.close();
                            return;
                        }

                        loaded += value.length;
                        console.log(`Received ${loaded} of ${total} bytes`);
                        controller.enqueue(value);
                        push();
                    }).catch(error => {
                        console.error('Error reading stream:', error);
                        controller.error(error);
                    });
                }

                push();
            }
        });

        const blob = new Response(stream).blob();
        return blob.then(blob => {
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = suggestedFileName || fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        });
    });
});

async function createSignedDownloadRequest(pwd, workspaceId, suffix, canPlayType) {
    const request = new DownloadProtectedBinaryRequest(
        suffix,
        new Date().getDate() + 30000,
        canPlayType,
        null
    );

    const signature = await makeSignature(
        pwd,
        stringToByteArray(workspaceId),
        JSON.stringify(request.toSkipSignatureJSON())
    )

    return new DownloadProtectedBinaryRequest(
        request.suffix,
        request.exp,
        request.canPlayType,
        arrayBufferToBase64(signature)
    )
}

