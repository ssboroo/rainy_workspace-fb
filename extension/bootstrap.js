// Popup must have fixed intrinsic dimensions: vw/vh can collapse its first layout.
if(new URLSearchParams(location.search).get('mode')==='tab')document.documentElement.classList.add('fullpage');
