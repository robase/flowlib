import { resolve } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';

/**
 * Vite plugin that extracts inlined base64 font data URIs from the CSS output
 * and replaces them with references to separate font files in dist/fonts/.
 * Necessary because Vite lib mode always inlines assets regardless of assetsInlineLimit.
 */
function extractInlinedFonts(): Plugin {
  return {
    name: 'extract-inlined-fonts',
    closeBundle() {
      const distDir = resolve(__dirname, 'dist');
      const fontsDir = resolve(distDir, 'fonts');
      const cssPath = resolve(distDir, 'index.css');

      // If the bundle failed to produce CSS, bail so the real error is visible
      // instead of being masked by an ENOENT here.
      if (!existsSync(cssPath)) {
        return;
      }

      // Copy font files to dist/fonts/
      const srcFontsDir = resolve(__dirname, 'src/assets/fonts');
      mkdirSync(fontsDir, { recursive: true });
      for (const file of readdirSync(srcFontsDir)) {
        if (file.endsWith('.woff2')) {
          copyFileSync(resolve(srcFontsDir, file), resolve(fontsDir, file));
        }
      }

      // Replace base64 data URIs with relative file references
      let css = readFileSync(cssPath, 'utf-8');
      for (const file of readdirSync(fontsDir)) {
        // oxlint-disable-next-line security/detect-non-literal-fs-filename -- iterating font files from known build directory
        const fontData = readFileSync(resolve(srcFontsDir, file));
        const base64 = fontData.toString('base64');
        // Match the data URI for this font (woff2 mime type)
        const dataUri = `url(data:font/woff2;base64,${base64})`;
        if (css.includes(dataUri)) {
          css = css.replace(dataUri, `url(./fonts/${file})`);
        } else {
          // Try application/font-woff2 mime type
          const altDataUri = `url(data:application/font-woff2;base64,${base64})`;
          if (css.includes(altDataUri)) {
            css = css.replace(altDataUri, `url(./fonts/${file})`);
          }
        }
      }

      writeFileSync(cssPath, css);
    },
  };
}

const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'use-sync-external-store',
  'use-sync-external-store/shim',
  'use-sync-external-store/shim/with-selector',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-select',
  '@radix-ui/react-separator',
  '@radix-ui/react-slot',
  '@radix-ui/react-tooltip',
  '@radix-ui/react-dialog',
  '@xyflow/react',
  '@tanstack/react-query',
  'clsx',
  'class-variance-authority',
  'tailwind-merge',
  'lucide-react',
  'react-router',
  'react-router-dom',
  'node:module',
  'perf_hooks',
  'crypto',
  'stream',
  'path',
  'util',
  'fs',
  'os',
  'better-sqlite3',
  'mysql2',
  'postgres',
  'pg',
];

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    dts({
      tsconfigPath: resolve(__dirname, 'tsconfig.json'),
      entryRoot: 'src',
      outDir: 'dist',
      insertTypesEntry: true,
      copyDtsFiles: true,
      exclude: ['src/**/*.test.*', 'src/**/*.spec.*'],
    }),
    extractInlinedFonts(),
  ],
  resolve: {
    tsconfigPaths: true,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    conditions: ['browser', 'import', 'module', 'default'],
  },
  build: {
    copyPublicDir: false,
    sourcemap: mode !== 'development',
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        demo: resolve(__dirname, 'src/demo/index.ts'),
        'flow-canvas': resolve(__dirname, 'src/flow-canvas/index.ts'),
      },
      formats: ['es'],
      fileName: (format, entryName) => `${entryName}.js`,
      cssFileName: 'index',
    },
    rolldownOptions: {
      external,
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') {
          return;
        }

        if (
          warning.code === 'CIRCULAR_DEPENDENCY' &&
          (warning.message.includes('d3') || warning.message.includes('zod'))
        ) {
          return;
        }

        if (warning.code === 'EMPTY_IMPORT_META') {
          return;
        }

        warn(warning);
      },
      output: {
        banner: '"use client";',
      },
    },
  },
}));
