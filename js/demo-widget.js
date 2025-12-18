/**
 * Demo Widget - Modern Ad Container with Donate Section
 * Creates an attractive 2x2 (desktop) / 1x4 (mobile) widget layout
 */

/**
 * Creates and injects a demo widget into the specified container.
 * 
 * @param {Array<{title: string, srcUrl: string, link: string}>} adItems - Array of ad items (up to 3) 
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

  // Take up to 3 ad items for the first 3 cells
  const displayItems = adItems.slice(0, 3);

  // Pad with empty items if less than 3
  while (displayItems.length < 3) {
    displayItems.push(adItems[displayItems.length % adItems.length]);
  }

  // Create ad cells (first 3 cells)
  displayItems.forEach((item, index) => {
    const cell = createAdCell(item, index);
    widget.appendChild(cell);
  });

  // Create donate cell (4th cell)
  const donateCell = createDonateCell(wallets);
  widget.appendChild(donateCell);

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
 * Creates an ad cell with iframe and title
 * @param {{title: string, srcUrl: string, link: string}} item - Ad item data
 * @param {number} index - Cell index for animation delay
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

  // iFrame wrapper
  const iframeWrapper = document.createElement('div');
  iframeWrapper.className = 'demo-widget-iframe-wrapper';
  iframeWrapper.addEventListener('click', () => {
    window.open(redirectUrl, '_blank', 'noopener,noreferrer');
  });

  const iframe = document.createElement('iframe');
  iframe.className = 'demo-widget-iframe';
  iframe.src = item.srcUrl;
  iframe.loading = 'lazy';
  iframe.sandbox = 'allow-scripts allow-same-origin';
  iframe.title = item.title || 'Advertisement content';
  iframe.setAttribute('aria-label', item.title || 'Advertisement');

  iframeWrapper.appendChild(iframe);

  cell.appendChild(titleHeader);
  cell.appendChild(iframeWrapper);

  return cell;
}

/**
 * Creates the donate cell with wallet information
 * @param {Array<{cryptoCurrency: string, walletAddress: string}>} wallets - Wallet data
 * @returns {HTMLElement} The created donate cell element
 */
function createDonateCell(wallets) {
  const cell = document.createElement('div');
  cell.className = 'demo-widget-cell';

  const donateContainer = document.createElement('div');
  donateContainer.className = 'demo-widget-donate';

  // Header
  const header = document.createElement('div');
  header.className = 'demo-widget-donate-header';

  const icon = document.createElement('span');
  icon.className = 'demo-widget-donate-icon';
  icon.textContent = '💜';
  icon.setAttribute('aria-hidden', 'true');

  const title = document.createElement('h3');
  title.className = 'demo-widget-donate-title';
  title.textContent = 'Support Us';

  const subtitle = document.createElement('p');
  subtitle.className = 'demo-widget-donate-subtitle';
  subtitle.textContent = 'Click to copy wallet address';

  header.appendChild(icon);
  header.appendChild(title);
  header.appendChild(subtitle);

  // Wallets list
  const walletsList = document.createElement('div');
  walletsList.className = 'demo-widget-wallets';

  wallets.forEach(wallet => {
    const walletItem = createWalletItem(wallet);
    walletsList.appendChild(walletItem);
  });

  donateContainer.appendChild(header);
  donateContainer.appendChild(walletsList);
  cell.appendChild(donateContainer);

  return cell;
}

/**
 * Creates a wallet item element
 * @param {{cryptoCurrency: string, walletAddress: string}} wallet - Wallet data
 * @returns {HTMLElement} The created wallet item element
 */
function createWalletItem(wallet) {
  const item = document.createElement('div');
  item.className = 'demo-widget-wallet';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
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
  item.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copyAddress();
    }
  });

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


