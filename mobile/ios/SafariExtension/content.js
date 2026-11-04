(() => {
  if (window.__RAINY_FB_MOBILE__) return;
  window.__RAINY_FB_MOBILE__ = true;
  const match = location.hash.match(/^#rainy-mobile=([a-f0-9-]{36})(:auto)?$/i);
  if (!match) return;
  const [, jobId, automatic] = match;
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'RAINY · Нийтлэлт эхлүүлэх';
  button.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:12px;min-height:44px;padding:10px;background:#1256d8;color:white;border-radius:10px';
  async function run() {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = 'Нийтэлж байна…';
    try {
      const response = await (globalThis.browser || chrome).runtime.sendMessage({
        action: 'RAINY_MOBILE_RUN', jobId, automatic: Boolean(automatic)
      });
      if (response?.next) {
        button.textContent = 'Дараагийн групп рүү шилжиж байна…';
        setTimeout(() => location.assign(response.next), 5000);
        return;
      }
      button.textContent = ({
        PUBLISHED: 'Нийтлэгдлээ',
        PENDING_APPROVAL: 'Админы зөвшөөрөл хүлээж байна',
        SKIPPED: 'Группт нийтлэх боломжгүй байна',
        UNKNOWN: 'Төлөв тодорхойгүй. Группээ шалгана уу.'
      })[response?.result?.status] || 'Нийтлэл баталгаажаагүй. Группээ шалгана уу.';
      if (response?.result?.status === 'PUBLISHED') {
        setTimeout(() => location.assign('https://workspace.rainy.studio/mobile/'), 5000);
      }
    } catch {
      button.textContent = 'Төлөв тодорхойгүй. Группээ шалгана уу.';
    }
  }
  button.addEventListener('click', event => { if (event.isTrusted) run(); });
  document.body.append(button);
  if (automatic) {
    if (document.visibilityState === 'visible') run();
    else document.addEventListener('visibilitychange', function resume() {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', resume);
      run();
    });
  }
})();