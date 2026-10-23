ALTER TABLE tasks ADD COLUMN category TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 60);
