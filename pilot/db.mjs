import pg from 'pg';
import { promises as fs } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export function database(){if(!process.env.DATABASE_URL)throw Error('DATABASE_URL 必填，正式试点版不回退到 SQLite');return new pg.Pool({connectionString:process.env.DATABASE_URL,max:Number(process.env.DB_POOL_SIZE||12),connectionTimeoutMillis:5000})}
export async function checkDatabase(pool){const row=(await pool.query("SELECT current_setting('server_version') version,current_setting('server_version_num')::integer number")).rows[0];if(row.number<180006||/beta|rc|devel/i.test(row.version))throw Error('正式试点要求 PostgreSQL 18.6 或更新的稳定版，禁止预发布版');return row.version}
export async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}}
export async function migrate(pool){await checkDatabase(pool);await transaction(pool,async c=>{await c.query("SELECT pg_advisory_xact_lock(hashtext('site-control-migrations'))");await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');for(const name of (await fs.readdir(join(project,'pilot','migrations'))).filter(n=>n.endsWith('.sql')).sort()){if(!(await c.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name])).rowCount){await c.query(await fs.readFile(join(project,'pilot','migrations',name),'utf8'));await c.query('INSERT INTO schema_migrations(name) VALUES($1)',[name])}}})}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const db=database();try{await migrate(db);console.log('PostgreSQL migrations applied')}finally{await db.end()}}
