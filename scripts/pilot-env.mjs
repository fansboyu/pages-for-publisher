import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { project } from '../pilot/db.mjs';
export async function localEnv(){
 try{const config=await fs.readFile(join(project,'.env.local'),'utf8');for(const line of config.split(/\r?\n/)){const match=line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);if(!match||match[2].startsWith('#'))continue;const value=match[2].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/,'$1$2');if(!process.env[match[1]]&&value&&!value.includes('填写')&&!/^your[-_]/i.test(value))process.env[match[1]]=value}}
 catch(error){if(error.code!=='ENOENT')throw error}
 if(process.env.DATABASE_URL&&process.env.REDIS_URL)return {DATABASE_URL:process.env.DATABASE_URL,REDIS_URL:process.env.REDIS_URL};
 const text=await fs.readFile(join(project,'storage','pilot.env'),'utf8'),env=Object.fromEntries(text.trim().split(/\r?\n/).map(line=>line.split('=')));
 return {DATABASE_URL:process.env.DATABASE_URL||`postgres://sitecontrol:${env.POSTGRES_PASSWORD}@127.0.0.1:55432/sitecontrol`,REDIS_URL:process.env.REDIS_URL||`redis://:${env.REDIS_PASSWORD}@127.0.0.1:16379/0`}
}
