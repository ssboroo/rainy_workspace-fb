/* Safari exposes the WebExtensions API as browser.*. The shared Facebook
 * content script was authored against chrome.*, so provide a compatible alias. */
(() => {
  if (typeof globalThis.browser === 'undefined') return;
  if (typeof globalThis.chrome === 'undefined') {
    Object.defineProperty(globalThis, 'chrome', {
      configurable: true,
      enumerable: false,
      value: globalThis.browser,
      writable: false
    });
  }
})();
