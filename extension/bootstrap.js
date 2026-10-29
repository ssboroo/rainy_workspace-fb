const mode=new URLSearchParams(location.search).get('mode');
if(mode==='tab')document.documentElement.classList.add('fullpage');
if(mode==='side')document.documentElement.classList.add('sidepanel');
