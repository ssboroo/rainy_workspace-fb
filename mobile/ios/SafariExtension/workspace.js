const rainyRuntime = (globalThis.browser || chrome).runtime;
window.addEventListener('message', async event => {
  if (event.source !== window || event.origin !== location.origin ||
      event.data?.type !== 'RAINY_MOBILE_POST') return;
  const {id, urls, text, image, scheduleId} = event.data;
  try {
    const result = await rainyRuntime.sendMessage({action: 'RAINY_MOBILE_STAGE', urls, text, image, scheduleId});
    window.postMessage({type: 'RAINY_MOBILE_REPLY', id, ...result}, location.origin);
  } catch {
    window.postMessage({type: 'RAINY_MOBILE_REPLY', id, ok: false}, location.origin);
  }
});