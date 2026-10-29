(()=>{
  let theme;try{theme=localStorage.getItem('rainyTheme');}catch{}
  document.documentElement.dataset.theme=theme==='dark'?'dark':'light';
  function paint(){const b=document.getElementById('themeToggle');if(!b)return;const dark=document.documentElement.dataset.theme==='dark';b.textContent=dark?'☀ Light':'☾ Dark';b.setAttribute('aria-label',dark?'Light горимд шилжих':'Dark горимд шилжих');b.setAttribute('aria-pressed',String(dark));}
  document.addEventListener('DOMContentLoaded',()=>{paint();document.getElementById('themeToggle')?.addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;try{localStorage.setItem('rainyTheme',t);}catch{}paint();});});
})();
