/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pg é dependência só-servidor; não deve ser bundlada no client.
    serverComponentsExternalPackages: ["pg"],
  },
  async headers() {
    return [
      {
        // HTML/documentos: NUNCA cachear de forma "stale". Sem isto, o Next
        // marca páginas estáticas com s-maxage=1ano e o CDN da Hostinger (hcdn)
        // — que não invalida no deploy — serve HTML antigo apontando para chunks
        // JS/CSS que já não existem → ChunkLoadError / "Application error".
        // Os assets com hash (/_next/static/*) ficam fora deste matcher e seguem
        // imutáveis (cacheáveis para sempre), que é o comportamento correto.
        source: "/((?!_next/static|_next/image|favicon.ico).*)",
        headers: [
          { key: "Cache-Control", value: "no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
