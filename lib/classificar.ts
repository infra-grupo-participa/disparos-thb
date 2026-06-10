// Classificador heurístico de mensagens de leads (PT-BR) — contexto "Holding Total"
// (curso/mentoria de holding patrimonial e advocacia). Sem custo, determinístico,
// roda no servidor. Cada mensagem do lead recebe: assunto (tema dominante),
// categoria (tipo de resposta) e sentimento. Também extrai palavras-chave.
//
// A classificação de ASSUNTO usa PRIORIDADE (do mais crítico ao menos): um sinal
// de risco/churn vence um elogio na mesma mensagem — é assim que a operação deve
// priorizar quem atender primeiro.

// Normaliza para casar termos: minúsculas, sem acento, espaços colapsados.
export function normalizar(texto: string): string {
  return (texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type Assunto = { chave: string; label: string; emoji: string };

// Temas em ordem de prioridade. O primeiro cujos termos casarem vence.
const TEMAS: { chave: string; label: string; emoji: string; termos: RegExp }[] = [
  { chave: "risco_churn", label: "Risco / churn", emoji: "🔴",
    termos: /\b(cancelar|cancela|reembolso|estorno|desisti|desistir|arrepend|nao quero mais|quero sair|tirar meu dinheiro|me tira|nao vale|perda de tempo|golpe|enganad)/ },
  { chave: "financeiro_cobranca", label: "Financeiro / cobrança", emoji: "💳",
    termos: /\b(cobranca|cobrad|boleto|fatura|parcela|cartao|nao paguei|nao consegui pagar|pagamento|pix nao|nota fiscal|recibo|comprovante)/ },
  { chave: "financiamento", label: "Financiamento / simulação", emoji: "🏦",
    termos: /\b(financiar|financiamento|simulacao|simular|simula|juros|entrada|credito|parcelamento|condicoes|valor do curso|quanto custa|investimento)/ },
  { chave: "acesso_login", label: "Acesso / login", emoji: "🔐",
    termos: /\b(acesso|acessar|login|senha|entrar na plataforma|area de membros|nao consigo entrar|liberar|liberacao|cadastro|email errado)/ },
  { chave: "tecnico", label: "Técnico / erro", emoji: "🛠️",
    termos: /\b(erro|bug|travou|travando|nao carrega|nao abre|nao funciona|problema tecnico|deu pau|bugou|carregando)/ },
  { chave: "desafio_trilha", label: "Desafio 30 dias / trilha", emoji: "🏆",
    termos: /\b(desafio|trilha|30 dias|missao|tarefa|modulo|aula conclui|conclui a aula|cheguei no|estou no dia|progresso|avancar)/ },
  { chave: "prova_social", label: "Prova social / resultado", emoji: "🚀",
    termos: /\b(consegui|fechei|fechamento|arremate|leilao|ganhei|deu certo|primeiro cliente|fechei contrato|resultado|funcionou de verdade|honorarios)/ },
  { chave: "duvida", label: "Dúvida / como faço", emoji: "❓",
    termos: /\b(como faco|como fazer|duvida|nao entendi|onde fica|onde encontro|qual o|me explica|pode explicar|nao sei como)/ },
  { chave: "aula_live", label: "Aula ao vivo / live", emoji: "🎥",
    termos: /\b(aula ao vivo|live|ao vivo|que horas a aula|quando comeca|horario da aula|vai ter aula|gravacao da aula)/ },
  { chave: "video", label: "Vídeo / aula não abre", emoji: "📺",
    termos: /\b(video|player|nao abre o video|nao roda|sem som|imagem travada)/ },
  { chave: "grupo_comunidade", label: "Grupo / comunidade", emoji: "👥",
    termos: /\b(grupo|comunidade|link do grupo|whatsapp do grupo|telegram|entrar no grupo|fui removid)/ },
  { chave: "compromisso", label: "Compromisso / foco", emoji: "🎯",
    termos: /\b(vou fazer|me comprometo|prometo|foco total|nao vou desistir|conta comigo|to dentro|bora pra cima)/ },
  { chave: "elogio", label: "Elogios / satisfação", emoji: "🙏",
    termos: /\b(obrigad|valeu|gratidao|grato|grata|parabens|excelente|otimo|otima|maravilho|adorei|amei|sensacional|top|show|nota 10|perfeito|incrivel)/ },
  { chave: "afetivo", label: "Afetivo", emoji: "❤️",
    termos: /\b(deus abencoe|deus te|abraco|carinho|amo voces|coracao|bencao)/ },
  { chave: "saudacao", label: "Saudação / sem assunto", emoji: "💬",
    termos: /\b(bom dia|boa tarde|boa noite|^oi$|^ola$|^opa$|tudo bem|^blz$|^ok$|^sim$|^nao$)/ },
];

export function classificarAssunto(texto: string): Assunto {
  const t = normalizar(texto);
  if (!t) return { chave: "saudacao", label: "Saudação / sem assunto", emoji: "💬" };
  for (const tema of TEMAS) {
    if (tema.termos.test(t)) return { chave: tema.chave, label: tema.label, emoji: tema.emoji };
  }
  // Sem termo dominante: pergunta genérica vira dúvida; senão, sem assunto.
  if (t.includes("?")) return { chave: "duvida", label: "Dúvida / como faço", emoji: "❓" };
  return { chave: "saudacao", label: "Saudação / sem assunto", emoji: "💬" };
}

export type Categoria = { chave: string; label: string };

// Tipo de resposta: como o lead se comunica (independe do assunto).
export function classificarCategoria(texto: string): Categoria {
  const t = normalizar(texto);
  if (/\b(obrigad|valeu|gratidao|grato|grata|parabens|amei|adorei)\b/.test(t))
    return { chave: "agradecimento", label: "Agradecendo" };
  if (texto.includes("?") || /\b(como|quando|onde|qual|quanto|porque|por que|pode me|sera que|tem como)\b/.test(t))
    return { chave: "pergunta", label: "Perguntando" };
  if (/\b(cancelar|reembolso|nao quero|nao vale|caro demais|nao consigo|dificil|mas |porem|nao gostei|decepcion)\b/.test(t))
    return { chave: "objecao", label: "Objeção / atrito" };
  if (/^(sim|ok|certo|combinado|fechado|perfeito|isso|exato|claro|vou|consegui|feito|pronto|blz|beleza)\b/.test(t) || /\b(ja fiz|ja conclui|ta certo|pode ser)\b/.test(t))
    return { chave: "confirmacao", label: "Confirmando" };
  if (/^(oi|ola|opa|bom dia|boa tarde|boa noite|e ai)\b/.test(t) && t.length < 25)
    return { chave: "saudacao", label: "Saudação" };
  return { chave: "outro", label: "Outros" };
}

export type Sentimento = "positivo" | "neutro" | "negativo";

export function classificarSentimento(texto: string): Sentimento {
  const t = normalizar(texto);
  const pos = /\b(obrigad|valeu|gratidao|parabens|excelente|otim|maravilho|adorei|amei|top|show|perfeito|incrivel|consegui|deu certo|fechei|animad|vamos|bora|sensacional)\b/.test(t);
  const neg = /\b(cancelar|reembolso|estorno|desisti|arrepend|nao quero|nao vale|golpe|enganad|erro|travou|nao funciona|nao consigo|decepcion|pessimo|ruim|caro demais|dificil)\b/.test(t);
  if (neg && !pos) return "negativo";
  if (pos && !neg) return "positivo";
  if (pos && neg) return "negativo"; // atrito presente → prioriza atenção
  return "neutro";
}

// Stopwords PT-BR para extração de palavras-chave (termos sem valor analítico).
const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","que","em","um","uma","para","pra","com","nao","no","na",
  "se","por","mais","as","os","como","mas","ao","ele","ela","seu","sua","ou","ja","eu","tem","foi",
  "vou","ta","to","tao","aqui","isso","esse","essa","este","esta","muito","bem","sim","meu","minha",
  "voce","vc","te","la","so","tudo","todo","toda","ate","tambem","entao","agora","sobre","dia","ser",
  "estou","esta","estao","sao","fica","vai","quero","queria","pode","poderia","gostaria","obrigado",
  "obrigada","ok","oi","ola","opa","blz","tbm","pq","q","ne","ai","mesmo","cada","fazer","faco",
]);

// Extrai palavras-chave relevantes de um texto (tokens ≥3 letras, sem stopwords).
export function extrairPalavrasChave(texto: string): string[] {
  const t = normalizar(texto).replace(/[^a-z0-9\s]/g, " ");
  return t
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

// Metadados dos assuntos (label, emoji, prioridade) — a ordem em TEMAS define a
// prioridade (0 = mais crítico). Usado no dashboard para o assunto dominante de
// cada conversa e para rotular/colorir os gráficos.
export const ASSUNTOS = TEMAS.map((t, i) => ({ chave: t.chave, label: t.label, emoji: t.emoji, prioridade: i }));
const META_ASSUNTO = new Map(ASSUNTOS.map((a) => [a.chave, a]));
export function metaAssunto(chave: string | null) {
  return (chave && META_ASSUNTO.get(chave)) || { chave: "saudacao", label: "Sem assunto", emoji: "💬", prioridade: 99 };
}

// Detecta pedido de opt-out ("PARAR", "SAIR", "não quero mais receber"…).
// Conservador para não confundir com "cancelar minha dúvida": só dispara para
// palavra isolada em mensagem curta ou frases explícitas de descadastro.
export function ehOptOut(texto: string): boolean {
  const t = normalizar(texto).trim();
  if (!t) return false;
  if (t.length <= 20 && /^(parar|pare|para|sair|saia|stop|descadastrar|remover|cancelar)\b/.test(t)) return true;
  if (/\b(nao quero mais receber|parar de receber|nao me (mande|envie|manda) mais|me (tira|tire|remova|exclua) da lista|sair da lista|descadastr|cancelar (o )?recebimento|nao quero receber mais)/.test(t)) return true;
  return false;
}

// Classifica uma mensagem de lead por completo (usado no sync e no webhook).
export function classificarMensagem(texto: string) {
  const assunto = classificarAssunto(texto);
  return {
    assunto: assunto.chave,
    categoria: classificarCategoria(texto).chave,
    sentimento: classificarSentimento(texto),
  };
}
