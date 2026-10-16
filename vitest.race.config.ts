import { defineConfig } from 'vitest/config'
import path from 'path'

// Real-concurrency tests (race audit 16 Oct 2026). They need a THROWAWAY Postgres with the schema pushed
// and refuse to run otherwise (src/__tests__/race/guard.ts). Not part of `npm test`:
//   RACE_DATABASE_URL=postgresql://race:race@race-db:5432/race npx vitest run -c vitest.race.config.ts
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/race/**/*.race.ts'],
    setupFiles: ['./src/__tests__/race/guard.ts'],
    // Forks, one file at a time: the files share the database, and the routes write selfies under cwd,
    // which guard.ts moves to a temp dir (process.chdir is not available in worker threads).
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
