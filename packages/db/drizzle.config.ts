import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/*.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://educlip_user:educlip_pass@localhost:5432/educlip_db',
  },
  verbose: true,
  strict: true,
});
