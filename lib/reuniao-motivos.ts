// Fonte ÚNICA das 5 categorias do motivo de "não prometeu pagar" na reunião
// (0307/0308) — consumida por lib/validators.ts (o z.enum), lib/services/hm.ts
// (a nota da timeline) e pelo frontend (o select do modal, a ficha e o
// rótulo do card). Espelho EXATO de lib/cancelamento-motivos.ts — mesmo
// motivo de existir: sem fonte única, o servidor grava uma frase na
// timeline e a tela mostra outra, para sempre (achado do fable-orchestrator
// na 0306).
//
// Módulo PURO — sem "use client", sem import de React, sem I/O, sem "server-
// only", sem dependência de pg/env. Importável tanto do cliente (componentes
// do board/ficha) quanto do servidor (rotas, services), sem puxar nada além
// deste arquivo.
export const MOTIVOS_REUNIAO_HM = [
  "quer_parcelar", "vai_ver_contrato", "sem_condicao_agora", "indeciso", "outro",
] as const;
export type MotivoReuniaoHm = (typeof MOTIVOS_REUNIAO_HM)[number];

// Rótulos em português claro — a frase que o OPERADOR escolhe na tela é a
// mesma que a timeline registra (decisão: o histórico guarda o que a pessoa
// clicou, não uma tradução interna da categoria).
export const LABEL_MOTIVO_REUNIAO_HM: Record<MotivoReuniaoHm, string> = {
  quer_parcelar: "Quer parcelar",
  vai_ver_contrato: "Vai ver o contrato",
  sem_condicao_agora: "Sem condição agora",
  indeciso: "Ainda indeciso",
  outro: "Outro motivo",
};

export function labelMotivoReuniao(tipo: string | null | undefined): string | null {
  if (!tipo) return null;
  return LABEL_MOTIVO_REUNIAO_HM[tipo as MotivoReuniaoHm] ?? tipo;
}
