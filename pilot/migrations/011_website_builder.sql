CREATE TABLE website_builder_drafts (
 site_id text PRIMARY KEY REFERENCES sites(id), spec jsonb,
 revision integer NOT NULL DEFAULT 0, applied_revision integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE website_builder_versions (
 site_id text NOT NULL REFERENCES sites(id), revision integer NOT NULL,
 spec jsonb NOT NULL, instruction text NOT NULL, actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(site_id,revision)
);
CREATE TABLE website_builder_jobs (
 id text PRIMARY KEY, site_id text NOT NULL REFERENCES sites(id),
 actor_id text NOT NULL REFERENCES users(id), order_id text NOT NULL UNIQUE REFERENCES billing_orders(id),
 input jsonb NOT NULL, base_revision integer NOT NULL, site_revision bigint NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed','review')),
 error text, lease_until timestamptz, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
);
CREATE UNIQUE INDEX website_builder_one_active ON website_builder_jobs(site_id) WHERE status IN ('queued','running');
CREATE INDEX website_builder_dispatch ON website_builder_jobs(status,created_at);
