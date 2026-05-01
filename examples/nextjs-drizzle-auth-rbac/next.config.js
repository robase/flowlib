/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  transpilePackages: [
    '@flowlib/core',
    '@flowlib/sdk',
    '@flowlib/ui',
    '@flowlib/nextjs',
    '@flowlib/user-auth',
    '@flowlib/rbac',
  ],
  serverExternalPackages: ['pg', 'better-auth', 'drizzle-orm', 'fsevents', 'chokidar'],
};

export default nextConfig;
