// ==UserScript==
// @name        Stealth Beacon API Spoof
// @version     3.1.0
// @description Intercepts navigator.sendBeacon() with advanced stealth and reliability to block tracking by mimicking native behavior and edge cases.
// @author      
// @match       *://*/*
// @run-at      document-start
// @grant       none
// @namespace   https://github.com/S0methingSomething/
// @homepageURL https://github.com/S0methingSomething/
// @license     MIT
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration ---
    const SCRIPT_PREFIX = '[Stealthy Beacon Spoof]';
    const SIMULATED_QUOTA = 65536; // 64 KiB - The minimum quota guaranteed by the Beacon API specification.
    const ENABLE_LOGGING = false; // Set to true for debugging. WARNING: Console logs can be detected by other scripts.

    // --- State ---
    const quotaTracker = new Map();
    const originalToString = Function.prototype.toString;

    // --- Utility Functions ---
    const log = (...args) => ENABLE_LOGGING && console.log(SCRIPT_PREFIX, ...args);
    const warn = (...args) => ENABLE_LOGGING && console.warn(SCRIPT_PREFIX, ...args);

    function getEstimatedFormDataSize(formData) {
        // Implementation remains the same...
        let size = 0;
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        const boundaryLength = boundary.length + 4; // --boundary\r\n
        const crlf = 2; // \r\n bytes

        try {
            for (const [key, value] of formData.entries()) {
                let header = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"`;
                if (value instanceof File || value instanceof Blob) {
                    header += `; filename="${value.name || 'blob'}"\r\nContent-Type: ${value.type || 'application/octet-stream'}`;
                }
                header += '\r\n\r\n';
                size += new Blob([header]).size;
                size += (value instanceof Blob) ? value.size : new Blob([String(value)]).size;
                size += crlf;
            }
            size += boundary.length + 4; // --boundary--
        } catch (e) {
            warn('Error estimating FormData size:', e);
            return 0;
        }
        return size;
    }

    function getDataSize(data) {
        if (data === null || data === undefined) return 0;
        if (data instanceof Blob) return data.size;
        if (data instanceof FormData) return getEstimatedFormDataSize(data);
        return new Blob([data]).size;
    }

    // --- The Spoofed Function ---
    const spoofedSendBeacon = function(url, data) {
        if (this !== navigator) {
            throw new TypeError("Illegal invocation: 'sendBeacon' must be called on 'navigator'");
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url, window.location.origin);
        } catch (e) {
            return false;
        }

        const origin = parsedUrl.origin;
        const isCrossOrigin = origin !== window.location.origin;

        // **IMPROVEMENT**: Mimic CORS-safelisting behavior for Blobs
        if (isCrossOrigin && data instanceof Blob && !['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'].includes(data.type)) {
            log(`Blocked call with non-CORS-safelisted Blob to cross-origin URL: ${url}`);
            return false; // Mimic browser behavior of rejecting such requests pre-flight.
        }

        const dataSize = getDataSize(data);
        const usedQuota = quotaTracker.get(origin) || 0;

        if (dataSize > SIMULATED_QUOTA || (dataSize > 0 && (usedQuota + dataSize > SIMULATED_QUOTA))) {
            log(`Blocked call to ${origin} due to simulated quota exceeded (size: ${dataSize})`);
            return false;
        }

        if (dataSize > 0) {
            quotaTracker.set(origin, usedQuota + dataSize);
        }
        log(`Intercepted and blocked sendBeacon call to: ${url} (size: ${dataSize} bytes, origin: ${origin})`);
        return true;
    };


    // --- Application and Stealth Logic ---
    function applySpoof() {
        try {
            const spoofedToString = () => 'function sendBeacon() { [native code] }';
            
            // **IMPROVEMENT**: Make the toString method itself appear native.
            Object.defineProperty(spoofedToString, 'toString', {
                value: () => originalToString.call(originalToString),
                writable: false,
                enumerable: false,
                configurable: true
            });

            Object.defineProperties(spoofedSendBeacon, {
                "length": { value: 1, writable: false, enumerable: false, configurable: true },
                "name": { value: "sendBeacon", writable: false, enumerable: false, configurable: true },
                "toString": { value: spoofedToString, writable: false, enumerable: false, configurable: true },
                "prototype": { value: undefined, writable: false, enumerable: false, configurable: false }
            });
            Object.preventExtensions(spoofedSendBeacon);

            let finalFunction = spoofedSendBeacon;
            if (typeof exportFunction === 'function') {
                finalFunction = exportFunction(spoofedSendBeacon, window);
            } else if (typeof cloneInto === 'function') {
                finalFunction = cloneInto(spoofedSendBeacon, window, { cloneFunctions: true });
            }

            Object.defineProperty(Navigator.prototype, 'sendBeacon', {
                value: finalFunction,
                writable: true,
                enumerable: true,
                configurable: true
            });

            log('Spoof applied successfully to Navigator.prototype.');

        } catch (e) {
            warn('Could not modify Navigator.prototype. Applying fallback to navigator instance.', e);
            try {
                Object.defineProperty(navigator, 'sendBeacon', {
                    value: spoofedSendBeacon,
                    writable: true,
                    enumerable: true,
                    configurable: true
                });
                log('Spoof applied successfully to navigator instance (fallback).');
            } catch (e2) {
                console.error(`${SCRIPT_PREFIX} Critical error: Failed to apply spoof completely.`, e2);
            }
        }
    }

    applySpoof();

    window.addEventListener('beforeunload', () => {
        quotaTracker.clear();
        log('Simulated beacon quota cleared on page unload.');
    });
})();