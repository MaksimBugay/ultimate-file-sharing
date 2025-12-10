// Product Dialog Handler
(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', function() {
        const productDialog = document.getElementById('productDialog');
        const closeDialog = document.getElementById('closeDialog');
        const dialogOverlay = productDialog ? productDialog.querySelector('.product-dialog-overlay') : null;

        if (!productDialog) {
            return;
        }

        // Listen for messages from iframe (header)
        window.addEventListener('message', function(event) {
            // Security check - only accept messages from same origin
            if (event.origin !== window.location.origin) {
                return;
            }

            if (event.data === 'showProductDialog') {
                showDialog();
            }
        });

        // Function to show dialog
        function showDialog() {
            productDialog.classList.add('show');
            document.body.style.overflow = 'hidden';
        }

        // Function to hide dialog
        function hideDialog() {
            productDialog.classList.remove('show');
            document.body.style.overflow = '';
        }

        // Close dialog when close button is clicked
        if (closeDialog) {
            closeDialog.addEventListener('click', hideDialog);
        }

        // Close dialog when overlay is clicked
        if (dialogOverlay) {
            dialogOverlay.addEventListener('click', hideDialog);
        }

        // Close dialog when Escape key is pressed
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && productDialog.classList.contains('show')) {
                hideDialog();
            }
        });
    });
})();

