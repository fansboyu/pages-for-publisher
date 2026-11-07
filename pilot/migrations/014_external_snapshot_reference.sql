-- External submissions retain an immutable copy even if the source article is removed.
ALTER TABLE external_publish_quotes DROP CONSTRAINT external_publish_quotes_article_id_fkey;
ALTER TABLE external_publish_quotes ALTER COLUMN article_id DROP NOT NULL;
ALTER TABLE external_publish_quotes ADD CONSTRAINT external_publish_quotes_article_id_fkey FOREIGN KEY(article_id) REFERENCES articles(id) ON DELETE SET NULL;
