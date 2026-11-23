import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      // Ratchet: jangan diturunkan. Naikkan bila coverage naik signifikan.
      thresholds: { lines: 80, branches: 50, functions: 55, statements: 78 },
    },
  },
});
