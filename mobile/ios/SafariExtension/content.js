(() => {
  if (window.__RAINY_FB_MOBILE__) return;
  window.__RAINY_FB_MOBILE__ = true;
  const banner = document.createElement("div");
  banner.textContent = "RAINY FB Pro Mobile · холбогдсон";
  banner.setAttribute("role", "status");
  banner.style.cssText = "position:fixed;z-index:2147483647;bottom:12px;left:12px;padding:8px 12px;border-radius:10px;background:#1256d8;color:white;font:600 12px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 3px 14px #0003";
  (document.body || document.documentElement).appendChild(banner);
})();
