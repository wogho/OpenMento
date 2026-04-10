import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://openmento_user:openmento_pass@localhost:5432/openmento_db',
  },
  verbose: true,
  strict: true,
});
