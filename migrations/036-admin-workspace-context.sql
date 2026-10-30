-- A platform administrator can use their own tenant as its owner without changing membership roles.
ALTER TABLE sessions ADD COLUMN context TEXT NOT NULL DEFAULT 'platform' CHECK(context IN ('platform','workspace'));
