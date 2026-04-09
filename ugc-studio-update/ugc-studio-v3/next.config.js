/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: '100mb' } },
  api: { bodyParser: { sizeLimit: '100mb' }, responseLimit: '100mb' }
};
module.exports = nextConfig;
