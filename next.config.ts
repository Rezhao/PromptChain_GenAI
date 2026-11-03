import type { NextConfig } from 'next'

const config: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Cache-Control', value: 'private, no-store' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'same-origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
    ] }]
  },
}
export default config
