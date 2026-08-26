// Identidade visual de cada portal (evento). É a fonte única da marca: nome, cor
// e logo. Neutro de propósito (sem "use client") — a tela de seleção é um Server
// Component e o cabeçalho é cliente; os dois leem daqui.
//
// A logo de um evento é um arquivo estático em public/marcas/<id>.svg. Enquanto o
// arquivo não existe, o portal fica com `logo: null` e cai no monograma colorido:
// nenhuma marca é redesenhada ou imitada aqui — ou é o arquivo oficial, ou é a
// sigla. Para ativar a logo de um evento, basta soltar o SVG em public/marcas/ e
// apontar `logo` (e `logoRatio`, a proporção do desenho) para ele.
// O portal do CNHF (Curso Nacional de Formação em Holding Familiar) saiu do ar
// em 10/08/2026, a pedido do Marcio: o time não trabalhava por ele e a tela só
// pesava. Foi removida a SUPERFÍCIE — seleção de portal, whitelist e navegação.
// Os dados e os jobs que alimentam os contatos do CNHF continuam intactos: são
// 12.228 contatos, quase todos escritos na última semana, e a operação do evento
// depende deles. Para reviver a tela, basta devolver "curso" aqui, em
// EVENTO_DO_SLUG (app/page.tsx e app/[portal]/layout.tsx), no enum de
// UsuarioPortaisSchema e na lista de app/usuarios.
export type PortalId = "ht" | "seminario" | "hm" | "aurum" | "ethb" | "acelera";

export type Marca = {
  evento: "HT" | "SEM" | "HM" | "AURUM" | "ETHB" | "ACELERA";
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
  aurum: {
    evento: "AURUM",
    nome: "Aurum",
    sigla: "AUR",
    cor: "#CA8A04", // amarelo-ouro (yellow-600)
    desc: "Aurum — o nível premium dos alunos: comercial, reunião e ativação da jornada de ponta.",
    gradiente: "from-yellow-600 to-amber-400",
    // 13/08: a marca chegou. O PNG original tinha 3786x1008 e **4,4 MB** — 120x
    // as outras marcas (HM 37 KB, HT 63 KB) — e o <Image> aqui roda com
    // `unoptimized`, ou seja, o arquivo inteiro ia para o browser em TODA página.
    // Reamostrado para 600x160 (3x o maior uso, que é h-10) e ficou em 57 KB.
    logo: "/marcas/aurum.png",
    logoRatio: [600, 160],
    // Sem `logoNegativa`: diferente do HM e do HT, esta arte já traz o próprio
    // fundo dourado — não precisa (nem deve ganhar) o bloco escuro por trás.
  },
  ethb: {
    evento: "ETHB",
    nome: "ETHB",
    sigla: "ETHB",
    cor: "#0D9488", // teal-600
    desc: "ETHB — Time Holding Brasil: comercial, renovação e liberação de acesso dos alunos.",
    gradiente: "from-teal-600 to-emerald-400",
    logo: null, // → public/marcas/ethb.svg (enquanto não houver, cai no monograma "ETHB")
    logoRatio: null,
  },
  // Acelera Holding (0307, 26/08/2026): venda do Curso Nacional. Portal SÓ
  // COMERCIAL — o evento não tem estágio na aba 'ativacao', então a esteira de
  // ativação não tem onde aparecer. A logo oficial ainda não chegou; até lá cai
  // no monograma, que é a regra da casa: ou é o arquivo oficial, ou é a sigla.
  acelera: {
    evento: "ACELERA",
    nome: "Acelera Holding",
    sigla: "AH",
    cor: "#0EA5E9", // sky-500
    desc: "Comercial do Acelera Holding — leads do Curso Nacional, contato, reunião e venda.",
    gradiente: "from-sky-500 to-cyan-400",
    logo: null, // → public/marcas/acelera.svg quando o Victor mandar
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
  // Derivado das CHAVES de PORTAIS, não de uma cascata de `if` — que era o que
  // havia aqui e custou caro em 26/08: o portal novo (`acelera`) não tinha um
  // `if` próprio, caía no `return "ht"` do fim e TODAS as telas de /acelera/*
  // se identificavam como Holding Total (marca, cor e, pior, o evento usado nas
  // consultas). O default silencioso escondeu o erro: em vez de quebrar, a tela
  // mostrava dados de outro evento. Agora um portal registrado em PORTAIS já
  // vale aqui, e portal novo não precisa lembrar de tocar nesta função.
  const seg = (pathname || "").split("/").filter(Boolean)[0];
  return (seg && seg in PORTAIS) ? (seg as PortalId) : "ht";
}
