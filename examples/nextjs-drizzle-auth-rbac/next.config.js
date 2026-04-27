/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  transpilePackages: [
    '@flowlib/core',
    '@flowlib/sdk',
    '@flowlib/ui',
    '@flowlib/nextjs',
    '@flowlib/user-auth',
    '@flowlib/rbac',
  ],
  serverExternalPackages: ['pg', 'better-auth', 'drizzle-orm'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push({
        fsevents: 'commonjs fsevents',
        chokidar: 'commonjs chokidar',
      });
    }
    return config;
  },
};

export default nextConfig;
