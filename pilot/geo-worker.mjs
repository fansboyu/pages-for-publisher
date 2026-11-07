import {database,checkDatabase} from './db.mjs';
import {localEnv} from '../scripts/pilot-env.mjs';
import {createStorage} from '../storage-adapter.mjs';
import {dataRoot} from './templates.mjs';
import {processGeoJob} from './geo-workflow.mjs';
Object.assign(process.env,await localEnv());const db=database();await checkDatabase(db);const store=createStorage(dataRoot());let stopping=false;
process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
console.log('GEO Worker ready');
try{while(!stopping){try{await processGeoJob(db,{store});}catch(error){console.error('GEO task failed:',error.message)}if(!stopping)await new Promise(r=>setTimeout(r,750))}}finally{await db.end()}
