import { spawn } from 'node:child_process';
import { promises as fs,createWriteStream,createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join,resolve,basename,sep } from 'node:path';
import { createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';
import tar from 'tar-stream';
import { project } from '../pilot/db.mjs';

const compose=process.env.BACKUP_COMPOSE_FILE||join(project,'compose.production.yml');
let composeEnv=process.env.BACKUP_COMPOSE_ENV_FILE;
if(!composeEnv){try{await fs.access(join(project,'.env'));composeEnv=join(project,'.env')}catch{try{await fs.access(join(project,'storage','pilot.env'));composeEnv=join(project,'storage','pilot.env')}catch{}}}
const composeArgs=['compose',...(composeEnv?['--env-file',composeEnv]:[]),'-f',compose];
const dataRoot=process.env.BACKUP_DATA_ROOT?resolve(process.env.BACKUP_DATA_ROOT):null;
const out=resolve(process.env.BACKUP_DIR||join(project,'backups'));
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
async function runToFile(command,args,file){
 const child=spawn(command,args,{cwd:project,windowsHide:true,stdio:['ignore','pipe','pipe']}),errors=[];
 child.stderr.on('data',chunk=>{if(errors.reduce((n,x)=>n+x.length,0)<32000)errors.push(chunk)});
 const written=pipeline(child.stdout,createWriteStream(file,{mode:0o600}));
 const status=new Promise((resolveStatus,rejectStatus)=>{child.once('error',rejectStatus);child.once('close',code=>code===0?resolveStatus():rejectStatus(Error(Buffer.concat(errors).toString()||`${command} exited ${code}`)))});
 await Promise.all([written,status]);
}
async function addFile(pack,name,file){const stat=await fs.stat(file),hash=createHash('sha256'),stream=pack.entry({name,size:stat.size,mode:0o600}),checksum=new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback(null,chunk)}});await pipeline(createReadStream(file),checksum,stream);return hash.digest('hex')}

await fs.mkdir(out,{recursive:true});
const tempRoot=resolve(tmpdir()),temp=await fs.mkdtemp(join(tempRoot,'sitecontrol-backup-')),dbFile=join(temp,'sitecontrol.dump'),dataFile=join(temp,'platform-data.tar.gz'),file=join(out,`sitecontrol-${timestamp}.tar.gz`),pack=tar.pack(),written=pipeline(pack,createGzip({level:6}),createWriteStream(file,{mode:0o600}));written.catch(()=>{});
try{
 await runToFile(process.env.DOCKER_BIN||'docker',[...composeArgs,'exec','-T','postgres','pg_dump','-U','sitecontrol','-d','sitecontrol','--format=custom'],dbFile);
 if(dataRoot)await runToFile('tar',['-czf','-','-C',dataRoot,'.'],dataFile);else await runToFile(process.env.DOCKER_BIN||'docker',[...composeArgs,'exec','-T','api','tar','-czf','-','-C','/data','.'],dataFile);
 const dbHash=await addFile(pack,'database/sitecontrol.dump',dbFile),dataHash=await addFile(pack,'platform-data.tar.gz',dataFile);
 const manifest=Buffer.from(JSON.stringify({createdAt:new Date().toISOString(),databaseDump:'database/sitecontrol.dump',platformData:'platform-data.tar.gz',databaseSha256:dbHash,platformDataSha256:dataHash,includes:['PostgreSQL database','platform file storage'],excludes:['.env secrets','Redis queue cache']},null,2));pack.entry({name:'manifest.json',size:manifest.length,mode:0o600},manifest);pack.finalize();await written;
 const checksum=createHash('sha256');for await(const chunk of createReadStream(file))checksum.update(chunk);const digest=checksum.digest('hex');await fs.writeFile(`${file}.sha256`,`${digest}  ${basename(file)}\n`,{mode:0o600});
 const keep=Math.max(1,Number(process.env.BACKUP_RETENTION_COUNT||14)),existing=(await fs.readdir(out)).filter(n=>/^sitecontrol-.*\.tar\.gz$/.test(n)).sort().reverse();for(const old of existing.slice(keep)){await fs.rm(join(out,old),{force:true});await fs.rm(join(out,`${old}.sha256`),{force:true})}
 console.log(`Backup created: ${file}, sha256 ${digest}`);
}catch(error){pack.destroy();await written.catch(()=>{});await fs.rm(file,{force:true}).catch(()=>{});throw error}
finally{if(!resolve(temp).startsWith(tempRoot+sep))throw Error('Refusing to remove temporary directory outside system temp');await fs.rm(temp,{recursive:true,force:true})}
