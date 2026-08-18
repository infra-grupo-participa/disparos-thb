// 0263 — mapeamento TOLERANTE do formulário de sócios do Respondi.
//
// Puro (sem `pg`, testável): a mesma separação de lib/busca.ts / contatos-filtro.ts.
//
// ── POR QUE TOLERANTE, NÃO POSICIONAL ────────────────────────────────────────────
// Não existe amostra real do payload que o Respondi manda — a única linha em
// cs.webhook_log com origem respondi% é um teste sintético de 07/07. As chaves
// reais são DESCONHECIDAS. Mapear por posição (`Object.values(payload)[3]`) ou
// por uma única chave hardcoded é o risco nº1: a memória da operação já registra
// "layout da aba API mudou, o MAPA da função lê errado" e "dashboard que agrega
// abas quebra EM SILÊNCIO". Aqui o layout pode mudar sem que ninguém perceba —
// então o mapeamento tem de ser tolerante a variação de rótulo E deixar rastro
// (`usadas`/`naoMapeadas`) de qual chave alimentou qual campo, para o dia em que
// o Respondi mudar o rótulo o diff aparecer sozinho no webhook_log.
//
// ── A REGRA CRÍTICA DE DESEMPATE ─────────────────────────────────────────────────
// Os campos do TITULAR são resolvidos ANTES dos do SÓCIO, e a chave usada é
// REMOVIDA do conjunto restante. Sem isso, "email" (chave solta) casaria com
// "titular_email" por `includes` antes de casar com "email" por igualdade, e o
// sócio herdaria o e-mail do titular — corrupção silenciosa, não um erro que
// alguém veria.
//
// ── PASSADA QUALIFICADA ANTES DA GENÉRICA (achado 1 do review de 17/08) ─────────
// Não basta a ordem dos CAMPOS no array (titular antes de sócio): dentro de um
// mesmo campo do SÓCIO, um sinônimo GENÉRICO nu (ex. "email", "telefone") não
// pode ganhar de um sinônimo QUALIFICADO doutro campo que ainda não teve sua vez
// de rodar. Cenário provado: o Respondi manda `email`/`telefone` NUS na raiz
// (identificação do respondente — é o mesmo contrato que o ramo genérico deste
// webhook já assume, ver Body/`body.email` em app/api/hm/formularios/route.ts) e
// os dados do sócio como respostas rotuladas ("E-mail do sócio" etc). Se
// resolvêssemos campo a campo em ORDEM DE DECLARAÇÃO, quando chegasse a vez de
// `email` (campo do sócio) ele casaria a chave nua ANTES de `titularEmail` ter
// sequer chance de perder pra ela — porque `email` bate por IGUALDADE e
// `titular_email` só bateria por segmento. Resultado: sócio herda contato do
// titular, em silêncio.
//
// Por isso a resolução roda em DUAS PASSADAS sobre TODOS os campos:
//   1ª passada: só os sinônimos QUALIFICADOS/COMPOSTOS de cada campo (os que
//      nomeiam titular ou sócio explicitamente: "email_do_socio",
//      "titular_email", "socio_telefone", ...).
//   2ª passada: só os sinônimos GENÉRICOS NUS ("email", "telefone", "cpf",
//      "nome", ...), e SÓ para os campos que a 1ª passada não resolveu.
// Dentro de cada passada, a ORDEM DE DECLARAÇÃO dos campos (titular antes de
// sócio) continua valendo — é o que garante que, se a chave nua `email`
// aparecer, ela vá para o titular (chave nua = respondente) e não para o sócio,
// que só é preenchido por chave qualificada (ver decisão no array abaixo).
// A chave consumida sai do conjunto `restantes` imediatamente, então nenhum dos
// dois lados pode reaproveitar a mesma chave.

export type CamposSocio = {
  titularNome: string | null;
  titularEmail: string | null;
  titularTelefone: string | null;
  nome: string | null;
  cpf: string | null;
  email: string | null;
  telefone: string | null;
  cep: string | null;
  cidade: string | null;
  estado: string | null;
  bairro: string | null;
  pais: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  observacao: string | null;
  respondiId: string | null;
  respondidoEm: string | null;
};

export type Mapeamento = {
  campos: CamposSocio;
  usadas: Record<keyof CamposSocio, string | null>;
  naoMapeadas: string[];
};

const CAMPO_VAZIO: CamposSocio = {
  titularNome: null,
  titularEmail: null,
  titularTelefone: null,
  nome: null,
  cpf: null,
  email: null,
  telefone: null,
  cep: null,
  cidade: null,
  estado: null,
  bairro: null,
  pais: null,
  endereco: null,
  numero: null,
  complemento: null,
  observacao: null,
  respondiId: null,
  respondidoEm: null,
};

// Campos de controle do payload — nunca viram "não mapeada" (são do protocolo
// do webhook, não do formulário em si). Mesmo vocabulário de app/api/hm/formularios.
const CONTROLE = new Set(["secret", "tipo", "formulario", "pontuacao", "score"]);

// Ordem = TITULAR primeiro, SÓCIO depois — é essa ordem que faz a regra de
// desempate funcionar (ver cabeçalho). Cada entrada: [campo, qualificados, genéricos].
//
// `qualificados`: sinônimos que NOMEIAM titular ou sócio explicitamente (têm
// "titular"/"socio"/"do_titular" etc no meio) — resolvidos na 1ª passada.
// `genericos`: sinônimos NUS, sem qualificador (ex. "email", "telefone", "cpf",
// "nome") — só resolvidos na 2ª passada, e só para o que sobrou.
//
// Decisão do achado 1(b): a chave NUA de raiz (`email`/`telefone` sem
// qualificação) pertence ao TITULAR, porque é ele o respondente do formulário
// (mesma leitura que o ramo genérico deste webhook já faz de `body.email` /
// `body.telefone`). Por isso `email`/`telefone` nus estão em `titularEmail` /
// `titularTelefone` — o SÓCIO só é preenchido por sinônimo qualificado
// ("email_do_socio", "socio_telefone", ...), nunca por chave nua.
const SINONIMOS: [keyof CamposSocio, string[], string[]][] = [
  ["titularNome", ["titular_nome", "nome_do_titular", "nome_titular", "nome_do_aluno"], ["titular", "aluno"]],
  ["titularEmail", ["titular_email", "email_do_titular", "email_titular", "e_mail_do_titular", "email_aluno"], ["email", "e_mail"]],
  ["titularTelefone", ["titular_telefone", "telefone_do_titular", "whatsapp_do_titular", "telefone_aluno", "celular_do_titular"], ["telefone", "whatsapp", "celular", "fone"]],
  ["nome", ["socio_nome", "nome_do_socio", "nome_socio", "nome_completo_do_socio"], ["socio"]],
  ["cpf", ["socio_cpf", "cpf_do_socio", "cpf_socio"], ["cpf"]],
  ["email", ["socio_email", "email_do_socio", "e_mail_do_socio"], []],
  ["telefone", ["socio_telefone", "telefone_do_socio"], []],
  // "cep" tem 3 letras e por isso só casa por IGUALDADE (trava contra match
  // frouxo de sinônimo curto). O formulário real do Respondi rotula
  // "Informe o CEP do(a) SÓCIO(A)" -> informe_o_cep_do_a_socio_a, que nunca
  // casaria. Os qualificados abaixo cobrem os rótulos reais sem afrouxar a
  // trava — medido no payload de 18/08.
  ["cep", ["informe_o_cep_do_a_socio_a", "cep_do_socio", "socio_cep", "cep_do_a_socio_a"], ["cep"]],
  ["cidade", [], ["cidade"]],
  ["estado", [], ["estado", "uf"]],
  ["bairro", [], ["bairro"]],
  ["pais", [], ["pais"]],
  ["endereco", [], ["endereco", "rua", "logradouro"]],
  ["numero", [], ["numero", "num", "n"]],
  ["complemento", [], ["complemento", "compl"]],
  ["observacao", [], ["observacao", "obs", "observacoes"]],
  ["respondiId", [], ["id", "response_id", "respondi_id", "submission_id"]],
  ["respondidoEm", [], ["data", "submitted_at", "created_at", "respondido_em", "data_de_envio"]],
];

/** NFD + remove diacríticos + minúsculas + não-[a-z0-9] vira "_" + colapsa "_". */
export function normalizarChave(k: string): string {
  return k
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function paraTexto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * Achata a raiz + `respostas`/`answers` num único objeto chave→valor. Se vier
 * array de `{label,value}` ou `{pergunta,resposta}`, converte para pares antes.
 */
function achatar(payload: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  const absorver = (obj: unknown) => {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === "object") {
          const o = item as Record<string, unknown>;
          const chave = o.label ?? o.pergunta ?? o.key ?? o.campo;
          const valor = o.value ?? o.resposta ?? o.valor;
          if (typeof chave === "string" && valor !== undefined) saida[chave] = valor;
        }
      }
      return;
    }
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) saida[k] = v;
    }
  };

  // 18/08 — o payload REAL do Respondi (form "Inclusão sócios (2026.2)")
  // aninha as respostas um nível abaixo:
  //   { form: {...}, respondent: { answers: {...}, raw_answers: [...] } }
  // O achatador só olhava `respostas`/`answers` NA RAIZ, então não encontrava
  // nada e o webhook devolvia `sem_identificacao` — com o dado completo (nome,
  // CPF, e-mail, telefone e endereço) chegando e sendo descartado.
  //
  // Estes são ENVELOPES: objetos cujo conteúdo é o payload de verdade. Descer
  // neles é recursivo de propósito (o Respondi pode aninhar mais fundo numa
  // versão futura), com profundidade limitada para não abrir buraco de
  // recursão infinita em payload malformado.
  const ENVELOPES = new Set(["respondent", "response", "submission", "data", "payload", "result"]);

  const percorrer = (obj: Record<string, unknown>, profundidade: number) => {
    for (const [k, v] of Object.entries(obj)) {
      if ((k === "respostas" || k === "answers" || k === "raw_answers") && v && typeof v === "object") {
        absorver(v);
      } else if (ENVELOPES.has(k) && v && typeof v === "object" && !Array.isArray(v) && profundidade < 4) {
        // Desce no envelope. As chaves DELE (ex. respondent.date) também entram
        // achatadas — é o que alimenta `respondidoEm` a partir de "date".
        percorrer(v as Record<string, unknown>, profundidade + 1);
      } else {
        // `saida[k] = v` sem sobrescrever o que já veio de um nível mais
        // específico: a resposta rotulada vence o metadado do envelope.
        if (!(k in saida)) saida[k] = v;
      }
    }
  };

  percorrer(payload, 0);
  return saida;
}

export function mapearSocio(payload: Record<string, unknown>): Mapeamento {
  const achatado = achatar(payload);

  // Chaves originais indexadas pela forma normalizada — preserva o texto
  // original para gravar em `usadas` (a prova documental de qual chave real
  // alimentou qual campo).
  const porNormalizada = new Map<string, string>();
  for (const chaveOriginal of Object.keys(achatado)) {
    const norm = normalizarChave(chaveOriginal);
    if (norm && !porNormalizada.has(norm)) porNormalizada.set(norm, chaveOriginal);
  }

  const restantes = new Set(porNormalizada.keys());
  const campos: CamposSocio = { ...CAMPO_VAZIO };
  const usadas: Record<keyof CamposSocio, string | null> = { ...CAMPO_VAZIO } as unknown as Record<keyof CamposSocio, string | null>;
  for (const k of Object.keys(usadas) as (keyof CamposSocio)[]) usadas[k] = null;

  // Acha, dentro de `restantes`, a chave normalizada que casa algum dos
  // `sinonimos` — igualdade primeiro (ordem declarada), match FROUXO por
  // SEGMENTO depois (pega prefixo/sufixo tipo "socio_cpf_2").
  //
  // ⚠️ Casar por substring solta é armadilha, e ela mordeu no teste: o sinônimo
  // "n" de `numero` casava dentro de "documento_fiscal_do_parceiro" (tem um "n"),
  // então um CPF de rótulo desconhecido virava NÚMERO DE ENDEREÇO, `naoMapeadas`
  // ficava vazia e a pendência `campos_nao_mapeados` nunca era gerada — o dado
  // entrava errado EM SILÊNCIO, exatamente o que este arquivo existe para evitar.
  // Duas travas (preservadas): (1) sinônimo curto (< 4 letras: "n", "id", "uf",
  // "obs", "num", "cep", "data") só casa por igualdade, nunca frouxo; (2) o
  // match frouxo é por SEGMENTO (as partes separadas por "_"), não por
  // substring — "cpf" casa "socio_cpf_2" mas "n" não casa "parceiro".
  function acharMatch(sinonimos: string[]): string | null {
    if (sinonimos.length === 0) return null;
    for (const s of sinonimos) {
      if (restantes.has(s)) return s;
    }
    const longos = sinonimos.filter((s) => s.length >= 4);
    for (const norm of restantes) {
      const segmentos = norm.split("_");
      if (longos.some((s) => segmentos.includes(s) || norm === s || s.split("_").every((p) => segmentos.includes(p)))) {
        return norm;
      }
    }
    return null;
  }

  function consumir(campo: keyof CamposSocio, achouNorm: string) {
    const chaveOriginal = porNormalizada.get(achouNorm)!;
    campos[campo] = paraTexto(achatado[chaveOriginal]);
    usadas[campo] = chaveOriginal;
    // REMOVE do conjunto restante — é isto que impede a mesma chave de ser
    // reaproveitada por engano por outro campo (titular ganha prioridade
    // sobre sócio; qualificado ganha prioridade sobre genérico).
    restantes.delete(achouNorm);
  }

  // 1ª passada: só sinônimos QUALIFICADOS (nomeiam titular/sócio), na ordem
  // de declaração (titular antes de sócio). Impede que um genérico nu de OUTRO
  // campo (ex. "email" do sócio) roube a chave antes do campo qualificado
  // correspondente ter sua chance (ver cabeçalho do arquivo).
  for (const [campo, qualificados] of SINONIMOS) {
    const achouNorm = acharMatch(qualificados);
    if (achouNorm) consumir(campo, achouNorm);
  }

  // 2ª passada: só sinônimos GENÉRICOS NUS, e só para o que a 1ª passada não
  // resolveu. Mesma ordem de declaração (titular antes de sócio) — é o que
  // garante que "email"/"telefone" nus caiam no TITULAR (respondente) e não no
  // sócio (que não tem genérico — ver comentário no array SINONIMOS).
  for (const [campo, , genericos] of SINONIMOS) {
    if (campos[campo] !== null) continue;
    const achouNorm = acharMatch(genericos);
    if (achouNorm) consumir(campo, achouNorm);
  }

  const naoMapeadas = [...restantes]
    .map((norm) => porNormalizada.get(norm)!)
    .filter((chaveOriginal) => !CONTROLE.has(normalizarChave(chaveOriginal)));

  return { campos, usadas, naoMapeadas };
}
