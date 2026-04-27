import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  // bundle: true,
  unbundle: true,
  deps: {
    neverBundle: [
      '@flowlib/core',
      '@nestjs/common',
      '@nestjs/core',
      '@nestjs/schedule',
      'reflect-metadata',
      'rxjs',
      'class-validator',
      'class-transformer',
    ],
  },
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.cjs' : '.js',
    };
  },
  esbuildOptions(options) {
    options.banner = {
      js: '"use strict";',
    };
  },
});
