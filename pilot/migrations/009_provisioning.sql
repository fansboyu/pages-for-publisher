CREATE TABLE provisioning_jobs(
 id text PRIMARY KEY,actor_id text NOT NULL REFERENCES users(id),request_key text NOT NULL,name text NOT NULL,
 host text NOT NULL,port integer NOT NULL CHECK(port BETWEEN 1 AND 65535),username text NOT NULL,fingerprint text NOT NULL,
 status text NOT NULL CHECK(status IN ('checking','ready','blocked','uploading','installing','verifying','succeeded','failed','expired','interrupted')),
 report jsonb,events jsonb NOT NULL DEFAULT '[]',error text,server_id text REFERENCES servers(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),install_started_at timestamptz,
 UNIQUE(actor_id,request_key)
);
CREATE UNIQUE INDEX provisioning_active_host ON provisioning_jobs(host) WHERE status IN ('checking','ready','uploading','installing','verifying');
