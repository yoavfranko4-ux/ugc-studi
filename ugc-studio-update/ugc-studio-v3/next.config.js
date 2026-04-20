/** @type {import('next').NextConfig} */
// Next.js 15:
//  - `experimental.serverComponentsExternalPackages` moved to top-level `serverExternalPackages`.
//  - The top-level `api` key (bodyParser / responseLimit) is no longer recognized here;
//    App Router routes configure their own runtime/maxDuration via per-route exports
//    (e.g. `export const maxDuration = 300`). Large request bodies are controlled via
//    `experimental.serverActions.bodySizeLimit` for Server Actions, and route handlers
//    stream request bodies by default.
const nextConfig = {
  images: { unoptimized: true },
  serverExternalPackages: ['ffmpeg-static'],
  experimental: {
    serverActions: { bodySizeLimit: '100mb' },
  },
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Connection', value: 'keep-alive' }] }];
  }
};

module.exports = nextConfig;
