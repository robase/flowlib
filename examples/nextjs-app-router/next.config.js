/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Externalise native / WASM database drivers and the workspace-linked
  // server packages so Next doesn't try to bundle them. Turbopack honours
  // this list for both dev and build, including subpath imports such as
  // `@flowlib/core/types`.
  serverExternalPackages: [
    '@flowlib/core',
    '@flowlib/nextjs',
    '@libsql/client',
    'libsql',
    'better-sqlite3',
    'fsevents',
    'chokidar',
  ],
};

export default nextConfig;
