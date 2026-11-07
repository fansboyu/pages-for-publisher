ALTER TABLE geo_query_prices ADD COLUMN enabled_platforms integer[] NOT NULL DEFAULT ARRAY[1,2,3,4,5,6,8] CHECK(enabled_platforms <@ ARRAY[1,2,3,4,5,6,8]);
UPDATE geo_query_prices SET unit_cents=20,version=version+1 WHERE unit_cents=0;
