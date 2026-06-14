/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // pg é dependência só-servidor; não deve ser bundlada no client.
    serverComponentsExternalPackages: ["pg"],
  },
  // URLs antigas (sem portal) → portal HT, para não quebrar links/bookmarks
  // anteriores à separação em /ht/* e /seminario/*.
  async redirects() {
    return [
      { source: "/kanban", destination: "/ht/kanban", permanent: false },
      { source: "/contatos", destination: "/ht/contatos", permanent: false },
      { source: "/contatos/:id", destination: "/ht/contatos/:id", permanent: false },
      { source: "/inbox", destination: "/ht/inbox", permanent: false },
      { source: "/dashboard", destination: "/ht/dashboard", permanent: false },
      { source: "/templates", destination: "/ht/templates", permanent: false },
    ];
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
