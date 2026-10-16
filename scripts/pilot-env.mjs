import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { project } from '../pilot/db.mjs';
export async function localEnv(){if(process.env.DATABASE_URL&&process.env.REDIS_URL)return {DATABASE_URL:process.env.DATABASE_URL,REDIS_URL:process.env.REDIS_URL};const text=await fs.readFile(join(project,'storage','pilot.env'),'utf8'),env=Object.fromEntries(text.trim().split(/\r?\n/).map(line=>line.split('=')));return {DATABASE_URL:process.env.DATABASE_URL||`postgres://sitecontrol:${env.POSTGRES_PASSWORD}@127.0.0.1:55432/sitecontrol`,REDIS_URL:process.env.REDIS_URL||`redis://:${env.REDIS_PASSWORD}@127.0.0.1:16379/0`}}
