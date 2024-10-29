class FileTransferManifest {
    constructor(name, type, size) {
        this.id = uuid.v4().toString();
        this.name = name;
        this.type = type;
        this.size = size;
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            type: this.type,
            size: this.size
        };
    }

    toBinaryChunk() {
        return stringToArrayBuffer(JSON.stringify(this.toJSON()));
    }
}

const TransferFileHelper = {}

TransferFileHelper.transferFile = async function transferFile(file, transferGroupId) {
    const ftManifest = new FileTransferManifest(file.name, file.type, file.size);

    const result = await PushcaClient.transferBinaryChunk(
        ftManifest.id,
        0,
        transferGroupId,
        ftManifest.toBinaryChunk()
    );
    if (WaiterResponseType.ERROR === result.type) {
        console.error(`Failed file transfer attempt: ${file.name}`);
        return false;
    }

    await readFileSequentially(file, async function (order, arrayBuffer) {
        const result = await PushcaClient.transferBinaryChunk(
            ftManifest.id,
            order,
            transferGroupId,
            arrayBuffer
        );
    });
    //alert(JSON.stringify(ftManifest.toJSON()));
}

async function readFileSequentially(file, chunkHandler) {
    const fileSize = file.size;
    let offset = 0;
    let sliceNumber = 0;

    function readNextChunk() {
        const reader = new FileReader();

        reader.onload = function (e) {
            const arrayBuffer = e.target.result;

            offset += MemoryBlock.MB;
            sliceNumber++;

            if (typeof chunkHandler === 'function') {
                chunkHandler(sliceNumber, arrayBuffer);
            }

            if (offset < fileSize) {
                readNextChunk();
            } else {
                console.log('File read completed.');
            }
        };

        reader.onerror = function (e) {
            console.error("Error reading file:", e);
        };

        const blob = file.slice(offset, offset + MemoryBlock.MB);
        reader.readAsArrayBuffer(blob);
    }

    readNextChunk();

    while (sliceNumber < Math.ceil(Math.ceil(fileSize / MemoryBlock.MB))) {
        await delay(100);
    }
}
