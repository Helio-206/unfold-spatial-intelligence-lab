import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,resolve,relative} from 'node:path';
import {assessResult} from './metrics.mjs';
const input=process.argv[2]; if(!input)throw Error('usage: node scripts/visual-quality/report.mjs <capture/result.json>');
const record=JSON.parse(await readFile(input,'utf8')), base=resolve(dirname(input)), captures={};
for(const [name,file] of Object.entries(record.captures??{})){
 const path=resolve(base,file); if(relative(base,path).startsWith('..'))throw Error('CAPTURE_OUTSIDE_DIRECTORY');
 try {const bytes=await readFile(path); const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));captures[name]={verified:png && bytes.length>100,path:file,sha256:createHash('sha256').update(bytes).digest('hex')};}catch {captures[name]={verified:false,path:file};}
}
const result={provider:record.provider,fixture:record.fixture,classification:assessResult({...record,captures}),captures,review:record.review??null,limitations:['No classification without complete independently reviewed evidence.','Counts and timing do not establish visual quality or GPU presentation time.']};
await writeFile(resolve(base,'gate.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result.classification));
