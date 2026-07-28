// Identidade visual de cada portal (evento). É a fonte única da marca: nome, cor
// e logo. Neutro de propósito (sem "use client") — a tela de seleção é um Server
// Component e o cabeçalho é cliente; os dois leem daqui.
//
// A logo de um evento é um arquivo estático em public/marcas/<id>.svg. Enquanto o
// arquivo não existe, o portal fica com `logo: null` e cai no monograma colorido:
// nenhuma marca é redesenhada ou imitada aqui — ou é o arquivo oficial, ou é a
// sigla. Para ativar a logo de um evento, basta soltar o SVG em public/marcas/ e
// apontar `logo` (e `logoRatio`, a proporção do desenho) para ele.
export type PortalId = "ht" | "seminario" | "hm" | "curso" | "aurum" | "ethb";

export type Marca = {
  evento: "HT" | "SEM" | "HM" | "CNHF" | "AURUM" | "ETHB";
  nome: string;
  sigla: string;
  cor: string;
  desc: string;
  gradiente: string;
  logo: string | null;
  logoRatio: [number, number] | null;
  /** A logo tem partes brancas (versão negativa) e só se lê sobre fundo escuro. */
  logoNegativa?: boolean;
};

export const PORTAIS: Record<PortalId, Marca> = {
  ht: {
    evento: "HT",
    nome: "Holding Total",
    sigla: "HT",
    cor: "#F97316",
    desc: "Jornada dos compradores do HT — onboarding, grupo e ativação.",
    gradiente: "from-orange-500 to-amber-400",
    logo: "/marcas/ht.png", // monograma H/T — o "T" é branco
    logoRatio: [491, 540],
    logoNegativa: true,
  },
  seminario: {
    evento: "SEM",
    nome: "Seminário",
    sigla: "SEM",
    cor: "#2563EB",
    desc: "Leads do Seminário — qualificação, grupo e comercial.",
    gradiente: "from-blue-600 to-sky-400",
    logo: "/marcas/seminario.svg", // Seminário de Estruturação Patrimonial
    logoRatio: [1060, 330],
  },
  hm: {
    evento: "HM",
    nome: "Holding Masters",
    sigla: "HM",
    cor: "#B45309",
    desc: "Ativação do HM (T39) — comercial, reunião, pagamento e ativação.",
    gradiente: "from-amber-700 to-amber-500",
    logo: "/marcas/hm.png", // "HOLDING" laranja + "MASTERS" em branco
    logoRatio: [1686, 840],
    logoNegativa: true,
  },
  curso: {
    evento: "CNHF",
    nome: "Curso de Holding",
    sigla: "CNHF",
    cor: "#7C3AED",
    desc: "Curso Nacional de Formação em Holding Familiar — jornada dos inscritos, do lead à matrícula.",
    gradiente: "from-violet-600 to-purple-400",
    logo: null, // → public/marcas/curso.svg (enquanto não houver, cai no monograma "CFH")
    logoRatio: null,
  },
  aurum: {
    evento: "AURUM",
    nome: "Aurum",
    sigla: "AUR",
    cor: "#CA8A04", // amarelo-ouro (yellow-600)
    desc: "Ativação do Aurum — comercial e ativação dos alunos.",
    gradiente: "from-yellow-600 to-amber-400",
    logo: null, // → public/marcas/aurum.svg (enquanto não houver, cai no monograma "AUR")
    logoRatio: null,
  },
  ethb: {
    evento: "ETHB",
    nome: "ETHB",
    sigla: "ETHB",
    cor: "#0D9488", // teal-600
    desc: "Comercial e ativação do ETHB (Kelly + monitores + Ellen).",
    gradiente: "from-teal-600 to-emerald-400",
    logo: null, // → public/marcas/ethb.svg (enquanto não houver, cai no monograma "ETHB")
    logoRatio: null,
  },
};

// Marca da casa (login e tela de seleção). Mesma regra: sem arquivo oficial, o
// sistema se apresenta pelo monograma "CS" que já usava.
export const MARCA_CASA = {
  nome: "Grupo Participa",
  sigla: "CS",
  logo: null as string | null, // → public/marcas/participa.svg
  logoRatio: null as [number, number] | null,
};

export function portalDoPath(pathname: string | null | undefined): PortalId {
  const seg = (pathname || "").split("/").filter(Boolean)[0];
  if (seg === "seminario") return "seminario";
  if (seg === "hm") return "hm";
  if (seg === "curso") return "curso";
  if (seg === "aurum") return "aurum";
  if (seg === "ethb") return "ethb";
  return "ht";
}
