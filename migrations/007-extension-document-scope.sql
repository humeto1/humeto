-- Existing fact-only pairings must never gain document download access implicitly.
ALTER TABLE assist_tokens ADD COLUMN allow_documents BOOLEAN NOT NULL DEFAULT false;
