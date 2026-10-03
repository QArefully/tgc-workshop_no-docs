import type { Migration } from '../migrate.js';

/** Adds review engagement/moderation records and trigger-maintained public rating aggregates. */
export const reviewDepthMigration: Migration = {
  version: '016',
  name: 'review depth',
  up(db) {
    db.exec(`
      CREATE TABLE review_rating_aggregates (
        product_id INTEGER PRIMARY KEY,
        published_count INTEGER NOT NULL DEFAULT 0 CHECK (typeof(published_count) = 'integer' AND published_count >= 0),
        rating_sum INTEGER NOT NULL DEFAULT 0 CHECK (typeof(rating_sum) = 'integer' AND rating_sum >= 0),
        stars_1 INTEGER NOT NULL DEFAULT 0 CHECK (typeof(stars_1) = 'integer' AND stars_1 >= 0),
        stars_2 INTEGER NOT NULL DEFAULT 0 CHECK (typeof(stars_2) = 'integer' AND stars_2 >= 0),
        stars_3 INTEGER NOT NULL DEFAULT 0 CHECK (typeof(stars_3) = 'integer' AND stars_3 >= 0),
        stars_4 INTEGER NOT NULL DEFAULT 0 CHECK (typeof(stars_4) = 'integer' AND stars_4 >= 0),
        stars_5 INTEGER NOT NULL DEFAULT 0 CHECK (typeof(stars_5) = 'integer' AND stars_5 >= 0),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (published_count = stars_1 + stars_2 + stars_3 + stars_4 + stars_5),
        CHECK (rating_sum = stars_1 + 2 * stars_2 + 3 * stars_3 + 4 * stars_4 + 5 * stars_5),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      );

      CREATE TABLE review_helpful_votes (
        review_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (review_id, user_id),
        FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX review_helpful_votes_review_id_idx ON review_helpful_votes(review_id);

      CREATE TABLE review_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('spam', 'harassment', 'unsafe', 'off_topic', 'other')),
        detail TEXT CHECK (detail IS NULL OR (detail = trim(detail) AND length(detail) BETWEEN 1 AND 1000)),
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'withdrawn', 'dismissed', 'actioned')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        resolved_by_user_id INTEGER,
        CHECK (
          (status = 'open' AND resolved_at IS NULL AND resolved_by_user_id IS NULL) OR
          (status = 'withdrawn' AND resolved_at IS NOT NULL AND resolved_by_user_id IS NULL) OR
          (status IN ('dismissed', 'actioned') AND resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL)
        ),
        UNIQUE (review_id, user_id),
        FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (resolved_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
      );
      CREATE INDEX review_reports_open_created_at_id_idx ON review_reports(status, created_at, id);
      CREATE INDEX review_reports_review_status_idx ON review_reports(review_id, status);
      CREATE INDEX review_reports_user_status_idx ON review_reports(user_id, status);

      INSERT INTO review_rating_aggregates
        (product_id, published_count, rating_sum, stars_1, stars_2, stars_3, stars_4, stars_5)
      SELECT product_id,
             COUNT(*),
             SUM(rating),
             SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END),
             SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END),
             SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END),
             SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END),
             SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END)
      FROM reviews
      WHERE status = 'published'
      GROUP BY product_id;

      CREATE TRIGGER reviews_aggregate_after_insert
      AFTER INSERT ON reviews WHEN NEW.status = 'published'
      BEGIN
        INSERT INTO review_rating_aggregates (product_id) VALUES (NEW.product_id)
          ON CONFLICT(product_id) DO NOTHING;
        UPDATE review_rating_aggregates
        SET published_count = published_count + 1,
            rating_sum = rating_sum + NEW.rating,
            stars_1 = stars_1 + CASE WHEN NEW.rating = 1 THEN 1 ELSE 0 END,
            stars_2 = stars_2 + CASE WHEN NEW.rating = 2 THEN 1 ELSE 0 END,
            stars_3 = stars_3 + CASE WHEN NEW.rating = 3 THEN 1 ELSE 0 END,
            stars_4 = stars_4 + CASE WHEN NEW.rating = 4 THEN 1 ELSE 0 END,
            stars_5 = stars_5 + CASE WHEN NEW.rating = 5 THEN 1 ELSE 0 END,
            updated_at = datetime('now')
        WHERE product_id = NEW.product_id;
      END;

      CREATE TRIGGER reviews_aggregate_after_delete
      AFTER DELETE ON reviews WHEN OLD.status = 'published'
      BEGIN
        UPDATE review_rating_aggregates
        SET published_count = published_count - 1,
            rating_sum = rating_sum - OLD.rating,
            stars_1 = stars_1 - CASE WHEN OLD.rating = 1 THEN 1 ELSE 0 END,
            stars_2 = stars_2 - CASE WHEN OLD.rating = 2 THEN 1 ELSE 0 END,
            stars_3 = stars_3 - CASE WHEN OLD.rating = 3 THEN 1 ELSE 0 END,
            stars_4 = stars_4 - CASE WHEN OLD.rating = 4 THEN 1 ELSE 0 END,
            stars_5 = stars_5 - CASE WHEN OLD.rating = 5 THEN 1 ELSE 0 END,
            updated_at = datetime('now')
        WHERE product_id = OLD.product_id;
      END;

      CREATE TRIGGER reviews_aggregate_after_update
      AFTER UPDATE OF product_id, rating, status ON reviews
      BEGIN
        INSERT INTO review_rating_aggregates (product_id)
          SELECT NEW.product_id WHERE NEW.status = 'published'
          ON CONFLICT(product_id) DO NOTHING;
        UPDATE review_rating_aggregates
        SET published_count = published_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END,
            rating_sum = rating_sum - CASE WHEN OLD.status = 'published' THEN OLD.rating ELSE 0 END,
            stars_1 = stars_1 - CASE WHEN OLD.status = 'published' AND OLD.rating = 1 THEN 1 ELSE 0 END,
            stars_2 = stars_2 - CASE WHEN OLD.status = 'published' AND OLD.rating = 2 THEN 1 ELSE 0 END,
            stars_3 = stars_3 - CASE WHEN OLD.status = 'published' AND OLD.rating = 3 THEN 1 ELSE 0 END,
            stars_4 = stars_4 - CASE WHEN OLD.status = 'published' AND OLD.rating = 4 THEN 1 ELSE 0 END,
            stars_5 = stars_5 - CASE WHEN OLD.status = 'published' AND OLD.rating = 5 THEN 1 ELSE 0 END,
            updated_at = datetime('now')
        WHERE product_id = OLD.product_id;
        UPDATE review_rating_aggregates
        SET published_count = published_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END,
            rating_sum = rating_sum + CASE WHEN NEW.status = 'published' THEN NEW.rating ELSE 0 END,
            stars_1 = stars_1 + CASE WHEN NEW.status = 'published' AND NEW.rating = 1 THEN 1 ELSE 0 END,
            stars_2 = stars_2 + CASE WHEN NEW.status = 'published' AND NEW.rating = 2 THEN 1 ELSE 0 END,
            stars_3 = stars_3 + CASE WHEN NEW.status = 'published' AND NEW.rating = 3 THEN 1 ELSE 0 END,
            stars_4 = stars_4 + CASE WHEN NEW.status = 'published' AND NEW.rating = 4 THEN 1 ELSE 0 END,
            stars_5 = stars_5 + CASE WHEN NEW.status = 'published' AND NEW.rating = 5 THEN 1 ELSE 0 END,
            updated_at = datetime('now')
        WHERE product_id = NEW.product_id;
      END;
    `);
  },
};
