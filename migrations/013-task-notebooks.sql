CREATE TABLE task_notebooks (
 id TEXT PRIMARY KEY,tenant_id TEXT NOT NULL REFERENCES tenants(id),user_id TEXT NOT NULL REFERENCES users(id),
 original_name TEXT NOT NULL,stored_name TEXT NOT NULL,mime_type TEXT NOT NULL,source_sha256 TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TIMESTAMPTZ,error TEXT NOT NULL DEFAULT '',
 warnings JSONB NOT NULL DEFAULT '[]',revision BIGINT NOT NULL DEFAULT 1,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX task_notebooks_member ON task_notebooks(tenant_id,user_id,created_at);
CREATE TABLE task_notebook_lines (
 id TEXT PRIMARY KEY,notebook_id TEXT NOT NULL REFERENCES task_notebooks(id) ON DELETE CASCADE,
 line_index INTEGER NOT NULL,source_text TEXT NOT NULL,box JSONB NOT NULL,confidence REAL,completion_hint BOOLEAN NOT NULL DEFAULT FALSE,
 task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,action TEXT CHECK(action IN ('created','completed')),reviewed_title TEXT,applied_at TIMESTAMPTZ,
 UNIQUE(notebook_id,line_index)
);
CREATE TABLE task_notebook_pages (
 notebook_id TEXT PRIMARY KEY REFERENCES task_notebooks(id) ON DELETE CASCADE,
 width REAL NOT NULL,height REAL NOT NULL,preview_name TEXT NOT NULL,method TEXT NOT NULL
);
