import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { project } from '../pilot/db.mjs';
const file=join(project,'storage','pilot.env');await fs.mkdir(join(project,'storage'),{recursive:true});
try{await fs.access(file)}catch{await fs.writeFile(file,`POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nREDIS_PASSWORD=${randomBytes(24).toString('hex')}\n`,{mode:0o600})}
const p=spawn('docker',['compose','--env-file',file,'-f','compose.pilot.yml','up','-d','--wait'],{cwd:project,stdio:'inherit',windowsHide:true});p.on('error',console.error);p.on('exit',code=>process.exitCode=code||0);
