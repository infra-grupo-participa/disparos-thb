// Códigos de erro da Meta (WhatsApp Cloud API) traduzidos para o operador, com
// severidade pensada em "queima de número": crítico = sinal de que o número está
// sendo penalizado/bloqueado (pare); aviso = qualidade caindo (desacelere);
// técnico = problema do destinatário/janela, não é queima.
export type SeveridadeMeta = "critico" | "aviso" | "tecnico";

export type MotivoMeta = { rotulo: string; significado: string; severidade: SeveridadeMeta };

const CODIGOS: Record<number, MotivoMeta> = {
  131049: { rotulo: "Entrega limitada pela Meta", significado: "A Meta segurou mensagens \"para manter um engajamento saudável\" — sinal forte de que o número está perdendo qualidade.", severidade: "critico" },
  131048: { rotulo: "Bloqueio por spam", significado: "Conta restringida por excesso de envios marcados como spam.", severidade: "critico" },
  131031: { rotulo: "Conta bloqueada", significado: "A conta do WhatsApp Business foi bloqueada ou desabilitada pela Meta.", severidade: "critico" },
  368: { rotulo: "Bloqueio temporário", significado: "Número bloqueado temporariamente por violação das políticas do WhatsApp.", severidade: "critico" },
  130472: { rotulo: "Número em experimento", significado: "A Meta está avaliando a qualidade do número e limitando a entrega.", severidade: "aviso" },
  130429: { rotulo: "Limite de taxa atingido", significado: "Volume acima do permitido por minuto — reduza o ritmo dos envios.", severidade: "aviso" },
  131056: { rotulo: "Limite por destinatário", significado: "Muitas mensagens para o mesmo número em pouco tempo.", severidade: "aviso" },
  80007: { rotulo: "Limite de taxa", significado: "Throughput acima do permitido — espace os envios.", severidade: "aviso" },
  131047: { rotulo: "Fora da janela de 24h", significado: "Mensagem livre fora da janela de 24h — use um template. Não indica queima.", severidade: "tecnico" },
  131026: { rotulo: "Não entregável", significado: "O número não tem WhatsApp ou não pode receber a mensagem.", severidade: "tecnico" },
  133010: { rotulo: "Número não registrado", significado: "O telefone não possui conta no WhatsApp.", severidade: "tecnico" },
  131051: { rotulo: "Tipo de mensagem não suportado", significado: "O conteúdo enviado não é aceito pelo destinatário.", severidade: "tecnico" },
};

export function motivoMeta(code: number): MotivoMeta {
  return CODIGOS[code] ?? { rotulo: `Erro ${code}`, significado: "Erro reportado pela Meta na entrega.", severidade: "tecnico" };
}
