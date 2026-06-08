/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pg é dependência só-servidor; não deve ser bundlada no client.
    serverComponentsExternalPackages: ["pg"],
  },
};

export default nextConfig;
