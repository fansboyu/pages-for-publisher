import {database,checkDatabase} from './db.mjs';
import {localEnv} from '../scripts/pilot-env.mjs';
import {createStorage} from '../storage-adapter.mjs';
import {dataRoot} from './templates.mjs';
import {processWebsiteJob} from './website-builder.mjs';
import {processArticleJob} from './ai-article-jobs.mjs';
Object.assign(process.env,await localEnv());const db=database();await checkDatabase(db);const store=createStorage(dataRoot());let stopping=false;
process.on('SIGINT',()=>stopping=true);process.on('SIGTERM',()=>stopping=true);
console.log('AI Worker ready');
try{while(!stopping){try{await processArticleJob(db,store);if(!stopping)await processWebsiteJob(db,store);}catch(error){console.error('AI task failed:',error.message)}if(!stopping)await new Promise(r=>setTimeout(r,750))}}finally{await db.end()}
