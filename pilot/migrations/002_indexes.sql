CREATE INDEX clients_agency ON clients(agency_id);
CREATE INDEX sites_client ON sites(client_id);
CREATE INDEX articles_published ON articles(site_id,status,updated_at DESC);
CREATE INDEX media_site ON media(site_id,created_at DESC);
CREATE INDEX releases_site_sequence ON releases(site_id,sequence DESC);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE INDEX audit_site ON audit_logs(site_id,created_at DESC);
