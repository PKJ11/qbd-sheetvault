-- QbD SheetVault schema (idempotent)

CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  employee_id           TEXT NOT NULL,
  full_name             TEXT NOT NULL,
  email                 TEXT NOT NULL,
  designation           TEXT,
  joining_date          DATE,
  roles                 TEXT[] NOT NULL DEFAULT '{}',
  department            TEXT,
  unit                  TEXT,
  section               TEXT,
  reporting_manager_id  INT REFERENCES users(id),
  justification         TEXT,
  password_hash         TEXT NOT NULL,
  must_change_password  BOOLEAN NOT NULL DEFAULT TRUE,
  password_changed_at   TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts       INT NOT NULL DEFAULT 0,
  locked_at             TIMESTAMPTZ,
  session_version       INT NOT NULL DEFAULT 1,
  last_login_at         TIMESTAMPTZ,
  created_by            INT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_employee_id_uq ON users (upper(employee_id));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email));

CREATE TABLE IF NOT EXISTS folders (
  id                  SERIAL PRIMARY KEY,
  parent_id           INT REFERENCES folders(id),
  name                TEXT NOT NULL,
  inherit_permissions BOOLEAN NOT NULL DEFAULT TRUE,
  created_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ,
  deleted_by          INT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS folders_name_uq ON folders (COALESCE(parent_id, 0), lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS files (
  id                  SERIAL PRIMARY KEY,
  folder_id           INT NOT NULL REFERENCES folders(id),
  name                TEXT NOT NULL,
  owner_id            INT NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED')),
  current_version     INT NOT NULL DEFAULT 1,
  review_cycle        INT NOT NULL DEFAULT 0,
  inherit_permissions BOOLEAN NOT NULL DEFAULT TRUE,
  size_bytes          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by          INT REFERENCES users(id),
  deleted_at          TIMESTAMPTZ,
  deleted_by          INT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS files_name_uq ON files (folder_id, lower(name)) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS file_versions (
  id          SERIAL PRIMARY KEY,
  file_id     INT NOT NULL REFERENCES files(id),
  version_no  INT NOT NULL,
  content     BYTEA NOT NULL,
  sha256      TEXT NOT NULL,
  model       JSONB NOT NULL,
  size_bytes  INT NOT NULL,
  reason      TEXT,
  created_by  INT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (file_id, version_no)
);

CREATE TABLE IF NOT EXISTS cell_changes (
  id          BIGSERIAL PRIMARY KEY,
  file_id     INT NOT NULL REFERENCES files(id),
  version_no  INT NOT NULL,
  sheet       TEXT NOT NULL,
  cell        TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  changed_by  INT NOT NULL REFERENCES users(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cell_changes_file_idx ON cell_changes (file_id, version_no);

-- Access control entries. principal_type: user | role | department | everyone
CREATE TABLE IF NOT EXISTS permissions (
  id              SERIAL PRIMARY KEY,
  resource_type   TEXT NOT NULL CHECK (resource_type IN ('folder','file')),
  resource_id     INT NOT NULL,
  principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','role','department','everyone')),
  principal_value TEXT NOT NULL DEFAULT '',
  perms           TEXT[] NOT NULL,
  granted_by      INT REFERENCES users(id),
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (resource_type, resource_id, principal_type, principal_value)
);

CREATE TABLE IF NOT EXISTS reviews (
  id               SERIAL PRIMARY KEY,
  file_id          INT NOT NULL REFERENCES files(id),
  cycle_no         INT NOT NULL,
  version_no       INT NOT NULL,
  submitted_by     INT NOT NULL REFERENCES users(id),
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  submit_comment   TEXT,
  reviewer_id      INT NOT NULL REFERENCES users(id),
  decision         TEXT CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','WITHDRAWN')),
  decided_at       TIMESTAMPTZ,
  decision_comment TEXT
);
CREATE INDEX IF NOT EXISTS reviews_file_idx ON reviews (file_id);
CREATE INDEX IF NOT EXISTS reviews_reviewer_idx ON reviews (reviewer_id) WHERE decision IS NULL;

CREATE TABLE IF NOT EXISTS annotations (
  id            SERIAL PRIMARY KEY,
  file_id       INT NOT NULL REFERENCES files(id),
  review_id     INT REFERENCES reviews(id),
  version_no    INT NOT NULL,
  sheet         TEXT,
  cell          TEXT,
  comment       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ADDRESSED','CLOSED')),
  created_by    INT NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  response      TEXT,
  responded_by  INT REFERENCES users(id),
  responded_at  TIMESTAMPTZ,
  closed_by     INT REFERENCES users(id),
  closed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS annotations_file_idx ON annotations (file_id);

-- Conversation on an annotation: reviewer comment, author responses, re-open / close notes
CREATE TABLE IF NOT EXISTS annotation_messages (
  id             SERIAL PRIMARY KEY,
  annotation_id  INT NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('COMMENT','RESPONSE','REOPEN','CLOSE')),
  text           TEXT,
  version_no     INT,
  created_by     INT NOT NULL REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS annotation_messages_idx ON annotation_messages (annotation_id);

CREATE TABLE IF NOT EXISTS access_requests (
  id              SERIAL PRIMARY KEY,
  resource_type   TEXT NOT NULL CHECK (resource_type IN ('folder','file')),
  resource_id     INT NOT NULL,
  requested_by    INT NOT NULL REFERENCES users(id),
  requested_perms TEXT[] NOT NULL,
  justification   TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by      INT REFERENCES users(id),
  decided_at      TIMESTAMPTZ,
  decision_note   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ONLYOFFICE editing sessions (check-out / check-in). One active session per file.
CREATE TABLE IF NOT EXISTS edit_sessions (
  id               SERIAL PRIMARY KEY,
  file_id          INT NOT NULL REFERENCES files(id),
  user_id          INT NOT NULL REFERENCES users(id),
  base_version     INT NOT NULL,
  doc_key          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CHECKED_IN','DISCARDED')),
  working_content  BYTEA,
  working_sha256   TEXT,
  working_saved_at TIMESTAMPTZ,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  ended_by         INT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS edit_sessions_active_uq ON edit_sessions (file_id) WHERE status = 'ACTIVE';

-- Append-only, hash-chained audit trail
CREATE TABLE IF NOT EXISTS audit_log (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL,
  user_id      INT,
  employee_id  TEXT,
  user_name    TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  entity_name  TEXT,
  details      JSONB,
  reason       TEXT,
  ip           TEXT,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS audit_ts_idx ON audit_log (ts);

CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
