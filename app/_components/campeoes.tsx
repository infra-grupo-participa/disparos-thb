"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type WaCampeao = { template: string; enviados: number; respondidos: number };
type EmailCampeao = { nome: string; enviados: number; aberturas_unicas: number; cliques_unicos: number; enviada_em: string | null };

const taxa = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);
const fmt = (n: number) => n.toLocaleString("pt-BR");

// Campeões: templates/campanhas que mais engajam, por canal. Engajamento é o
// proxy disponível hoje (resposta no WhatsApp, abertura no e-mail); a conversão
// por funil entra quando houver atribuição. Dados de /api/dashboard/campeoes.
export function Campeoes({ desde, ate, edicao }: { desde?: string; ate?: string; edicao?: string }) {
  const { evento } = usePortal();
  const [wa, setWa] = useState<WaCampeao[]>([]);
  const [email, setEmail] = useState<EmailCampeao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const params = new URLSearchParams({ evento });
    if (desde) params.set("desde", new Date(`${desde}T00:00:00`).toISOString());
    if (ate) params.set("ate", new Date(`${ate}T23:59:59`).toISOString());
    if (edicao) params.set("edicao", edicao);
    try {
      const r = await fetch(`/api/dashboard/campeoes?${params.toString()}`);
      const d = await r.json();
      if (d.ok) { setWa(d.whatsapp ?? []); setEmail(d.email ?? []); }
    } catch {
      /* mantém anterior */
    } finally {
      setCarregando(false);
    }
  }, [evento, desde, ate, edicao]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) {
    return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400 dark:border-slate-800 dark:bg-slate-900"><Spinner /> Apurando campeões…</div>;
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Ranking por <strong className="font-medium text-slate-500 dark:text-slate-400">engajamento</strong> (WhatsApp: taxa de resposta · E-mail: taxa de abertura). Conversão por funil entra quando houver atribuição por contato.
      </p>

      {/* WhatsApp */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span className="h-3.5 w-1 rounded-full bg-emerald-500" aria-hidden="true" />
          Templates de WhatsApp · taxa de resposta
        </div>
        {wa.length === 0 ? (
          <EmptyState title="Sem dados suficientes" description="Os templates campeões aparecem aqui após disparos com volume mínimo." />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {wa.map((t, i) => (
                <Linha key={t.template} pos={i} titulo={t.template}
                  destaque={`${taxa(t.respondidos, t.enviados)}%`}
                  sub={`${fmt(t.respondidos)} resp. de ${fmt(t.enviados)} enviados`}
                  barra={taxa(t.respondidos, t.enviados)} tom="emerald" />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {/* E-mail */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span className="h-3.5 w-1 rounded-full bg-sky-500" aria-hidden="true" />
          Campanhas de e-mail · taxa de abertura
        </div>
        {email.length === 0 ? (
          <EmptyState title="Sem campanhas de e-mail" description="Rode “Atualizar do AC” na aba E-mail para popular as campanhas do ActiveCampaign." />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {email.map((c, i) => (
                <Linha key={c.nome + i} pos={i} titulo={c.nome}
                  destaque={`${taxa(c.aberturas_unicas, c.enviados)}%`}
                  sub={`${fmt(c.aberturas_unicas)} aberturas · ${taxa(c.cliques_unicos, c.aberturas_unicas)}% clique · ${fmt(c.enviados)} env.`}
                  barra={taxa(c.aberturas_unicas, c.enviados)} tom="sky" />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

const MEDALHA = ["🥇", "🥈", "🥉"];

function Linha({ pos, titulo, destaque, sub, barra, tom }: {
  pos: number; titulo: string; destaque: string; sub: string; barra: number; tom: "emerald" | "sky";
}) {
  const cor = tom === "emerald" ? "bg-emerald-500" : "bg-sky-500";
  const txt = tom === "emerald" ? "text-emerald-600 dark:text-emerald-400" : "text-sky-600 dark:text-sky-400";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="w-6 shrink-0 text-center text-sm tabular-nums text-slate-400 dark:text-slate-500">{MEDALHA[pos] ?? pos + 1}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200" title={titulo}>{titulo}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{sub}</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={cn("h-full rounded-full", cor)} style={{ width: `${Math.max(2, Math.min(100, barra))}%` }} />
        </div>
      </div>
      <span className={cn("shrink-0 text-lg font-semibold tabular-nums", txt)}>{destaque}</span>
    </li>
  );
}
