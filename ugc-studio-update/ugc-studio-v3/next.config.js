/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: '100mb' } },
  api: { bodyParser: { sizeLimit: '100mb' }, responseLimit: '100mb' },
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Connection', value: 'keep-alive' }] }];
  }
};

module.exports = nextConfig;
