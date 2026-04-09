/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  experimental: {
    serverActions: { bodySizeLimit: '10mb' }
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Connection', value: 'keep-alive' }
        ]
      }
    ];
  }
};

module.exports = nextConfig;
