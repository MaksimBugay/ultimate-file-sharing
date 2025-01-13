
const selectFilesBtn = document.getElementById('selectFilesBtn');
const deviceFromImage = document.getElementById('deviceFromImage');
const dropZone = document.getElementById('dropZone');
const deviceToImage = document.getElementById('deviceToImage');

const deviceFromArea = deviceFromImage.getBoundingClientRect();
selectFilesBtn.style.top = `${deviceFromArea.top + 30}px`;
selectFilesBtn.style.left = `${deviceFromArea.left + 50}px`;
selectFilesBtn.style.display = 'block';

const deviceToArea = deviceToImage.getBoundingClientRect();
dropZone.style.width = `${0.86*deviceToArea.width}px`;
dropZone.style.height = `${0.45*deviceToArea.width}px`;
dropZone.style.top = `${deviceToArea.top + 30}px`;
dropZone.style.left = `${deviceToArea.left + 20}px`;
