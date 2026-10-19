ALTER TABLE sites ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT '';
ALTER TABLE sites ADD COLUMN IF NOT EXISTS target_keywords text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS client_knowledge (
 id text PRIMARY KEY,
 client_id text NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
 category text NOT NULL DEFAULT '企业资料',
 title text NOT NULL,
 content text NOT NULL,
 terms text[] NOT NULL DEFAULT '{}',
 updated_by text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_knowledge_lookup ON client_knowledge(client_id,category);
CREATE TABLE IF NOT EXISTS alert_deliveries (
 fingerprint text PRIMARY KEY,
 last_sent_at timestamptz NOT NULL DEFAULT now()
);
