// O que o Slack escreve em "Produto:".
//
// [09/10/2026] O rótulo era FIXO por canal: toda venda do produto 5682989 saía
// como "Clínica em Holding Familiar - Porto Alegre" — inclusive a 1ª venda da
// Clínica de Miami, que é uma OFERTA nova no mesmo produto. Quem diz a edição,
// o lote ou se é sinal/saldo é a oferta; o catálogo sincronizado da Hotmart
// (fin.ofertas) tem o nome dela.
//
// Regra: o nome da oferta, quando existe. Se ele não cita o produto ("Taxa de
// inscrição R$ 697"), o produto vai na frente para o canal não perder o contexto.
// Sem nome de oferta (oferta principal vem vazia, ou oferta nova antes do sync),
// fica o rótulo do produto.

function normalizar(s: string): string {
  return s.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// O cadastro da Hotmart tem TAB e espaço duplo no meio do nome ("Saldo Aurum - ETHB\tR$59.000,00").
export function limparNome(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function rotuloDoProduto(produto: string, nomeOferta: string | null | undefined): string {
  const oferta = limparNome(nomeOferta);
  if (!oferta) return produto;
  if (normalizar(oferta).includes(normalizar(produto))) return oferta;
  return `${produto} · ${oferta}`;
}
