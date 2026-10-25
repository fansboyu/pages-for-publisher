ALTER TABLE servers ADD COLUMN ip_address text NOT NULL DEFAULT '';

UPDATE servers s
SET ip_address = p.host
FROM (
  SELECT DISTINCT ON (server_id) server_id, host
  FROM provisioning_jobs
  WHERE server_id IS NOT NULL
  ORDER BY server_id, updated_at DESC
) p
WHERE p.server_id = s.id AND s.ip_address = '';
