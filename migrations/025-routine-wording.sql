CREATE TABLE routine_wording (
 series_id TEXT PRIMARY KEY REFERENCES task_recurrences(id) ON DELETE CASCADE,
 canonical_title TEXT NOT NULL,variants JSONB NOT NULL DEFAULT '[]',enabled BOOLEAN NOT NULL DEFAULT FALSE,
 reviewed_by TEXT NOT NULL REFERENCES users(id),revision BIGINT NOT NULL DEFAULT 1,updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE routine_wording_proposals (
 id TEXT PRIMARY KEY,series_id TEXT NOT NULL REFERENCES task_recurrences(id) ON DELETE CASCADE,
 canonical_title TEXT NOT NULL,variants JSONB NOT NULL DEFAULT '[]',created_by TEXT NOT NULL REFERENCES users(id),created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE task_occurrences ADD COLUMN canonical_title TEXT NOT NULL DEFAULT '';
ALTER TABLE task_occurrences ADD COLUMN display_title TEXT NOT NULL DEFAULT '';
ALTER TABLE task_occurrences ADD COLUMN wording_revision BIGINT;
