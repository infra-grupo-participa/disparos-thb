// Fonte ÚNICA das 7 categorias do motivo de cancelamento (0306) — consumida
// por lib/validators.ts (o z.enum), lib/services/hm.ts (a nota da timeline) e
// pelo frontend (o select do modal, a ficha e o rótulo do card). Antes desta
// correção havia DUAS cópias divergentes: o servidor gravava "Financeiro" na
// timeline enquanto a tela mostrava "Não tem como pagar agora" — o operador
// clicava numa frase e o histórico registrava outra, para sempre (achado do
// fable-orchestrator). Fica em lib/, não em app/hm/_components/, de propósito:
// o backend também precisa do rótulo (a timeline) e não pode importar de
// dentro de app/hm/**.
//
// Módulo PURO — sem "use client", sem import de React, sem I/O, sem "server-
// only", sem dependência de pg/env. Importável tanto do cliente (componentes
// do board/ficha) quanto do servidor (rotas, services), sem puxar nada além
// deste arquivo.
export const MOTIVOS_CANCELAMENTO_HM = [
  "financeiro", "expectativa", "pessoal", "tempo", "concorrente", "arrependimento", "outro",
] as const;
export type MotivoCancelamentoHm = (typeof MOTIVOS_CANCELAMENTO_HM)[number];

// Rótulos em português claro — a frase que o OPERADOR escolhe na tela é a
// mesma que a timeline registra (decisão: o histórico guarda o que a pessoa
// clicou, não uma tradução interna da categoria).
export const LABEL_MOTIVO_CANCELAMENTO_HM: Record<MotivoCancelamentoHm, string> = {
  financeiro: "Não tem como pagar agora",
  expectativa: "Não era o que esperava",
  pessoal: "Motivo pessoal",
  tempo: "Não tem tempo para acompanhar",
  concorrente: "Foi para outro programa/concorrente",
  arrependimento: "Se arrependeu da compra",
  outro: "Outro motivo",
};

export function labelMotivoCancelamento(tipo: string | null | undefined): string | null {
  if (!tipo) return null;
  return LABEL_MOTIVO_CANCELAMENTO_HM[tipo as MotivoCancelamentoHm] ?? tipo;
}
