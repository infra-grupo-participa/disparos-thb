import { query, queryOne } from "@/lib/db";
import { randomUUID } from "node:crypto";

// O catálogo de ofertas (public.hm_product_catalog) e a esteira de import da
// planilha do Marcio (cs.oferta_planilha_staging, cs.fn_oferta_planilha_promover*)
// — 0255/0256/0257. `disparos_app` NÃO tem SELECT/INSERT/UPDATE direto em
// hm_product_catalog (0044) — toda leitura/escrita do catálogo passa pelas
// pontes SECURITY DEFINER (cs.fn_hm_catalogo_listar / _atualizar). A tabela de
// staging, ao contrário, tem GRANT direto (select, insert; sem update/delete —
// 0177) porque ela é append-only por desenho: não precisa de ponte, só não
// pode ser reescrita.

export type OfertaCatalogo = {
  offer_code: string;
  product_id: string | null;
  product_name: string | null;
  categoria: string | null;
  nome_comercial: string | null;
  valor_tabela: string | null;
  explicacao: string | null;
  link: string | null;
  produto_checkout: string | null;
  dono_email: string | null;
  recorrente: boolean;
  ativo: boolean;
  origem_do_dado: string;
  origem_ref: string | null;
  papel: string | null;
  pacote_cheio: string | null;
  entrada_condicao_fechada: boolean;
  entrada_do_programa: boolean;
  concede_trilha: boolean;
  atualizado_por: string | null;
  atualizado_em: string | null;
};

export async function listarCatalogo(filtros: {
  busca?: string;
  ativo?: boolean | null;
  papel?: string | null;
  origem?: string | null;
  limite?: number;
}): Promise<OfertaCatalogo[]> {
  return query<OfertaCatalogo>(
    `select * from cs.fn_hm_catalogo_listar($1, $2, $3, $4, $5)`,
    [filtros.busca ?? "", filtros.ativo ?? null, filtros.papel ?? null, filtros.origem ?? null, filtros.limite ?? 500],
  );
}

export type PatchCatalogo = {
  nome_comercial?: string | null;
  valor_tabela?: number | null;
  explicacao?: string | null;
  link?: string | null;
  produto_checkout?: string | null;
  dono_email?: string | null;
  recorrente?: boolean;
  ativo?: boolean;
  papel?: string | null;
};

export async function atualizarCatalogo(
  offerCode: string,
  patch: PatchCatalogo,
  por: string,
): Promise<{ ok: boolean; motivo: string | null }> {
  const r = await queryOne<{ ok: boolean; offer_code: string; motivo: string | null }>(
    `select ok, offer_code, motivo from cs.fn_hm_catalogo_atualizar($1, $2::jsonb, $3)`,
    [offerCode, JSON.stringify(patch), por],
  );
  return { ok: !!r?.ok, motivo: r?.motivo ?? null };
}

// ---------------------------------------------------------------------------
// IMPORTAÇÃO — a MESMA lógica de classificação usada para semear a planilha
// de 16/08 em 0256 (scripts/gera_staging.py, achado do backend), agora como
// código de produção para a próxima planilha que o Marcio trouxer. Só
// escreve em staging — nunca no catálogo (import nunca escreve direto).
// ---------------------------------------------------------------------------

// Mesmos 7 formatos resolvidos na medição de 16/08 — "R$ 14.700" lido como
// 14,70 é o erro clássico que este parser evita.
export function parseValorPlanilha(bruto: string | null | undefined): number | null {
  const s0 = (bruto ?? "").trim();
  if (!s0) return null;
  const s = s0.replace(/R\$/g, "").trim();
  const m = s.match(/[\d.,]+/);
  if (!m) return null;
  let t = m[0];
  const temVirgula = t.includes(",");
  const temPonto = t.includes(".");
  if (temVirgula && temPonto) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".")
      ? t.replace(/\./g, "").replace(",", ".")   // 1.234,56
      : t.replace(/,/g, "");                      // 1,234.56
  } else if (temVirgula) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, "");                      // "13.000" (milhar sem centavos)
  } else if (s0.includes("R$") && /^\d+\.\d{3}$/.test(t)) {
    t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

export function produtoCheckoutDoLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/hotmart\.com\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

function classificarQuarentena(row: {
  offer_code?: string | null;
  link?: string | null;
  valor_txt?: string | null;
  nome_hotmart_txt?: string | null;
  explicacao_txt?: string | null;
}): string | null {
  const cod = (row.offer_code ?? "").trim();
  if (!cod) {
    const textoOperacao = `${row.nome_hotmart_txt ?? ""} ${row.explicacao_txt ?? ""}`.toUpperCase();
    if (textoOperacao.includes("CANCELAMENTO")) {
      return "Sem código e sem link — não é oferta, é pedido de cancelamento de pessoa física. Revisão humana; não promover para o catálogo.";
    }
    return "Sem código e sem link na planilha — saldo aparentemente legítimo mas sem oferta gerada na Hotmart. Revisão humana: gerar link ou confirmar antes de promover.";
  }
  // Achado BAIXO do security-pentester (16/08): sem esta checagem, um link fora do formato
  // https:// passava a classificação sem motivo de quarentena, ia para o lote de "pronto para
  // promover" e só estourava no CHECK do banco (hm_product_catalog_link_https, 0255) DENTRO de
  // fn_oferta_planilha_promover_lote — que é um statement só, então 1 link ruim derrubava as
  // outras N ofertas boas do mesmo lote junto. Barrar aqui, na importação, é o mesmo motivo de
  // já não deixar a linha promover: a regra do catálogo não muda, só passa a ser avisada cedo.
  if (row.link && !row.link.startsWith("https://")) {
    return `Link fora do formato esperado ('${row.link}') — precisa começar com https://. Corrigir antes de promover; o catálogo recusaria a linha inteira do lote.`;
  }
  if ((row.valor_txt ?? "").toLowerCase().includes("dividid")) {
    return `valor_txt é texto livre com valor dividido entre múltiplos links ('${row.valor_txt}') — parse automático pega o PRIMEIRO número e pode não ser o valor real da oferta. Revisão humana antes de promover valor_tabela.`;
  }
  return null;
}

export type LinhaImportar = {
  linha_num: number;
  produto_txt?: string | null;
  nome_txt?: string | null;
  valor_txt?: string | null;
  explicacao_txt?: string | null;
  nome_hotmart_txt?: string | null;
  offer_code?: string | null;
  link?: string | null;
};

export async function importarPlanilha(
  arquivo: string,
  linhas: LinhaImportar[],
  importadoPor: string,
): Promise<{ lote: string; total: number; emQuarentena: number }> {
  const lote = randomUUID();
  const vistos = new Set<string>();
  let emQuarentena = 0;

  // Classificação em memória, ESCRITA em UM insert só (unnest de arrays
  // paralelos — padrão já usado em lib/services/hm.ts e ac-automacoes.ts).
  // Até 2000 linhas (teto do schema): um loop de awaits seria 2000 round-trips
  // ao pooler por importação — N+1 na cara.
  const linhaNum: number[] = [];
  const produtoTxt: (string | null)[] = [];
  const nomeTxt: (string | null)[] = [];
  const valorTxt: (string | null)[] = [];
  const valorNumArr: (number | null)[] = [];
  const explicacaoTxt: (string | null)[] = [];
  const nomeHotmartTxt: (string | null)[] = [];
  const offerCodeArr: (string | null)[] = [];
  const linkArr: (string | null)[] = [];
  const produtoCheckoutArr: (string | null)[] = [];
  const motivoArr: (string | null)[] = [];

  for (const l of linhas) {
    const codigoBruto = (l.offer_code ?? "").trim() || null;
    const codigo = codigoBruto ?? (l.link ? (l.link.match(/off=([A-Za-z0-9]+)/)?.[1] ?? null) : null);
    const duplicado = !!codigo && vistos.has(codigo);
    if (codigo) vistos.add(codigo);

    let motivo = classificarQuarentena({ ...l, offer_code: codigo });
    if (!motivo && duplicado) {
      motivo = `Código '${codigo}' duplicado nesta importação — ver outras linhas com o mesmo código. Revisão humana.`;
    }
    if (motivo) emQuarentena++;

    linhaNum.push(l.linha_num);
    produtoTxt.push(l.produto_txt ?? null);
    nomeTxt.push(l.nome_txt ?? null);
    valorTxt.push(l.valor_txt ?? null);
    valorNumArr.push(parseValorPlanilha(l.valor_txt));
    explicacaoTxt.push(l.explicacao_txt ?? null);
    nomeHotmartTxt.push(l.nome_hotmart_txt ?? null);
    offerCodeArr.push(codigo);
    linkArr.push(l.link ?? null);
    produtoCheckoutArr.push(produtoCheckoutDoLink(l.link ?? null));
    motivoArr.push(motivo);
  }

  if (linhaNum.length > 0) {
    await query(
      `insert into cs.oferta_planilha_staging
         (lote, arquivo, linha_num, produto_txt, nome_txt, valor_txt, valor_num_planilha,
          explicacao_txt, nome_hotmart_txt, offer_code, link, produto_checkout,
          motivo_quarentena, importado_por)
       select $1, $2, u.linha_num, u.produto_txt, u.nome_txt, u.valor_txt, u.valor_num_planilha,
              u.explicacao_txt, u.nome_hotmart_txt, u.offer_code, u.link, u.produto_checkout,
              u.motivo_quarentena, $3
         from unnest(
           $4::int[], $5::text[], $6::text[], $7::text[], $8::numeric[],
           $9::text[], $10::text[], $11::text[], $12::text[], $13::text[], $14::text[]
         ) as u(linha_num, produto_txt, nome_txt, valor_txt, valor_num_planilha,
                explicacao_txt, nome_hotmart_txt, offer_code, link, produto_checkout,
                motivo_quarentena)`,
      [
        lote, arquivo, importadoPor,
        linhaNum, produtoTxt, nomeTxt, valorTxt, valorNumArr,
        explicacaoTxt, nomeHotmartTxt, offerCodeArr, linkArr, produtoCheckoutArr, motivoArr,
      ],
    );
  }

  return { lote, total: linhas.length, emQuarentena };
}

export type LinhaStaging = {
  id: number;
  lote: string;
  linha_num: number;
  produto_txt: string | null;
  nome_txt: string | null;
  valor_txt: string | null;
  valor_num_planilha: string | null;
  explicacao_txt: string | null;
  nome_hotmart_txt: string | null;
  offer_code: string | null;
  link: string | null;
  produto_checkout: string | null;
  motivo_quarentena: string | null;
  importado_em: string;
  importado_por: string;
};

export async function listarImportacao(lote: string): Promise<LinhaStaging[]> {
  return query<LinhaStaging>(
    `select id, lote, linha_num, produto_txt, nome_txt, valor_txt, valor_num_planilha,
            explicacao_txt, nome_hotmart_txt, offer_code, link, produto_checkout,
            motivo_quarentena, importado_em, importado_por
       from cs.oferta_planilha_staging
      where lote = $1
      order by linha_num`,
    [lote],
  );
}

export type ResultadoPromocao = { ok: boolean; offer_code: string | null; acao: string | null; motivo: string | null };

export async function promoverLote(stagingIds: number[], por: string): Promise<ResultadoPromocao[]> {
  return query<ResultadoPromocao>(
    `select ok, offer_code, acao, motivo from cs.fn_oferta_planilha_promover_lote($1::bigint[], $2)`,
    [stagingIds, por],
  );
}
