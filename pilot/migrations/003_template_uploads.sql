ALTER TABLE templates ADD COLUMN IF NOT EXISTS archive_key text;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS upload_bytes bigint;
ALTER TABLE templates ADD COLUMN IF NOT EXISTS report jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS draft_previews (
 id text PRIMARY KEY,site_id text NOT NULL REFERENCES sites(id),created_by text NOT NULL REFERENCES users(id),
 source_path text NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX IF NOT EXISTS draft_previews_expiry ON draft_previews(expires_at);
