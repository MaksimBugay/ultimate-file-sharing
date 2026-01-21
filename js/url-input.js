/**
 * Secure FileShare URL Input Widget
 * Production-grade URL input component with copy/paste functionality
 * Author: FileShare Team
 * Version: 1.1.0
 *
 * Usage:
 *   const urlInput = SFSPUrlInput.create('my-url-input', document.getElementById('container'), '400px', 'Share URL:', (value) => {
 *     console.log('URL set:', value);
 *   });
 *   console.log(urlInput.getValue());
 */

(function(global) {
  'use strict';

  const DEFAULT_MAX_WIDTH = '100%';

  const SFSPUrlInput = {
    /**
     * Create a new URL input widget instance
     * @param {string} id - Unique identifier for the widget
     * @param {HTMLElement} parentContainer - Container element to render the widget into
     * @param {string} [maxWidth='100%'] - Maximum width of the input element (e.g., '400px', '100%')
     * @param {string} [title=''] - Optional label text (e.g., 'Share URL:')
     * @param {Function} [onUrlWasSetHandler] - Optional callback when URL is pasted, receives URL string
     * @returns {Object} Widget instance with getValue(), setValue(), and onUrlWasSetHandler
     */
    create: function(id, parentContainer, maxWidth, title, onUrlWasSetHandler) {
      if (!id || typeof id !== 'string') {
        throw new Error('SFSPUrlInput: id is required and must be a string');
      }

      if (!parentContainer || !(parentContainer instanceof HTMLElement)) {
        throw new Error('SFSPUrlInput: parentContainer is required and must be an HTMLElement');
      }

      const normalizedMaxWidth = normalizeMaxWidth(maxWidth || DEFAULT_MAX_WIDTH);
      const labelText = String(title || '').trim();

      const instance = {
        id: id,
        _value: '',
        _elements: {},
        onUrlWasSetHandler: typeof onUrlWasSetHandler === 'function' ? onUrlWasSetHandler : function() {}
      };

      function render() {
        const wrapper = document.createElement('div');
        wrapper.className = 'sfsp-url-input';
        wrapper.id = id;

        const labelHtml = labelText
          ? `<label class="sfsp-url-label" for="${escapeHtml(id)}-field">${escapeHtml(labelText)}</label>`
          : '';

        wrapper.innerHTML = `
          <div class="sfsp-url-inline-container">
            ${labelHtml}
            <div class="sfsp-url-input-wrapper" style="width: ${escapeHtml(normalizedMaxWidth)}; max-width: 100%;">
              <input
                id="${escapeHtml(id)}-field"
                type="text"
                class="sfsp-url-field"
                placeholder="Click here, then Ctrl+V (Cmd+V on Mac) to paste URL"
                aria-label="${escapeHtml(labelText || 'URL')}"
                inputmode="none"
                autocomplete="off"
                autocorrect="off"
                autocapitalize="off"
                spellcheck="false"
              >
              <button type="button" class="sfsp-copy-btn" aria-label="Copy URL to clipboard" title="Copy URL">
                Copy URL
              </button>
            </div>
          </div>
          <div class="sfsp-url-message" role="status" aria-live="polite"></div>
        `;

        parentContainer.appendChild(wrapper);

        instance._elements = {
          wrapper: wrapper,
          input: wrapper.querySelector('.sfsp-url-field'),
          copyBtn: wrapper.querySelector('.sfsp-copy-btn'),
          message: wrapper.querySelector('.sfsp-url-message')
        };

        attachEventListeners();
      }

      function attachEventListeners() {
        const { input, copyBtn, wrapper } = instance._elements;

        input.addEventListener('paste', handlePaste);
        wrapper.addEventListener('paste', handlePaste);

        input.addEventListener('focus', () => {
          input.select();
        });

        input.addEventListener('keydown', handleKeyDown);
        copyBtn.addEventListener('click', handleCopy);

        input.addEventListener('click', () => {
          input.focus();
        });

        input.addEventListener('touchstart', handleTouchStart, { passive: true });
        input.addEventListener('touchend', handleTouchEnd, { passive: true });

        input.addEventListener('contextmenu', (e) => {
          e.stopPropagation();
        });
      }

      function handlePaste(e) {
        e.preventDefault();
        e.stopPropagation();
        const clipboardData = e.clipboardData || window.clipboardData;
        if (!clipboardData) return;

        const pastedText = clipboardData.getData('text/plain') || clipboardData.getData('text');
        if (pastedText) {
          setValueInternal(pastedText.trim(), true, true);
        }
      }

      function handleKeyDown(e) {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const modifierKey = isMac ? e.metaKey : e.ctrlKey;

        if (modifierKey && (e.key === 'v' || e.key === 'V')) {
          return;
        }

        if (modifierKey && (e.key === 'c' || e.key === 'C')) {
          if (instance._value) {
            e.preventDefault();
            handleCopy();
          }
          return;
        }

        if (!modifierKey || (e.key !== 'a' && e.key !== 'A')) {
          if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
          }
        }
      }

      async function handleCopy() {
        if (!instance._value) {
          showMessage('Paste a URL before copying.', true);
          return;
        }

        try {
          await copyToClipboard(instance._value);
          showMessage('Copied to clipboard.', false);
        } catch (err) {
          showMessage('Copy failed. Please try again.', true);
        }
      }

      async function copyToClipboard(text) {
        // Modern Clipboard API (preferred)
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          return;
        }

        // Fallback for older browsers without Clipboard API support
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(textArea);
        textArea.select();
        textArea.setSelectionRange(0, text.length);

        let success = false;
        try {
          // execCommand is deprecated but required for legacy browser support
          success = document.execCommand('copy');
        } catch (err) {
          success = false;
        }
        document.body.removeChild(textArea);

        if (!success) {
          throw new Error('Fallback copy failed');
        }
      }

      let touchStartTime = 0;

      function handleTouchStart() {
        touchStartTime = Date.now();
      }

      function handleTouchEnd() {
        const touchDuration = Date.now() - touchStartTime;
        if (touchDuration < 300) {
          instance._elements.input.focus();
        }
      }

      function setValueInternal(value, triggerCallback, validate) {
        const normalized = String(value || '').trim();

        if (!normalized) {
          instance._value = '';
          updateDisplay();
          showMessage('', false);
          return;
        }

        if (validate && !isValidUrl(normalized)) {
          showMessage('Please paste a valid URL (https://...)', true);
          instance._elements.input.classList.add('sfsp-url-input--error');
          return;
        }

        instance._elements.input.classList.remove('sfsp-url-input--error');
        instance._value = normalized;
        updateDisplay();
        showMessage('URL set.', false);

        if (triggerCallback && typeof instance.onUrlWasSetHandler === 'function') {
          instance.onUrlWasSetHandler(normalized);
        }
      }

      function updateDisplay() {
        const input = instance._elements.input;

        if (instance._value) {
          input.value = formatDisplayValue(instance._value);
          input.classList.remove('sfsp-empty');
        } else {
          input.value = '';
          input.classList.add('sfsp-empty');
        }
      }

      function formatDisplayValue(value) {
        const trimmed = String(value || '');
        const maxLength = 64;

        if (trimmed.length <= maxLength) {
          return trimmed;
        }

        try {
          const parsed = new URL(trimmed);
          const prefix = `${parsed.origin}/`;
          const suffixLength = Math.min(32, Math.max(16, maxLength - prefix.length - 3));
          const suffix = trimmed.slice(-suffixLength);
          return `${prefix}...${suffix}`;
        } catch (err) {
          const suffix = trimmed.slice(-24);
          return `${trimmed.slice(0, 24)}...${suffix}`;
        }
      }

      function isValidUrl(value) {
        try {
          const parsed = new URL(value);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch (err) {
          return false;
        }
      }

      function showMessage(message, isError) {
        const el = instance._elements.message;
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('sfsp-url-message--error', !!isError);
        el.classList.toggle('sfsp-url-message--success', !isError && !!message);
      }

      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function normalizeMaxWidth(value) {
        if (!value) return DEFAULT_MAX_WIDTH;
        if (typeof value === 'number') return `${value}px`;
        if (typeof value === 'string' && /^\d+$/.test(value)) {
          return `${value}px`;
        }
        return value;
      }

      instance.getValue = function() {
        return instance._value;
      };

      instance.setValue = function(value, triggerCallback) {
        setValueInternal(value || '', triggerCallback === true, false);
      };

      /**
       * Clear the URL value and reset the widget state
       */
      instance.clear = function() {
        instance._value = '';
        instance._elements.input.classList.remove('sfsp-url-input--error');
        updateDisplay();
        showMessage('', false);
      };

      instance.copyToClipboard = async function() {
        if (instance._value) {
          await handleCopy();
        }
      };

      instance.destroy = function() {
        if (instance._elements.wrapper) {
          instance._elements.wrapper.remove();
        }
        instance._elements = {};
        instance._value = '';
      };

      instance.focus = function() {
        if (instance._elements.input) {
          instance._elements.input.focus();
        }
      };

      render();
      return instance;
    }
  };

  global.SFSPUrlInput = SFSPUrlInput;
})(typeof window !== 'undefined' ? window : this);
