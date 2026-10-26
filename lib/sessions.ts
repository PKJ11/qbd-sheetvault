import "server-only";
import { one, type Db } from "./db";

export interface EditSession {
  id: number;
  file_id: number;
  user_id: number;
  base_version: number;
  doc_key: string;
  status: "ACTIVE" | "CHECKED_IN" | "DISCARDED";
  working_sha256: string | null;
  working_saved_at: Date | null;
  started_at: Date;
  user_name?: string;
  employee_id?: string;
}

const COLS = `s.id, s.file_id, s.user_id, s.base_version, s.doc_key, s.status, s.working_sha256, s.working_saved_at, s.started_at,
              u.full_name AS user_name, u.employee_id`;

export async function activeSession(fileId: number, db?: Db, forUpdate = false): Promise<EditSession | null> {
  return one<EditSession>(
    `SELECT ${COLS} FROM edit_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.file_id = $1 AND s.status = 'ACTIVE'${forUpdate ? " FOR UPDATE OF s" : ""}`,
    [fileId],
    db,
  );
}

export async function sessionById(id: number, db?: Db): Promise<EditSession | null> {
  return one<EditSession>(`SELECT ${COLS} FROM edit_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1`, [id], db);
}
