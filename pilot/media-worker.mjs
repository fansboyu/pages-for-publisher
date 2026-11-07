import {database,checkDatabase} from './db.mjs';
import {localEnv} from '../scripts/pilot-env.mjs';
import {processExternalJob} from './external-publishing.mjs';
Object.assign(process.env,await localEnv());const db=database();await checkDatabase(db);let stopping=false;
process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
console.log('MEDIA Worker ready');
try{while(!stopping){try{await processExternalJob(db);}catch(error){console.error('MEDIA task failed:',error.message)}if(!stopping)await new Promise(r=>setTimeout(r,750))}}finally{await db.end()}
