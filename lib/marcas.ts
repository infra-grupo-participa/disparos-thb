// Identidade visual de cada portal (evento). É a fonte única da marca: nome, cor
// e logo. Neutro de propósito (sem "use client") — a tela de seleção é um Server
// Component e o cabeçalho é cliente; os dois leem daqui.
//
// A logo de um evento é um arquivo estático em public/marcas/<id>.svg. Enquanto o
// arquivo não existe, o portal fica com `logo: null` e cai no monograma colorido:
// nenhuma marca é redesenhada ou imitada aqui — ou é o arquivo oficial, ou é a
// sigla. Para ativar a logo de um evento, basta soltar o SVG em public/marcas/ e
// apontar `logo` (e `logoRatio`, a proporção do desenho) para ele.
export type PortalId = "ht" | "seminario" | "hm";

export type Marca = {
  evento: "HT" | "SEM" | "HM";
  nome: string;
  sigla: string;
  cor: string;
  desc: string;
  gradiente: string;
  logo: string | null;
  logoRatio: [number, number] | null;
};

export const PORTAIS: Record<PortalId, Marca> = {
  ht: {
    evento: "HT",
    nome: "Holding Total",
    sigla: "HT",
    cor: "#F97316",
    desc: "Jornada dos compradores do HT — onboarding, grupo e ativação.",
    gradiente: "from-orange-500 to-amber-400",
    logo: null, // aguardando o SVG oficial → public/marcas/ht.svg
    logoRatio: null,
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
    logo: null, // aguardando o SVG oficial → public/marcas/hm.svg
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
  return "ht";
}
