
const urlParams = new URLSearchParams(window.location.search);

// Retrieve specific parameters
const protectedUrlSuffix = urlParams.get('suffix');
const canPlayType = urlParams.get('canPlayType');

console.log(protectedUrlSuffix);
console.log(canPlayType);