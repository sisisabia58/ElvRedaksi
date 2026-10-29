export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getAppSql } = await import("./src/auth/app-sql");
    const { boot } = await import("./src/db/boot");
    const sql = await getAppSql();
    await boot(sql);
  }
}
