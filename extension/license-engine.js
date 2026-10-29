/* Verify-only licensing: the owner's private signing key is never distributed. */
(function(root){
  const bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const hex=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
  const tag=s=>String(s||'').toUpperCase().replace(/^DEV-/,'').replace(/[^A-Z0-9]/g,'');
  async function legacy(key,deviceId,clock=Date.now()){
    const p=String(key||'').trim().toUpperCase().split('-');let raw,code,dev='ALL',exp,sig;
    if(p[0]!=='RAINY')return null;
    if(p.length===5){[,code,dev,exp,sig]=p;raw=`RAINY_SECRET_SALT_2026_UB#${code}#${dev}#${exp}`;}
    else if(p.length===4){[,code,exp,sig]=p;raw=`RAINY_SECRET_SALT_2026_UB#${code}#${exp}`;}else return null;
    if(!/^\d+D$/.test(code)||!/^[A-F0-9]+$/.test(exp)||dev!=='ALL'&&dev!==tag(deviceId))return null;
    const expected=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).slice(0,8).toUpperCase();
    const expiresAt=parseInt(exp,16)*1000;if(sig!==expected||!Number.isSafeInteger(expiresAt))return null;
    return {ok:true,valid:expiresAt>clock,trial:false,legacy:true,expiresAt,deviceId,daysLeft:Math.max(0,Math.ceil((expiresAt-clock)/86400000)),key};
  }
  async function signed(token,deviceId,publicKey,clock=Date.now()){
    try{
      const [prefix,payload,sig,...extra]=String(token||'').split('.');if(prefix!=='RP1'||extra.length||!publicKey)return null;
      const key=await crypto.subtle.importKey('spki',bytes(publicKey),{name:'Ed25519'},false,['verify']);
      if(!await crypto.subtle.verify('Ed25519',key,bytes(sig),new TextEncoder().encode(payload)))return null;
      const data=JSON.parse(new TextDecoder().decode(bytes(payload)));
      if(data.deviceId!==deviceId||!Number.isSafeInteger(data.expiresAt)||!Number.isSafeInteger(data.issuedAt)||data.issuedAt>clock+300000||data.expiresAt<=data.issuedAt)return null;
      return {ok:true,valid:data.expiresAt>clock,trial:false,signed:true,expiresAt:data.expiresAt,issuedAt:data.issuedAt,deviceId,daysLeft:Math.max(0,Math.ceil((data.expiresAt-clock)/86400000)),key:token};
    }catch{return null;}
  }
  root.RainyLicense={legacy,signed};if(typeof module!=='undefined')module.exports=root.RainyLicense;
})(globalThis);
