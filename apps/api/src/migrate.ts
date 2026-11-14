/** `npm run migrate -w @dokonim/api` — applies pending migrations to DATABASE_URL and exits. */
import { migrate } from '@dokonim/db';
import { createPgDatabase } from '@dokonim/db/pg';

const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('DATABASE_URL must be set to a postgres:// connection string');
  process.exit(1);
}
const db = createPgDatabase(url, 1);
try {
  const applied = await migrate(db);
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'database is up to date');
} catch (e) {
  console.error(`migration failed: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
