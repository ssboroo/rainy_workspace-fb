// Owner-only build/signing helper. Distribute extension/ only to customers.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const owner=path.dirname(fileURLToPath(import.meta.url)),ext=path.resolve(owner,'../extension');
const cfg=path.join(ext,'owner-config.json'),config=JSON.parse(fs.readFileSync(cfg));const [command,...args]=process.argv.slice(2);
if(command==='configure'){
  const [url]=args;const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.search||u.pathname!=='/')throw new Error('Use an HTTPS origin only');
  config.serverUrl=u.origin;fs.writeFileSync(cfg,JSON.stringify(config,null,2));
  const mp=path.join(ext,'manifest.json'),m=JSON.parse(fs.readFileSync(mp));m.host_permissions=[...new Set(['https://*.facebook.com/*',u.origin+'/*'])];m.optional_host_permissions=[];fs.writeFileSync(mp,JSON.stringify(m,null,2));console.log('Owner endpoint configured. Distribute only the updated extension folder.');
}else if(command==='init-signing'){
  const privatePath=path.join(owner,'PRIVATE-DO-NOT-DISTRIBUTE.pem');if(fs.existsSync(privatePath))throw new Error('Existing key preserved; refusing to overwrite.');
  const pair=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(privatePath,pair.privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
  config.licensePublicKey=pair.publicKey.export({type:'spki',format:'der'}).toString('base64');config.acceptLegacyLicenses=false;fs.writeFileSync(cfg,JSON.stringify(config,null,2));console.log('Private key saved to owner directory. Public verification key installed in extension.');
}else if(command==='license'){
  const [deviceId,rawDays]=args,days=Number(rawDays);if(!/^DEV-[a-zA-Z0-9-]+$/.test(deviceId||'')||![30,90,365].includes(days))throw new Error('license DEV-DEVICE-ID 30|90|365');
  const issuedAt=Date.now(),expiresAt=issuedAt+days*86400000,payload=Buffer.from(JSON.stringify({deviceId,issuedAt,expiresAt})).toString('base64url');
  const signature=crypto.sign(null,Buffer.from(payload),fs.readFileSync(path.join(owner,'PRIVATE-DO-NOT-DISTRIBUTE.pem'))).toString('base64url');console.log('RP1.'+payload+'.'+signature);console.log('Expires: '+new Date(expiresAt).toISOString());
}else console.log('Owner commands:\n node manage.mjs configure https://YOUR-ACTUAL-LICENSE-SERVER\n node manage.mjs init-signing\n node manage.mjs license DEV-DEVICE-ID 30|90|365\n\nNever distribute PRIVATE-DO-NOT-DISTRIBUTE.pem.');
