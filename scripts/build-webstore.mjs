import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'extension');
const output=path.resolve(process.argv[2]||path.join(root,'dist','rainy-fb-pro-webstore'));

function inside(parent,child){
  const rel=path.relative(parent,child);
  return rel!==''&&!rel.startsWith('..')&&!path.isAbsolute(rel);
}
if(output===root||output===source||inside(source,output)||inside(output,root))throw new Error('Output cannot replace the repository or be written inside extension source.');

await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});

async function copyTree(from,to){
  const entries=await fs.readdir(from,{withFileTypes:true});
  for(const entry of entries){
    if(entry.name==='.DS_Store'||entry.name==='Thumbs.db')continue;
    const src=path.join(from,entry.name),dst=path.join(to,entry.name);
    if(entry.isSymbolicLink())throw new Error('Symlinks are not allowed in the release package: '+src);
    if(entry.isDirectory()){
      await fs.mkdir(dst,{recursive:true});
      await copyTree(src,dst);
    }else if(entry.isFile()){
      if(/\.pem$/i.test(entry.name)||/^\.env(?:\.|$)/i.test(entry.name)||/\.map$/i.test(entry.name)){
        throw new Error('Sensitive or development-only file found in extension/: '+entry.name);
      }
      await fs.copyFile(src,dst);
    }
  }
}
await copyTree(source,output);

const manifestPath=path.join(output,'manifest.json');
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
if(manifest.manifest_version!==3)throw new Error('Chrome Web Store requires Manifest V3.');
if(!manifest.name||!manifest.version||!manifest.description)throw new Error('Manifest requires name, version and description.');
if(manifest.description.length>132)throw new Error('Manifest description exceeds 132 characters.');
if(!/^\\d+\\.\\d+\\.\\d+$/.test(manifest.version))throw new Error('Manifest version must use MAJOR.MINOR.PATCH: '+manifest.version);

// A new Chrome Web Store item gets its permanent ID from the Store. The source
// manifest keeps its development key; only this first-upload artifact omits it.
delete manifest.key;
await fs.writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');

const referenced=[];
if(manifest.background?.service_worker)referenced.push(manifest.background.service_worker);
if(manifest.action?.default_popup)referenced.push(manifest.action.default_popup);
if(manifest.side_panel?.default_path)referenced.push(manifest.side_panel.default_path);
for(const icon of Object.values(manifest.icons||{}))referenced.push(icon);
for(const icon of Object.values(manifest.action?.default_icon||{}))referenced.push(icon);
for(const item of manifest.content_scripts||[])referenced.push(...(item.js||[]),...(item.css||[]));
for(const item of manifest.web_accessible_resources||[])referenced.push(...(item.resources||[]));
for(const item of manifest.options_ui?.page?[manifest.options_ui.page]:[])referenced.push(item);
for(const item of manifest.options_page?[manifest.options_page]:[])referenced.push(item);
for(const file of referenced){
  const localFile=String(file).split(/[?#]/,1)[0];
  const resolved=path.resolve(output,localFile);
  if(!inside(output,resolved))throw new Error('Manifest path escapes package root: '+file);
  await fs.access(resolved);
}
const files=[];
async function list(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const p=path.join(dir,entry.name);
    if(entry.isDirectory())await list(p);else files.push(path.relative(output,p));
  }
}
await list(output);
if(files.some(f=>/\.pem$/i.test(f)||/^\.env(?:\.|$)/i.test(path.basename(f))))throw new Error('Private key or environment file leaked into package.');
console.log(JSON.stringify({ok:true,name:manifest.name,version:manifest.version,files:files.length,output,manifestKeyRemoved:true},null,2));
