/**
 * Demo Widget - four feature tiles with a collapsible support banner
 */

/**
 * Creates and injects a demo widget into the specified container.
 * 
 * @param {Array<{title: string, srcUrl: string, link: string}>} adItems - Array of ad items (up to 4)
 *        containing title, source URL for iframes, and link URL for redirections
 * @param {Array<{cryptoCurrency: string, walletAddress: string}>} wallets - Array of 
 *        cryptocurrency wallet information for donations
 * @param {HTMLElement} container - The container element where the widget will be injected
 * @returns {HTMLElement} The created widget element
 */
function addDemoWidget(adItems, wallets, container) {
  if (!container || !(container instanceof HTMLElement)) {
    console.error('Demo Widget: Invalid container element provided');
    return null;
  }

  if (!Array.isArray(adItems) || adItems.length === 0) {
    console.error('Demo Widget: adItems must be a non-empty array');
    return null;
  }

  if (!Array.isArray(wallets) || wallets.length === 0) {
    console.error('Demo Widget: wallets must be a non-empty array');
    return null;
  }

  // Load Google Font for better typography
  loadWidgetFont();

  // Create main widget container
  const widget = document.createElement('div');
  widget.className = 'demo-widget-container';

  // Keep support visible above the tiles, including when the mobile grid scrolls.
  container.appendChild(createSupportBanner(wallets));

  // Take up to 4 feature items for the grid.
  const displayItems = adItems.slice(0, 4);

  // Fill unused cells for callers that supply fewer than four items.
  while (displayItems.length < 4) {
    displayItems.push(adItems[displayItems.length % adItems.length]);
  }

  // Create the four feature cells.
  displayItems.forEach(item => {
    const cell = createAdCell(item);
    widget.appendChild(cell);
  });

  // Inject widget into container
  container.appendChild(widget);

  return widget;
}

/**
 * Loads the Outfit font from Google Fonts
 */
function loadWidgetFont() {
  if (document.querySelector('link[data-demo-widget-font]')) {
    return; // Already loaded
  }

  const fontLink = document.createElement('link');
  fontLink.setAttribute('data-demo-widget-font', 'true');
  fontLink.rel = 'preconnect';
  fontLink.href = 'https://fonts.googleapis.com';
  document.head.appendChild(fontLink);

  const fontLink2 = document.createElement('link');
  fontLink2.rel = 'preconnect';
  fontLink2.href = 'https://fonts.gstatic.com';
  fontLink2.crossOrigin = 'anonymous';
  document.head.appendChild(fontLink2);

  const fontStylesheet = document.createElement('link');
  fontStylesheet.rel = 'stylesheet';
  fontStylesheet.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400&family=Outfit:wght@400;600;700&display=swap';
  document.head.appendChild(fontStylesheet);
}

/**
 * Creates a feature cell with its media preview and title.
 * @param {{title: string, srcUrl: string, link: string}} item - Ad item data
 * @returns {HTMLElement} The created cell element
 */
function createAdCell(item) {
  const cell = document.createElement('div');
  cell.className = 'demo-widget-cell';

  // Use link for redirections, fallback to srcUrl if link not provided
  const redirectUrl = item.link || item.srcUrl;

  // Title header
  const titleHeader = document.createElement('div');
  titleHeader.className = 'demo-widget-title';

  const titleIcon = document.createElement('span');
  titleIcon.className = 'demo-widget-title-icon';

  const titleLink = document.createElement('a');
  titleLink.className = 'demo-widget-title-link';
  titleLink.href = redirectUrl;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = item.title || 'Advertisement';
  titleLink.title = item.title;

  titleHeader.appendChild(titleIcon);
  titleHeader.appendChild(titleLink);

  const mediaWrapper = document.createElement('div');
  mediaWrapper.className = 'demo-widget-iframe-wrapper';

  if (/\.webm(?:[?#]|$)/i.test(item.srcUrl)) {
    mediaWrapper.classList.add('demo-widget-video-wrapper');

    const video = document.createElement('video');
    video.className = 'demo-widget-iframe demo-widget-video';
    video.src = item.srcUrl;
    video.autoplay = true;
    video.controls = true;
    video.loop = true;
    video.muted = true;
    video.defaultMuted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.setAttribute('muted', '');
    video.setAttribute('aria-label', item.title || 'Video preview');
    keepNativeVideoControlsVisible(video);
    mediaWrapper.appendChild(video);

    video.addEventListener('volumechange', () => {
      mediaWrapper.classList.toggle('is-audible', !video.muted && video.volume > 0);
    });
  } else {
    const iframe = document.createElement('iframe');
    iframe.className = 'demo-widget-iframe';
    iframe.src = item.srcUrl;
    iframe.loading = 'lazy';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    iframe.title = item.title || 'Advertisement content';
    iframe.setAttribute('aria-label', item.title || 'Advertisement');
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('webkitallowfullscreen', '');
    iframe.setAttribute('mozallowfullscreen', '');
    mediaWrapper.appendChild(iframe);
  }

  cell.appendChild(titleHeader);
  cell.appendChild(mediaWrapper);

  return cell;
}

/**
 * Keep native controls active without changing playback, sound, or focus.
 * Chromium also fades an internal button row, so panel CSS alone is insufficient.
 */
function keepNativeVideoControlsVisible(video) {
  let refreshTimer = null;

  const refreshControls = () => {
    if (video.isConnected && video.controls) {
      video.dispatchEvent(new PointerEvent('pointermove', {pointerType: 'mouse'}));
    }
  };

  const stopRefreshing = () => {
    clearInterval(refreshTimer);
    refreshTimer = null;
  };

  video.addEventListener('playing', () => {
    stopRefreshing();
    refreshControls();
    refreshTimer = setInterval(() => {
      if (!video.isConnected || video.paused) {
        stopRefreshing();
        return;
      }
      refreshControls();
    }, 1000);
  });

  video.addEventListener('pointerout', () => requestAnimationFrame(refreshControls));
  video.addEventListener('pause', stopRefreshing);
  video.addEventListener('ended', stopRefreshing);
  video.addEventListener('emptied', stopRefreshing);
}

/**
 * Creates the collapsible support banner with wallet information.
 * @param {Array<{cryptoCurrency: string, walletAddress: string}>} wallets - Wallet data
 * @returns {HTMLElement} The created support banner
 */
function createSupportBanner(wallets) {
  const banner = document.createElement('section');
  banner.className = 'demo-widget-support';

  const toggle = document.createElement('button');
  toggle.className = 'demo-widget-support-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'demo-widget-support-panel');

  const icon = document.createElement('span');
  icon.className = 'demo-widget-support-icon';
  icon.textContent = '💜';
  icon.setAttribute('aria-hidden', 'true');

  const copy = document.createElement('span');
  copy.className = 'demo-widget-support-copy';

  const title = document.createElement('span');
  title.className = 'demo-widget-support-title';
  title.textContent = 'Support Us';

  const subtitle = document.createElement('span');
  subtitle.className = 'demo-widget-support-subtitle';
  subtitle.textContent = 'Help bring real privacy to everyone';

  const chevron = document.createElement('span');
  chevron.className = 'demo-widget-support-chevron';
  chevron.textContent = '⌄';
  chevron.setAttribute('aria-hidden', 'true');

  copy.appendChild(title);
  copy.appendChild(subtitle);
  toggle.appendChild(icon);
  toggle.appendChild(copy);
  toggle.appendChild(chevron);

  const panel = document.createElement('div');
  panel.id = 'demo-widget-support-panel';
  panel.className = 'demo-widget-support-panel';
  panel.setAttribute('aria-hidden', 'true');
  panel.inert = true;

  const panelContent = document.createElement('div');
  panelContent.className = 'demo-widget-support-panel-content';

  const details = document.createElement('div');
  details.className = 'demo-widget-support-details';

  const hint = document.createElement('p');
  hint.className = 'demo-widget-support-hint';
  hint.textContent = 'Choose a cryptocurrency to copy its wallet address.';

  const walletsList = document.createElement('div');
  walletsList.className = 'demo-widget-wallets';

  wallets.forEach(wallet => {
    const walletItem = createWalletItem(wallet);
    walletsList.appendChild(walletItem);
  });

  details.appendChild(hint);
  details.appendChild(walletsList);
  panelContent.appendChild(details);
  panel.appendChild(panelContent);
  banner.appendChild(toggle);
  banner.appendChild(panel);

  toggle.addEventListener('click', () => {
    const isOpen = banner.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
    panel.setAttribute('aria-hidden', String(!isOpen));
    panel.inert = !isOpen;
  });

  return banner;
}

/**
 * Creates a wallet item element
 * @param {{cryptoCurrency: string, walletAddress: string}} wallet - Wallet data
 * @returns {HTMLElement} The created wallet item element
 */
function createWalletItem(wallet) {
  const item = document.createElement('button');
  item.className = 'demo-widget-wallet';
  item.type = 'button';
  item.setAttribute('aria-label', `Copy ${wallet.cryptoCurrency} wallet address`);

  const crypto = document.createElement('div');
  crypto.className = 'demo-widget-wallet-crypto';
  crypto.textContent = wallet.cryptoCurrency;

  const address = document.createElement('div');
  address.className = 'demo-widget-wallet-address';
  address.textContent = wallet.walletAddress;

  const copyHint = document.createElement('span');
  copyHint.className = 'demo-widget-wallet-copy';
  copyHint.textContent = 'Click to copy';

  item.appendChild(crypto);
  item.appendChild(address);
  item.appendChild(copyHint);

  // Copy to clipboard functionality
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(wallet.walletAddress);
      item.classList.add('copied');
      copyHint.textContent = 'Copied!';
      
      setTimeout(() => {
        item.classList.remove('copied');
        copyHint.textContent = 'Click to copy';
      }, 2000);
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = wallet.walletAddress;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      
      try {
        document.execCommand('copy');
        item.classList.add('copied');
        copyHint.textContent = 'Copied!';
        
        setTimeout(() => {
          item.classList.remove('copied');
          copyHint.textContent = 'Click to copy';
        }, 2000);
      } catch (e) {
        copyHint.textContent = 'Copy failed';
      }
      
      document.body.removeChild(textArea);
    }
  };

  item.addEventListener('click', copyAddress);
  return item;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { addDemoWidget };
}

// Make available globally
if (typeof window !== 'undefined') {
  window.addDemoWidget = addDemoWidget;
}
