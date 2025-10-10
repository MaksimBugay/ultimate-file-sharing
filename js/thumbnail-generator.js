async function imageUrlToBlob(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous"; // allow cross-origin if CORS headers are set
        img.style.display = "none"; // hide the element
        document.body.appendChild(img);

        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;

            const ctx = canvas.getContext("2d");
            ctx.drawImage(img, 0, 0);

            canvas.toBlob((blob) => {
                document.body.removeChild(img); // clean up
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error("Failed to create Blob"));
                }
            }, "image/png"); // or "image/jpeg"
        };

        img.onerror = () => {
            document.body.removeChild(img);
            reject(new Error("Failed to load image"));
        };

        img.src = url;
    });
}


ThumbnailGenerator = {}
ThumbnailGenerator.thumbnailWorkspaceId = "thumbnail";
ThumbnailGenerator.thumbnailNameSpace = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
ThumbnailGenerator.thumbnailBackgroundImage = null;
imageUrlToBlob("../images/text-background.png")
    .then(blob => ThumbnailGenerator.thumbnailBackgroundImage = blob)
    .catch(err => console.error(err));

function buildThumbnailName(binaryId) {
    return `thumbnail-${binaryId}.png`;
}

function buildThumbnailId(binaryId) {
    const thumbnailName = buildThumbnailName(binaryId);
    return uuid.v5(thumbnailName, ThumbnailGenerator.thumbnailNameSpace);
}

ThumbnailGenerator.buildAndSaveThumbnail = async function (
    binaryId,
    source,
    name,
    type,
    readMeText,
    saveInCloudProcessor
) {
    const thumbnailName = buildThumbnailName(binaryId);
    const thumbnailId = buildThumbnailId(binaryId);
    let thumbnailBlob;
    try {
        if (isImageContentType(type)) {
            thumbnailBlob = await createImageThumbnailFromSource(
                source,
                type,
                300,
                null,
                'image/png',
                0.8
            );
        } else if (isVideoContentType(type)) {
            thumbnailBlob = await createVideoThumbnailFromSource(
                source,
                type,
                300,
                null,
                2,
                'image/png',
                0.8
            );
        }
    } catch (err) {
        console.error(`Cannot create thumbnail for file ${name}: ${err.message}`);
        //alert(`Cannot create thumbnail for file ${file.name}: ${err.message}`);
    }
    if (!thumbnailBlob) {
        thumbnailBlob = await createDefaultTextThumbnail(
            readMeText,
            ThumbnailGenerator.thumbnailBackgroundImage
        );
    }
    if (typeof saveInCloudProcessor === 'function') {
        await saveInCloudProcessor(
            thumbnailId,
            ThumbnailGenerator.thumbnailWorkspaceId,
            thumbnailName,
            'image/png',
            thumbnailBlob
        );
    }
    //alert(`https://secure.fileshare.ovh/binary/${ThumbnailGenerator.thumbnailWorkspaceId}/${thumbnailId}`);
}


