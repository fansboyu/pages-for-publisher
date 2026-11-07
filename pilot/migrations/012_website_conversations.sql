CREATE TABLE website_builder_messages (
 id bigserial PRIMARY KEY,
 site_id text NOT NULL REFERENCES sites(id),
 job_id text REFERENCES website_builder_jobs(id),
 role text NOT NULL CHECK(role IN ('user','assistant')),
 content text NOT NULL,
 target text NOT NULL DEFAULT 'all',
 base_revision integer NOT NULL,
 result_revision integer,
 changes jsonb NOT NULL DEFAULT '[]',
 actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX website_builder_messages_site ON website_builder_messages(site_id,id DESC);
