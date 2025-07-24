// ==UserScript==
// @name        Beacon API Spoof
// @version     2.1.0
// @description Intercepts and disables navigator.sendBeacon() by mimicking successful queuing with improved accuracy and stealth.
// @author      
// @match       *://*/*
// @run-at      document-start
// @grant       none
// @namespace   https://github.comS0methingSomething/
// @homepageURL https://github.com/S0methingSomething/
// @license     MIT
// ==/UserScript==

(function() {
    'use strict';

    const SCRIPT_PREFIX = '[Beacon API Spoof]';
    const SIMULATED_QUOTA = 65536; // 64 KiB - Standard Beacon Quota per transmission, but we'll simulate accumulation
    const ENABLE_LOGGING = false; // Toggle this to true for logging intercepted calls and debug info

    // Simulated per-origin quota tracker (resets on page load/unload simulation)
    // In reality, beacons are queued until transmission, but we simulate accumulation for better mimicry.
    const quotaTracker = new Map(); // Key: origin, Value: used quota

    /**
     * Logs messages if logging is enabled.
     * @param {...any} args - Arguments to log.
     */
    function log(...args) {
        if (ENABLE_LOGGING) {
            console.log(SCRIPT_PREFIX, ...args);
        }
    }

    /**
     * Logs warnings if logging is enabled.
     * @param {...any} args - Arguments to warn.
     */
    function warn(...args) {
        if (ENABLE_LOGGING) {
            console.warn(SCRIPT_PREFIX, ...args);
        }
    }

    /**
     * Gets the origin from a URL, falling back to current page origin.
     * @param {string} url - The URL to parse.
     * @returns {string} The origin.
     */
    function getOrigin(url) {
        try {
            return new URL(url, window.location.origin).origin;
        } catch (e) {
            return window.location.origin;
        }
    }

    /**
     * Estimates the size of FormData as multipart/form-data more accurately.
     * Simulates boundary, headers, and content without full encoding.
     * @param {FormData} formData - The FormData object.
     * @returns {number} Estimated byte size.
     */
    function estimateFormDataSize(formData) {
        let size = 0;
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2); // Simulate a boundary
        const boundaryLength = boundary.length + 2; // --boundary\r\n
        const crlf = 2; // \r\n bytes

        try {
            for (const [key, value] of formData.entries()) {
                // Header: --boundary\r\nContent-Disposition: form-data; name="key"\r\n\r\n
                let header = `--${boundary}\r\nContent-Disposition: form-data; name="${key}"`;
                if (value instanceof File || value instanceof Blob) {
                    header += `; filename="${value.name || 'blob'}"\r\nContent-Type: ${value.type || 'application/octet-stream'}`;
                }
                header += '\r\n\r\n';
                size += new Blob([header]).size;

                // Value size
                if (value instanceof Blob) {
                    size += value.size;
                } else if (typeof value === 'string') {
                    size += new Blob([value]).size;
                } else {
                    size += 0; // Unsupported, but skip for estimation
                }

                size += crlf; // \r\n after value
            }
            // Final boundary: --boundary--
            size += boundaryLength + 2; // --boundary--
        } catch (e) {
            warn('Error estimating FormData size:', e);
            return 0; // Fallback to 0 to avoid blocking valid calls
        }

        return size;
    }

    /**
     * Creates the spoofed sendBeacon function.
     * This function mimics the synchronous checks of the real sendBeacon
     * but always returns true (simulating successful queuing) without sending data.
     * @returns {function(string, BodyInit=): boolean} The spoofed sendBeacon function.
     */
    function createSpoofedSendBeacon() {
        return function spoofedSendBeacon(url, data) {
            // 1. Context Check: Ensure 'this' is the navigator object.
            if (this !== window.navigator) {
                warn('sendBeacon called with incorrect \'this\' context.');
                return false;
            }

            // 2. URL Validation: Check if the URL is valid/parsable.
            let parsedUrl;
            try {
                parsedUrl = new URL(url, window.location.origin);
            } catch (e) {
                return false;
            }

            const origin = parsedUrl.origin;

            // 3. Data Type & Simulated Size Validation
            let dataSize = 0;
            if (data !== undefined && data !== null) {
                if (data instanceof Blob) {
                    dataSize = data.size;
                } else if (typeof data === 'string') {
                    dataSize = new Blob([data]).size;
                } else if (data instanceof FormData) {
                    dataSize = estimateFormDataSize(data);
                } else if (ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
                    dataSize = data.byteLength;
                } else if (data instanceof URLSearchParams) {
                    dataSize = new Blob([data.toString()]).size;
                } else {
                    return false;
                }

                // Simulated dynamic quota check per origin
                const usedQuota = quotaTracker.get(origin) || 0;
                if (usedQuota + dataSize > SIMULATED_QUOTA) {
                    return false;
                }
                // "Queue" the data by accumulating simulated usage
                quotaTracker.set(origin, usedQuota + dataSize);
            }

            // 4. Simulation Success: If all checks pass, mimic successful queuing.
            log(`Intercepted and blocked sendBeacon call to: ${url} (size: ${dataSize} bytes, origin: ${origin})`);
            return true;
        };
    }

    /**
     * Applies the spoofed sendBeacon function to the navigator object.
     * Handles potential compatibility issues and attempts to make the spoofed function appear native.
     */
    function applySpoof() {
        try {
            let finalFunctionToAssign = createSpoofedSendBeacon();
            let functionToSpoofPropertiesOn = finalFunctionToAssign;

            // --- Compatibility for Sandboxed Environments (e.g., Greasemonkey) ---
            if (typeof exportFunction === 'function') {
                try {
                    finalFunctionToAssign = exportFunction(finalFunctionToAssign, window, { defineAs: 'spoofedSendBeacon_exportedLogic' });
                    functionToSpoofPropertiesOn = finalFunctionToAssign;
                    log('Using exportFunction for compatibility.');
                } catch (e) {
                    warn('exportFunction failed, proceeding without it:', e);
                }
            } else if (typeof cloneInto === 'function') {
                // Additional check for Firefox-specific cloning if needed
                try {
                    finalFunctionToAssign = cloneInto(finalFunctionToAssign, window, { cloneFunctions: true });
                    functionToSpoofPropertiesOn = finalFunctionToAssign;
                    log('Using cloneInto for additional compatibility.');
                } catch (e) {
                    warn('cloneInto failed:', e);
                }
            }

            // --- Define the Property Robustly ---
            Object.defineProperty(window.navigator, 'sendBeacon', {
                value: finalFunctionToAssign,
                writable: false,
                enumerable: true,
                configurable: false
            });

            // --- Enhanced Spoof Function Properties for Stealth ---
            const assignedFunc = window.navigator.sendBeacon;
            if (assignedFunc && assignedFunc === functionToSpoofPropertiesOn) {
                try {
                    Object.defineProperties(assignedFunc, {
                        "length": { value: 2, writable: false, enumerable: false, configurable: true },
                        "name": { value: "sendBeacon", writable: false, enumerable: false, configurable: true },
                        "toString": { value: () => 'function sendBeacon() { [native code] }', writable: false, enumerable: false, configurable: true },
                        "prototype": { value: undefined, writable: false, enumerable: false, configurable: false }, // Mimic native (often undefined)
                        "caller": { value: null, writable: false, enumerable: false, configurable: true }, // Native functions often have null caller
                        "arguments": { value: null, writable: false, enumerable: false, configurable: true } // Native often null
                    });
                    // Make the function non-extensible for extra stealth
                    Object.preventExtensions(assignedFunc);
                } catch (e) {
                    warn('Failed to spoof function properties:', e);
                }
            } else {
                warn('Assigned function reference mismatch. Skipping property spoofing.');
            }
            log('Spoof applied successfully.');

        } catch (e) {
            console.error(`${SCRIPT_PREFIX} Critical error during spoof application:`, e);
            // --- Fallback: Less Robust Assignment ---
            try {
                const fallbackFunc = createSpoofedSendBeacon();
                window.navigator.sendBeacon = fallbackFunc;
                warn('Used fallback assignment method.');
                // Basic property spoofing on fallback
                try {
                    Object.defineProperties(fallbackFunc, {
                        "length": { value: 2, configurable: true },
                        "name": { value: "sendBeacon", configurable: true },
                        "toString": { value: () => 'function sendBeacon() { [native code] }', configurable: true },
                        "prototype": { value: undefined, configurable: true }
                    });
                    Object.preventExtensions(fallbackFunc);
                } catch (e_prop) {
                    warn('Failed to spoof properties on fallback:', e_prop);
                }
            } catch (e2) {
                console.error(`${SCRIPT_PREFIX} Failed to apply spoof completely:`, e2);
            }
        }
    }

    // Apply the spoof
    applySpoof();

    // Optional: Reset quota on page unload to simulate beacon transmission
    window.addEventListener('beforeunload', () => {
        quotaTracker.clear();
    });

})();
