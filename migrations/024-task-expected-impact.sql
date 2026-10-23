ALTER TABLE tasks ADD COLUMN value_type TEXT NOT NULL DEFAULT 'none' CHECK(value_type IN ('none','profit','avoid_loss'));
ALTER TABLE tasks ADD COLUMN value_minor BIGINT CHECK(value_minor IS NULL OR value_minor BETWEEN 0 AND 99999999999);
ALTER TABLE tasks ADD COLUMN value_currency TEXT NOT NULL DEFAULT 'PKR' CHECK(value_currency ~ '^[A-Z]{3}$');
ALTER TABLE tasks ADD COLUMN value_note TEXT NOT NULL DEFAULT '' CHECK(length(value_note)<=300);
