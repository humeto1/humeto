CREATE TABLE company_announcements (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),author_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL,body TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('all','staff','students','selected')),
 popup BOOLEAN NOT NULL DEFAULT FALSE,image TEXT NOT NULL DEFAULT '',cta_label TEXT NOT NULL DEFAULT '',cta_path TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','retracted')),
 starts_at TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,revision BIGINT NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),published_at TIMESTAMPTZ,
 CHECK(expires_at>starts_at)
);
CREATE TABLE announcement_recipients (
 announcement_id TEXT NOT NULL REFERENCES company_announcements(id) ON DELETE CASCADE,
 tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 read_at TIMESTAMPTZ,popup_dismissed_at TIMESTAMPTZ,PRIMARY KEY(announcement_id,user_id)
);
CREATE INDEX announcement_recipient_inbox ON announcement_recipients(tenant_id,user_id);
