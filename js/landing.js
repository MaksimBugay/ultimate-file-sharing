(() => {
    'use strict';

    // Links and donation details also work when JavaScript is unavailable.
    const dialog = document.getElementById('demo-dialog');
    const video = document.getElementById('demo-video');
    const videoError = document.getElementById('video-error');
    let demoTrigger = null;

    if (dialog && typeof dialog.showModal === 'function') {
        document.querySelectorAll('.demo-link').forEach(link => {
            link.setAttribute('aria-haspopup', 'dialog');
            link.setAttribute('aria-controls', 'demo-dialog');
            link.addEventListener('click', event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                demoTrigger = link;
                const featureLink = link.closest('.feature-card').querySelector('.feature-link');
                const modalFeatureLink = document.getElementById('demo-feature-link');
                document.getElementById('demo-title').textContent = link.dataset.demoTitle;
                document.getElementById('video-direct-link').href = link.href;
                modalFeatureLink.href = featureLink.href;
                modalFeatureLink.replaceChildren(...Array.from(featureLink.childNodes, node => node.cloneNode(true)));
                modalFeatureLink.target = featureLink.target;
                modalFeatureLink.rel = featureLink.rel;
                video.setAttribute('aria-label', `${link.dataset.demoTitle} demo video`);
                videoError.hidden = true;
                video.src = link.href;
                dialog.showModal();
                document.body.classList.add('modal-open');
                // Playback starts only after an explicit click. Native controls stay available.
                video.play().catch(() => {});
            });
        });

        dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => {
            video.pause();
            video.removeAttribute('src');
            video.load();
            videoError.hidden = true;
            document.body.classList.remove('modal-open');
            if (demoTrigger) demoTrigger.focus({preventScroll: true});
        });

        let startedOnBackdrop = false;
        const outsideDialog = event => {
            const bounds = dialog.getBoundingClientRect();
            return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
                event.clientY < bounds.top || event.clientY > bounds.bottom);
        };
        dialog.addEventListener('pointerdown', event => { startedOnBackdrop = outsideDialog(event); });
        dialog.addEventListener('click', event => {
            if (startedOnBackdrop && outsideDialog(event)) dialog.close();
            startedOnBackdrop = false;
        });
        video.addEventListener('error', () => {
            if (dialog.open && video.getAttribute('src')) videoError.hidden = false;
        });
        document.getElementById('retry-video').addEventListener('click', () => {
            videoError.hidden = true;
            video.load();
            video.play().catch(() => {});
        });
    }

    const copyStatus = document.getElementById('copy-status');
    const resetTimers = new WeakMap();
    document.querySelectorAll('.copy-button').forEach(button => {
        button.hidden = false;
        button.addEventListener('click', async () => {
            const wallet = button.closest('.wallet');
            const addressElement = wallet.querySelector('.wallet-address');
            const address = addressElement.textContent.trim();
            let copied;
            try {
                await navigator.clipboard.writeText(address);
                copied = true;
            } catch {
                // Preserve an honest manual-copy fallback when clipboard access is denied.
                const field = document.createElement('textarea');
                field.value = address;
                field.readOnly = true;
                field.setAttribute('aria-label', 'Wallet address to copy');
                field.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
                document.body.appendChild(field);
                field.select();
                try { copied = document.execCommand('copy'); } catch { copied = false; }
                field.remove();
                button.focus({preventScroll: true});
            }

            clearTimeout(resetTimers.get(button));
            button.classList.toggle('is-copied', copied);
            button.querySelector('span').textContent = copied ? 'Copied' : 'Copy';
            if (copied) {
                copyStatus.textContent = `${wallet.dataset.currency} wallet address copied.`;
                resetTimers.set(button, setTimeout(() => {
                    button.classList.remove('is-copied');
                    button.querySelector('span').textContent = 'Copy';
                }, 2400));
            } else {
                addressElement.focus({preventScroll: true});
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(addressElement);
                if (selection) {
                    selection.removeAllRanges();
                    selection.addRange(range);
                }
                copyStatus.textContent = 'Copy wasn’t available. The wallet address is selected so you can copy it manually.';
            }
        });
    });
})();
