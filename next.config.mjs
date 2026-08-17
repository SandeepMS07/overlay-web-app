/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces .next/standalone with a self-contained server.js, which Electron
  // boots as a child process in the packaged app.
  output: 'standalone',
  reactStrictMode: true,
  images: { unoptimized: true },
  // Electron loads the dev server over 127.0.0.1; without this Next 16 treats
  // its own chunks and HMR socket as cross-origin and blocks them.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
