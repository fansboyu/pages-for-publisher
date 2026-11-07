import {processGeoJob} from './geo-workflow.mjs';
import {createStorage} from '../storage-adapter.mjs';
import {dataRoot} from './templates.mjs';
import { database,checkDatabase } from './db.mjs';
import { processExternalJob } from './external-publishing.mjs';
import { localEnv } from '../scripts/pilot-env.mjs';
Object.assign(process.env,await localEnv());const db=database();await checkDatabase(db);const store=createStorage(dataRoot());let stopping=false;process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
console.log('External services Worker ready: media publishing + GEO query dispatch');
try{while(!stopping){try{await processExternalJob(db)}catch{console.error('External publishing task failed; inspect order state')}try{await processGeoJob(db,{store})}catch{console.error('GEO task failed; inspect query record')}await new Promise(r=>setTimeout(r,750))}}finally{await db.end()}
