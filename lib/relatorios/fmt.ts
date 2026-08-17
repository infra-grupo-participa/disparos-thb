// Formatação compartilhada entre os geradores — evita reescrever brl()/dt() em cada um dos
// 3 arquivos (e divergirem sozinhos, como os "três jeitos de mostrar um número" que o
// arquiteto mapeou no resto do sistema). Não é serviço de dado — é só apresentação; não
// fere a lei "relatório não escreve SQL" (§4.1 de tipos.ts).

export const brl = (v: number | string | null | undefined): string => {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
};

export const dtBr = (v: string | Date | null | undefined): string => {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
};

export const dtHoraBr = (v: string | Date | null | undefined): string => {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
};
