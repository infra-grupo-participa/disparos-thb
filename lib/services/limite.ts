import { queryOne } from "@/lib/db";
import { getConfig } from "@/lib/services/config";

// Limite de volume do disparo (anti-ban). Os números já existiam em cs.config e
// alimentavam o painel de saúde — mas o painel só ACONSELHA. Quem manda parar
// tem de ser quem envia: /api/send consulta isto antes de criar a campanha.
//
// Por evento, não global: cada portal tem seu número/canal, e o limite da Meta é
// do número. O ritmo do HT não pode consumir a cota do Seminário.

export type Veredito = {
  liberado: boolean;
  motivo?: string;
  enviados24h: number;
  enviados1h: number;
  limiteDia: number;
  limiteHora: number;
  restante: number;
};

export async function checarLimiteDisparo(evento: string, aEnviar: number): Promise<Veredito> {
  const limiteDia = await getConfig<number>("disparo_limite_diario", 200);
  const limiteHora = await getConfig<number>("disparo_limite_hora", 40);

  const v = (await queryOne<{ enviados_24h: number; enviados_1h: number }>(
    `select
       (select count(*) from cs.disparo_contatos dc
          join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
         where dc.enviado and dc.enviado_em > now() - interval '24 hours')::int as enviados_24h,
       (select count(*) from cs.disparo_contatos dc
          join cs.disparos d on d.id = dc.disparo_id and d.evento = $1
         where dc.enviado and dc.enviado_em > now() - interval '1 hour')::int as enviados_1h`,
    [evento],
  )) ?? { enviados_24h: 0, enviados_1h: 0 };

  const restante = Math.max(0, limiteDia - v.enviados_24h);
  const base = {
    enviados24h: v.enviados_24h,
    enviados1h: v.enviados_1h,
    limiteDia,
    limiteHora,
    restante,
  };

  if (v.enviados_24h + aEnviar > limiteDia) {
    return {
      ...base,
      liberado: false,
      motivo:
        `Limite diário de ${limiteDia} mensagens em ${evento}: ${v.enviados_24h} já saíram nas últimas 24h e você quer enviar mais ${aEnviar}. ` +
        (restante > 0 ? `Sobram ${restante} hoje.` : "Não sobra nenhuma hoje."),
    };
  }
  if (v.enviados_1h + aEnviar > limiteHora) {
    return {
      ...base,
      liberado: false,
      motivo:
        `Limite de ${limiteHora} mensagens por hora em ${evento}: ${v.enviados_1h} saíram na última hora e você quer enviar mais ${aEnviar}. ` +
        `Espere um pouco e dispare em levas menores.`,
    };
  }
  return { ...base, liberado: true };
}
