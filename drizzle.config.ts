import { defineConfig } from 'drizzle-kit';
import { buildPoolConfig } from './src/database/database.options.js';

const { host, port, user, password, database, ssl } = buildPoolConfig();

// Tabel didefinisikan di `*.schema.ts` di dalam folder modul fiturnya.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/**/*.schema.ts',
  out: './src/database/migrations',
  dbCredentials: {
    host: host ?? 'localhost',
    port,
    user,
    password: typeof password === 'string' ? password : undefined,
    database: database ?? 'backend_starter',
    ssl: ssl ? 'require' : false,
  },
});
