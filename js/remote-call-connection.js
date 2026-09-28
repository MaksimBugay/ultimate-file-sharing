(() => {
  'use strict';

  const MANAGER_APPLICATION_ID = 'REMOTE-CALL-MANAGER';
  const WS_URL = 'wss://secure.fileshare.ovh:31085';
  const jointLink = document.getElementById('jointLink');
  const copyButton = document.getElementById('copyJointLinkButton');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionIndicator = document.getElementById('connectionIndicator');

  function setConnectionStatus(message) {
    connectionStatus.textContent = message;
  }

  function setConnectionHealthy(healthy) {
    const label = healthy ? 'WebSocket connected' : 'WebSocket disconnected';
    connectionIndicator.style.backgroundColor = healthy ? '#38d985' : '#ff6868';
    connectionIndicator.style.boxShadow = `0 0 0 3px ${healthy ? '#38d98530' : '#ff686830'}`;
    connectionIndicator.setAttribute('aria-label', label);
    connectionIndicator.title = label;
  }

  function refreshJointLink() {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('source-host', encodeToBase64UrlSafe(JSON.stringify(PushcaClient.ClientObj)));
    jointLink.value = url.toString();
    copyButton.disabled = false;
  }

  PushcaClient.onOpenHandler = function () {
    refreshJointLink();
    setConnectionHealthy(true);
    setConnectionStatus('Connected to call manager. Joint link is ready to share.');
  };

  PushcaClient.onCloseHandler = function () {
    if (PushcaClient.isOpen()) return;
    setConnectionHealthy(false);
    copyButton.disabled = true;
    setConnectionStatus('Call manager connection lost. Reconnecting…');
  };

  copyButton.addEventListener('click', async () => {
    if (copyButton.disabled || !jointLink.value) return;
    let copied = navigator.clipboard?.writeText
      ? await navigator.clipboard.writeText(jointLink.value).then(() => true, () => false)
      : false;
    if (!copied) {
      jointLink.select();
      copied = document.execCommand('copy');
    }
    setConnectionStatus(copied ? 'Joint link copied to clipboard.' : 'Copy the joint link from the field.');
  });

  const client = new ClientFilter(
    'remote-call',
    'anonymous-sharing',
    uuid.v4().toString(),
    MANAGER_APPLICATION_ID
  );

  PushcaClient.openWsConnection(WS_URL, client, connectedClient => new ClientFilter(
    connectedClient.workSpaceId,
    connectedClient.accountId,
    connectedClient.deviceId,
    connectedClient.applicationId
  )).then(() => {
    if (!PushcaClient.isOpen()) {
      setConnectionHealthy(false);
      setConnectionStatus('Could not connect to call manager. Retrying…');
    }
  }).catch(error => {
    console.error('Could not connect to call manager:', error);
    setConnectionHealthy(false);
    setConnectionStatus('Could not connect to call manager. Retrying…');
  });

  window.setInterval(() => {
    const healthy = PushcaClient.isOpen();
    setConnectionHealthy(healthy);
    if (healthy) PushcaClient.sendPing();
  }, 10000);
})();
