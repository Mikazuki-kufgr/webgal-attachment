import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const [name,cwd,...args]=process.argv.slice(2);
if(!/^[a-z0-9-]+$/.test(name)||!cwd||!args.length)throw Error('Usage name cwd node-args...');
const file=path.join(import.meta.dirname,'evidence',name+'.log');
const log=fs.createWriteStream(file,{flags:'wx'}),started=new Date().toISOString();
const child=spawn(process.execPath,args,{cwd,env:process.env,windowsHide:true});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.on('error',e=>{log.end(String(e));process.exitCode=1;});
child.on('close',code=>{log.end();fs.writeFileSync(path.join(import.meta.dirname,'evidence',name+'.result.json'),JSON.stringify({started,ended:new Date().toISOString(),cwd,args,code,log:file},null,2));console.log(JSON.stringify({name,code,log:file}));process.exitCode=code??1;});
