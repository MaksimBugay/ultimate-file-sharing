(function () {
    let overlay = null;
    let currentInline = null; // track inline spinner

    function createSpinnerElement() {
        const wrap = document.createElement("div");
        wrap.className = "sc-loading";

        const spinner = document.createElement("div");
        spinner.className = "sc-loading-spinner";

        const text = document.createElement("div");
        text.className = "sc-loading-text";
        text.textContent = "Loading...";

        wrap.appendChild(spinner);
        wrap.appendChild(text);

        return wrap;
    }

    window.showSpinner = function (container) {
        // Inline spinner
        if (container instanceof HTMLElement) {
            hideSpinner(); // remove old spinner
            currentInline = createSpinnerElement();

            // container must be able to center
            container.style.position ||= "relative";
            currentInline.style.position = "absolute";
            currentInline.style.inset = "0";
            currentInline.style.display = "flex";

            container.appendChild(currentInline);
            return;
        }

        // Fullscreen overlay
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = "scLoadingOverlay";
            overlay.appendChild(createSpinnerElement());
        }
        if (!document.body.contains(overlay)) {
            document.body.appendChild(overlay);
        }
    };

    window.hideSpinner = function () {
        if (overlay && document.body.contains(overlay)) {
            overlay.remove();
        }
        if (currentInline && currentInline.parentElement) {
            currentInline.remove();
            currentInline = null;
        }
    };
})();
