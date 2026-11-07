CREATE TABLE ai_article_jobs (
 id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id), actor_id text NOT NULL REFERENCES users(id),
 order_id text NOT NULL UNIQUE REFERENCES billing_orders(id), input jsonb NOT NULL, site_snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','review')),
 demo boolean NOT NULL, result jsonb, error text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE INDEX ai_article_jobs_pending ON ai_article_jobs(created_at) WHERE status='queued';
