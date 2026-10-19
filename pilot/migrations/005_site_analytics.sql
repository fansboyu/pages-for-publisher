CREATE TABLE IF NOT EXISTS site_analytics_daily (
 site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 visit_date date NOT NULL,
 pageviews bigint NOT NULL DEFAULT 0,
 unique_visitors bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(site_id,visit_date)
);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS analytics_domains text[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS site_analytics_pages_daily (
 site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 visit_date date NOT NULL,
 host text NOT NULL,
 page_path text NOT NULL,
 source text NOT NULL,
 device text NOT NULL,
 pageviews bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(site_id,visit_date,host,page_path,source,device)
);
CREATE INDEX IF NOT EXISTS site_analytics_pages_lookup ON site_analytics_pages_daily(site_id,visit_date,pageviews DESC);
CREATE TABLE IF NOT EXISTS site_analytics_visitors (
 site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 visit_date date NOT NULL,
 visitor_hash text NOT NULL,
 PRIMARY KEY(site_id,visit_date,visitor_hash)
);
CREATE INDEX IF NOT EXISTS site_analytics_visitors_range ON site_analytics_visitors(site_id,visit_date);
