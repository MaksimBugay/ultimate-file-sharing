const fileInput = document.getElementById('fileInput');
fileInput.addEventListener('change', processSelectedFile);

const port = chrome.runtime.connect();
window.addEventListener('unload', () => {
    port.disconnect();
});

FingerprintJS.load().then(fp => {
    fp.get().then(result => {
        openDataBase(result.visitorId);
    });
});

document.getElementById("copy-link-btn").addEventListener('click', function () {

});

async function processSelectedFile(event) {
    const file = event.target.files[0];
    if (file) {
        const fileSize = file.size;
        let offset = 0;
        let sliceNumber = 0;
        const binaryId = uuid.v4().toString();
        const slices = [];

        function readNextChunk() {
            const reader = new FileReader();

            reader.onload = function (e) {
                const arrayBuffer = e.target.result;
                slices.push(arrayBuffer);

                offset += MemoryBlock.MB100;
                sliceNumber++;

                if (offset < fileSize) {
                    readNextChunk();
                } else {
                    console.log('File read completed.');
                }
            };

            reader.onerror = function (e) {
                console.error("Error reading file:", e);
            };

            const blob = file.slice(offset, offset + MemoryBlock.MB100);
            reader.readAsArrayBuffer(blob);
        }

        readNextChunk();

        while (slices.length < Math.ceil(Math.ceil(fileSize / MemoryBlock.MB100))) {
            await delay(100);
        }
        let tmpManifest = 0;
        for (let i = 0; i < slices.length; i++) {
            tmpManifest = await addBinaryToStorage(binaryId, file.name, file.type, slices[i], i, tmpManifest);
            if (tmpManifest === null) {
                removeBinary(binaryId, function () {
                    console.log(`Binary with id ${binaryId} was completely removed from DB`);
                });
                return false;
            }
        }
    } else {
        console.error("No file selected");
        return false;
    }
}