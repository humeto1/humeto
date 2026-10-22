ALTER TABLE tenants ALTER COLUMN industry SET DEFAULT 'education';
ALTER TABLE access_vouchers DROP CONSTRAINT access_vouchers_audience_check;
ALTER TABLE access_vouchers ADD CONSTRAINT access_vouchers_audience_check CHECK(audience IN ('any','education','immigration','lawyer','travel','custom','individual','consultant','agency'));
-- Keep legacy combined classifications until an administrator explicitly selects a category.
