import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // Mitigasi: test yang membangun modul Nest (health) pernah sekali kena
    // timeout 5 detik saat beban mesin tinggi; penyebab pastinya belum ketemu.
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      // File yang butuh Postgres dicakup oleh `bun run test:int`, bukan oleh
      // unit test, jadi tidak ikut dihitung di sini (verify tidak butuh DB).
      exclude: [
        '**/*.schema.ts',
        '**/*.repository.ts',
        '**/*.int.spec.ts',
        'src/database/seeds/seed.ts',
        'src/database/seeds/superadmin.seed.ts',
        'test/**',
      ],
      // Ratchet: jangan diturunkan. Naikkan bila coverage naik signifikan.
      thresholds: { lines: 88, branches: 65, functions: 77, statements: 88 },
    },
  },
});
