import { query } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

// Casamento de telefone "sem chance de erro": entre os candidatos da chamada
// (from_number / dnis), escolhe o comprador cujo telefone coincide no MAIOR
// sufixo de dígitos. Exige no mínimo 8 dígitos coincidentes E unicidade — se
// dois compradores DIFERENTES empatam no melhor sufixo, é ambíguo e NÃO casa
// (melhor deixar sem aluno do que atribuir a chamada ao aluno errado).
// Quando o mesmo comprador aparece em HT e no Seminário, prioriza HT.
//
// Compara DÍGITOS CRUS dos dois lados (só remove não-dígitos), igual ao
// diagnóstico — sem normalizePhone no match, para não arriscar divergência nos
// últimos 8 dígitos. NÃO engole erro: quem chama decide o que fazer (o webhook
// protege a gravação com .catch; o re-casamento reporta no resultado).
export type CasamentoTelefone = { compradorId: string; evento: string; telefone: string };

export async function casarTelefone(
  numerosBrutos: (string | null | undefined)[],
): Promise<CasamentoTelefone | null> {
  const candidatos = numerosBrutos
    .map((n) => (n ? String(n).replace(/\D/g, "") : ""))
    .filter((d) => d.length >= 8);

  for (const dig of candidatos) {
    const linhas = await query<{ comprador_id: string; evento: string; tel: string }>(
      `select comprador_id, evento, regexp_replace(telefone, '\\D', '', 'g') as tel
         from cs.contatos_evento
        where telefone is not null
          and right(regexp_replace(telefone, '\\D', '', 'g'), 8) = $1`,
      [dig.slice(-8)],
    );
    if (linhas.length === 0) continue;

    // Pontua cada candidato pela quantidade de dígitos finais que batem com o
    // número da chamada — quanto mais longo o sufixo coincidente, mais seguro.
    const comScore = linhas.map((l) => ({ ...l, score: sufixoComum(l.tel, dig) }));
    const melhorScore = Math.max(...comScore.map((c) => c.score));
    const topo = comScore.filter((c) => c.score === melhorScore);
    const compradores = new Set(topo.map((c) => c.comprador_id));

    // Compradores distintos empatados no melhor sufixo → ambíguo: não casa.
    if (compradores.size !== 1) continue;

    const evento = topo.some((c) => c.evento === "HT") ? "HT" : topo[0].evento;
    return { compradorId: topo[0].comprador_id, evento, telefone: normalizePhone(dig) ?? dig };
  }
  return null;
}

// Quantos dígitos finais de `a` e `b` coincidem.
function sufixoComum(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
