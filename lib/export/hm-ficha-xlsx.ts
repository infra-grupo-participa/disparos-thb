import ExcelJS from "exceljs";
import type { FichaHm } from "@/lib/services/hm-ficha";

// Ficha do aluno HM em XLSX. A regra que rege este arquivo: cada informação mora
// no bloco a que pertence — identificação com identificação, dinheiro com
// dinheiro — e cada bloco vem na ordem em que a operação usa (quem é → onde está
// na esteira → o que foi combinado → quanto → o que falta ativar). Listas (sócios,
// histórico, formulários) viram abas próprias, porque tabela dentro de ficha é o
// que embaralhava a planilha antiga.

const LARANJA = "FFF97316";
const LARANJA_CLARO = "FFFDE8D7";
const CINZA = "FFF1F5F9";
const TEXTO_ESCURO = "FF0F172A";

type Linha = [rotulo: string, valor: unknown, formato?: "texto" | "data" | "dinheiro" | "simnao"];

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(x) ? x : null;
}
function d(v: unknown): Date | null {
  if (!v) return null;
  const x = new Date(v as string);
  return isNaN(x.getTime()) ? null : x;
}
function simNao(v: unknown): string {
  return v === true ? "Sim" : v === false ? "Não" : "—";
}
function txtOu(v: unknown): string {
  return v === null || v === undefined || v === "" ? "—" : String(v);
}

// Nome de arquivo que sobrevive ao Windows e ao Drive: sem acento, sem barra.
export function nomeArquivoFicha(nome: string | null | undefined, agora: Date): string {
  const limpo = (nome || "aluno")
    .normalize("NFD") // separa o acento da letra para removê-lo (̀-ͯ)
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const dia = agora.toISOString().slice(0, 10);
  return `Ficha-HM-${limpo}-${dia}.xlsx`;
}

export async function fichaHmParaXlsx(f: FichaHm, agora: Date): Promise<Buffer> {
  const c = f.contato;
  const fin = f.financeiro ?? {};
  const pr = f.prorata;

  const wb = new ExcelJS.Workbook();
  wb.creator = "CS · Grupo Participa";
  wb.created = agora;

  // ---------------------------------------------------------------- aba Ficha
  const ws = wb.addWorksheet("Ficha", { views: [{ state: "frozen", ySplit: 2 }] });
  ws.columns = [{ width: 34 }, { width: 78 }];

  ws.mergeCells("A1:B1");
  const titulo = ws.getCell("A1");
  titulo.value = `Ficha do aluno · Holding Masters${c.turma ? ` (${String(c.turma)})` : ""}`;
  titulo.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titulo.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  titulo.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells("A2:B2");
  const sub = ws.getCell("A2");
  sub.value = `${String(c.nome ?? "—")} · exportado em ${agora.toLocaleString("pt-BR")}`;
  sub.font = { italic: true, color: { argb: "FF64748B" } };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };

  const bloco = (nome: string, linhas: Linha[]) => {
    ws.addRow([]);
    const r = ws.addRow([nome.toUpperCase()]);
    ws.mergeCells(`A${r.number}:B${r.number}`);
    r.getCell(1).font = { bold: true, color: { argb: "FF9A3412" } };
    r.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA_CLARO } };
    r.height = 20;
    r.getCell(1).alignment = { vertical: "middle" };

    for (const [rotulo, bruto, formato = "texto"] of linhas) {
      const linha = ws.addRow([rotulo, ""]);
      linha.getCell(1).font = { bold: true, color: { argb: "FF475569" } };
      const cel = linha.getCell(2);
      cel.alignment = { vertical: "top", wrapText: true };
      cel.font = { color: { argb: TEXTO_ESCURO } };

      if (formato === "simnao") {
        cel.value = simNao(bruto);
      } else if (formato === "dinheiro") {
        // O numFmt monetário só faz sentido em célula numérica. Aplicá-lo antes de
        // testar o null deixava a célula com valor "—" e formato de moeda — o Excel
        // mostra o traço mas trata o campo como número mal-formado.
        const v = n(bruto);
        if (v === null) {
          cel.value = "—";
        } else {
          cel.value = v;
          cel.numFmt = 'R$ #,##0.00;[Red]-R$ #,##0.00';
        }
      } else if (formato === "data") {
        const v = d(bruto);
        cel.value = v ?? "—";
        if (v) cel.numFmt = "dd/mm/yyyy hh:mm";
      } else {
        // Ficha é bloco rótulo/valor (vertical), não coluna somável: aqui o "—" é
        // legível e não contamina soma nenhuma.
        // O cast antigo (`as string | number`) mentia para o TS: um objeto/JSONB
        // passava direto e virava "[object Object]" na célula. Agora o que não for
        // primitivo é serializado explicitamente.
        const v = Array.isArray(bruto) ? bruto.join(", ") : bruto;
        if (v === null || v === undefined || v === "") {
          cel.value = "—";
        } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          cel.value = v;
        } else if (v instanceof Date) {
          cel.value = v;
          cel.numFmt = "dd/mm/yyyy hh:mm";
        } else {
          cel.value = JSON.stringify(v);
        }
      }
    }
  };

  bloco("Identificação", [
    ["Nome", c.nome],
    ["E-mail", c.email],
    ["Telefone", c.telefone],
    ["Perfil no Facebook", c.link_facebook],
    ["Turma (HM)", c.turma],
    ["Turma de origem (base)", c.turma_origem],
    ["Tags", c.tags],
    ["Entrou na esteira em", c.criado_em, "data"],
    ["ID do comprador", c.comprador_id],
    ["Aluno na base THB", fin.aluno_id ? `Sim — ${String(fin.aluno_id)}` : "Não provisionado"],
  ]);

  bloco("Situação na esteira", [
    ["Etapa atual", c.estagio_nome],
    ["Esteira", c.estagio_aba === "ativacao" ? "Ativação" : "Comercial"],
    ["Responsável", c.responsavel],
    ["Não contatar", c.nao_contatar, "simnao"],
    ["Motivo (não contatar)", c.nao_contatar_motivo],
    ["Revisar", c.revisar, "simnao"],
    ["Motivo (revisar)", c.revisar_motivo],
    ["Cancelamento em", c.cancelamento_em, "data"],
    ["Motivo do cancelamento", c.cancelamento_motivo],
  ]);

  bloco("Comercial", [
    ["Categoria de entrada", c.categoria_entrada === "sinal" ? "Sinal (R$ 300)" : c.categoria_entrada === "compra_cheia" ? "Compra cheia" : c.categoria_entrada],
    ["Plano", c.plano],
    ["Reunião agendada para", c.reuniao_em, "data"],
    ["Resultado da reunião", c.reuniao_resultado],
    ["Entrevista agendada para", c.entrevista_em, "data"],
    ["Resultado da entrevista", c.entrevista_resultado],
  ]);

  bloco("Acordo do saldo", [
    ["Meio de pagamento combinado", c.pagamento_meio],
    ["Pagamento previsto para", c.pagamento_previsto_em, "data"],
    ["O combinado", c.acordo],
    ["Oferta de saldo escolhida", c.oferta_saldo_codigo],
    ["Link do saldo enviado em", c.link_saldo_enviado_em, "data"],
  ]);

  bloco("Financeiro", [
    ["Valor total do pacote", fin.valor_total, "dinheiro"],
    ["Valor já pago", fin.valor_pago, "dinheiro"],
    ["Saldo a pagar (pró-rata)", pr?.saldo_a_pagar, "dinheiro"],
    ["Bruto registrado na Hotmart", fin.hotmart_bruto, "dinheiro"],
    ["Total sugerido pelo sistema", fin.sugestao_valor_total, "dinheiro"],
    ["Pagamento confirmado em", c.pagamento_em, "data"],
    ["Forma do pagamento", c.pagamento_forma],
    ["Parcelas", c.pagamento_parcelas],
    ["Apto à ativação (saldo quitado)", c.apto_ativacao, "simnao"],
  ]);

  // Só faz sentido imprimir a conta do pró-rata quando ela existe: sem os insumos
  // (oferta anterior, data e valor pagos), o saldo é o cheio e não há crédito.
  if (pr) {
    bloco("Crédito pró-rata (tempo não usado do acesso anterior)", [
      ["Dias usados", pr.dias_usados],
      ["Dias restantes", pr.dias_restantes],
      ["Valor por dia", pr.valor_dia, "dinheiro"],
      ["Consumido", pr.consumido, "dinheiro"],
      ["Crédito", pr.credito, "dinheiro"],
      ["Saldo a pagar", pr.saldo_a_pagar, "dinheiro"],
    ]);
  }

  bloco("Ativação", [
    ["Acesso ao Searchie/Óbvio", c.ativ_searchie, "simnao"],
    ["Acesso à comunidade THB", c.ativ_comunidade, "simnao"],
    ["Grupo de informes", c.ativ_grupo, "simnao"],
    ["Qual grupo", c.grupo_informes],
    ["Pesquisa", c.ativ_pesquisa, "simnao"],
    ["Acesso ao GPS (programa de implementação)", c.ativ_gps, "simnao"],
    ["Pendência para conclusão", c.pendencia],
  ]);

  bloco("Observações", [["Observações", c.observacoes]]);

  // --------------------------------------------------------------- aba Sócios
  const wsS = wb.addWorksheet("Sócios");
  cabecalho(wsS, [
    { header: "Nome", width: 30 },
    { header: "E-mail", width: 32 },
    { header: "Telefone", width: 18 },
    { header: "Perfil no Facebook", width: 34 },
    { header: "Searchie", width: 10 },
    { header: "Comunidade", width: 12 },
    { header: "Grupo", width: 10 },
    { header: "Na base THB", width: 14 },
  ]);
  for (const s of f.socios) {
    wsS.addRow([
      s.nome ?? "—", s.email ?? "—", s.telefone ?? "—", s.link_facebook ?? "—",
      simNao(s.ativ_searchie), simNao(s.ativ_comunidade), simNao(s.ativ_grupo),
      s.aluno_id ? "Sim" : "Não",
    ]);
  }
  if (f.socios.length === 0) vazio(wsS, "Nenhum sócio convidado.");

  // ---------------------------------------------------------- aba Agendamentos
  // Toda marcação de reunião/entrevista, inclusive as que caíram: é a trilha que
  // mostra quem remarcou (e quantas vezes) e quem simplesmente não apareceu.
  const wsA = wb.addWorksheet("Agendamentos");
  cabecalho(wsA, [
    { header: "Tipo", width: 14 },
    { header: "Marcada para", width: 20 },
    { header: "Situação", width: 18 },
    { header: "Motivo", width: 44 },
    { header: "Quem marcou", width: 20 },
    { header: "Registrado em", width: 20 },
  ]);
  const SIT: Record<string, string> = {
    agendado: "Agendada (vigente)",
    reagendado: "Remarcada",
    realizado: "Realizada",
    nao_compareceu: "Não compareceu",
    cancelado: "Cancelada",
  };
  for (const a of f.agendamentos) {
    const l = wsA.addRow([
      a.tipo === "entrevista" ? "Entrevista" : "Reunião",
      d(a.quando) ?? "—",
      SIT[String(a.status)] ?? String(a.status),
      txtOu(a.motivo),
      txtOu(a.autor),
      d(a.criado_em) ?? "—",
    ]);
    l.getCell(2).numFmt = "dd/mm/yyyy hh:mm";
    l.getCell(6).numFmt = "dd/mm/yyyy hh:mm";
  }
  if (f.agendamentos.length === 0) vazio(wsA, "Nenhuma reunião ou entrevista marcada.");

  // ------------------------------------------------------------- aba Histórico
  const wsT = wb.addWorksheet("Histórico");
  cabecalho(wsT, [
    { header: "Quando", width: 20 },
    { header: "Tipo", width: 18 },
    { header: "O que aconteceu", width: 80 },
    { header: "Autor", width: 20 },
  ]);
  for (const i of f.timeline) {
    const linha = wsT.addRow([d(i.criado_em) ?? "—", i.tipo ?? "—", i.descricao ?? "—", i.autor ?? "—"]);
    linha.getCell(1).numFmt = "dd/mm/yyyy hh:mm";
    linha.getCell(3).alignment = { wrapText: true, vertical: "top" };
  }
  if (f.timeline.length === 0) vazio(wsT, "Sem histórico registrado.");

  // ----------------------------------------------------------- aba Formulários
  // As respostas são um JSON de pergunta→resposta: cada pergunta vira uma LINHA,
  // e não uma coluna nova. É o que permite ler o formulário de cima para baixo.
  const wsF = wb.addWorksheet("Formulários");
  cabecalho(wsF, [
    { header: "Formulário", width: 24 },
    { header: "Respondido em", width: 20 },
    { header: "Pergunta", width: 46 },
    { header: "Resposta", width: 60 },
    { header: "Pontuação", width: 12 },
  ]);
  let temResposta = false;
  for (const form of f.formularios) {
    const respostas = (form.respostas ?? {}) as Record<string, unknown>;
    const pares = Object.entries(respostas);
    const quando = d(form.respondido_em);
    if (pares.length === 0) {
      const l = wsF.addRow([form.tipo ?? "—", quando ?? "—", "—", "—", form.pontuacao ?? "—"]);
      l.getCell(2).numFmt = "dd/mm/yyyy hh:mm";
      temResposta = true;
      continue;
    }
    for (const [pergunta, resposta] of pares) {
      const l = wsF.addRow([
        form.tipo ?? "—",
        quando ?? "—",
        pergunta,
        Array.isArray(resposta) ? resposta.join(", ") : resposta === null || resposta === undefined ? "—" : String(resposta),
        form.pontuacao ?? "—",
      ]);
      l.getCell(2).numFmt = "dd/mm/yyyy hh:mm";
      l.getCell(4).alignment = { wrapText: true, vertical: "top" };
      temResposta = true;
    }
  }
  if (!temResposta) vazio(wsF, "Nenhum formulário respondido.");

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function cabecalho(ws: ExcelJS.Worksheet, cols: { header: string; width: number }[]) {
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width }));
  const linha = ws.getRow(1);
  linha.font = { bold: true, color: { argb: "FFFFFFFF" } };
  linha.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LARANJA } };
  linha.height = 20;
  linha.alignment = { vertical: "middle" };
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// Uma aba vazia sem explicação parece um erro de exportação — diga que não há dados.
function vazio(ws: ExcelJS.Worksheet, texto: string) {
  const linha = ws.addRow([texto]);
  linha.getCell(1).font = { italic: true, color: { argb: "FF94A3B8" } };
}
