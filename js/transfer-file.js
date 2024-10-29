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
    alert(result.type);
    //alert(JSON.stringify(ftManifest.toJSON()));
}