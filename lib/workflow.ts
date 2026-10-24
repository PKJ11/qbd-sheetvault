import "server-only";
import { USER_COLUMNS, type User } from "./auth";
import { q, type Db } from "./db";
import type { FileRow } from "./files";
import type { Acl } from "./permissions";

/** Active users who may review this file (have Review permission), excluding the given user ids. */
export async function eligibleReviewers(acl: Acl, file: FileRow, exclude: number[], db?: Db) {
  const users = await q<User>(`SELECT ${USER_COLUMNS} FROM users WHERE is_active AND locked_at IS NULL ORDER BY full_name`, [], db);
  await acl.loadFileAces([file.id], db);
  return users.filter((x) => !exclude.includes(x.id) && acl.filePerms(x, file).has("review"));
}
