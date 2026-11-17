import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,join,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=await realpath(join(dirname(fileURLToPath(import.meta.url)),'../public/assets/categorias'));
const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
const keys=['ciencia','cultura','economia','politica','sociedad','tecnologia'];
assert.deepEqual(Object.keys(manifest.assets).sort(),keys,'CATEGORIAS_INVALIDAS');
assert.ok(manifest.version&&manifest.status&&manifest.origin&&manifest.license,'METADATOS_INCOMPLETOS');
for(const key of keys){
 const asset=manifest.assets[key];
 assert.match(asset.path,/^\/assets\/categorias\/[a-z0-9-]+\.png$/,'RUTA_INVALIDA');
 assert.match(asset.sha256,/^[a-f0-9]{64}$/,'HUELLA_INVALIDA');
 const target=await realpath(join(root,asset.path.split('/').at(-1)));
 const rel=relative(root,target);
 assert.ok(rel&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep),'RUTA_FUERA_DE_CARPETA');
 const data=await readFile(target);
 assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a','PNG_INVALIDO');
 assert.equal(createHash('sha256').update(data).digest('hex'),asset.sha256,'HUELLA_DISTINTA '+key);
}
console.log('Recursos de categorías: seis PNG y huellas verificados; estado: '+manifest.status+'.');
