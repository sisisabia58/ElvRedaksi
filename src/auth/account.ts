import type { Sql } from "../db/client";
import { hashPassword, verifyPassword } from "./password";

export async function changeOwnPassword(
  sql: Sql,
  userId: string,
  input: { current: string; next: string; confirm: string },
): Promise<void> {
  const current = input.current;
  const next = input.next;
  if (!current) {
    throw new Error("Password saat ini wajib diisi");
  }
  if (next.length < 8) {
    throw new Error("Password baru minimal 8 karakter");
  }
  if (next !== input.confirm) {
    throw new Error("Ulangi password baru tidak sama");
  }
  const rows = await sql.rows<{ password_hash: string }>(
    "select password_hash from users where id = $1",
    [userId],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(current, user.password_hash))) {
    throw new Error("Password saat ini salah");
  }
  const passwordHash = await hashPassword(next);
  await sql.rows("update users set password_hash = $1 where id = $2", [passwordHash, userId]);
}
