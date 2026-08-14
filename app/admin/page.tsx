"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, PageHeader, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { Avatar } from "@/app/_components/avatar";
// Só o TIPO — a mesma regra do app/admin/alertas/page.tsx: nunca importar do
// service (puxaria lib/db/pg pro bundle do navegador), só o arquivo puro.
import type { Alerta } from "@/lib/alertas-catalogo";

// Central de administração (28/07, redesenho 13/08). Pedido do Marcio: "isso
// na parte de administração está muito confuso... organiza e deixa amigável.
// Bota ícones." Os quatro cards tinham o MESMO peso visual — mas só um deles é
// acionável de verdade (Saúde do dinheiro: se tem alerta crítico aberto, é
// trabalho pendente HOJE); os outros três são tela de configuração, que se
// olha quando precisa mudar algo, não todo dia. A hierarquia agora É a
// diferença: "precisa de ação" em cima, com o número real; "ajustes" embaixo,
// mais discreto; o formulário de vínculo — que não é nem alerta nem atalho,
// é uma ferramenta que mora nesta página mesmo — no seu próprio bloco.
//
// API (/api/hm/equipes/usuario-canais) do vínculo já existia (0154). O que é
// novo aqui: contagem de críticos vem de GET /api/hm/alertas (mesma rota que
// /admin/alertas usa, guard master) — SEM contador disponível (erro de rede,
// 403 de sessão) o card não estampa um "0" mentiroso: cai num estado neutro
// "Abrir para conferir".

type Vinculo = { usuario_id: string; canal: string; usuario_nome: string };
type Usuario = { id: string; nome: string; email: string; ativo: boolean };

const AJUSTES = [
  { href: "/usuarios", titulo: "Contas e portais", desc: "Quem acessa o sistema e a quais portais (HT, HM, Aurum, ETHB…).", Icon: IconeContas },
  { href: "/hm/equipes", titulo: "Equipes", desc: "Composição, líderes, cores e rotas de canal → equipe.", Icon: IconeEquipes },
  { href: "/canais", titulo: "Canais de disparo", desc: "Credenciais de WhatsApp por evento, por portal.", Icon: IconeCanais },
];

function IconePulso({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  );
}
function IconeContas({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8.5" cy="12" r="2.2" /><path d="M6 16.3c.5-1.4 1.4-2.1 2.5-2.1s2 .7 2.5 2.1M14 10h4M14 14h3" />
    </svg>
  );
}
function IconeEquipes({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="8" r="3" /><path d="M3.5 19c.6-3 2.6-4.5 5.5-4.5s4.9 1.5 5.5 4.5" />
      <circle cx="17.5" cy="8.5" r="2.3" /><path d="M15.8 14.2c2.2.4 3.6 1.8 4.1 3.8" />
    </svg>
  );
}
function IconeCanais({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2.2" /><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
    </svg>
  );
}
function IconeVinculo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 15 15 9" /><path d="M10.5 6.5 12 5a3.5 3.5 0 0 1 5 5l-1.5 1.5M13.5 17.5 12 19a3.5 3.5 0 0 1-5-5l1.5-1.5" />
    </svg>
  );
}
function IconeSeta({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>;
}

export default function AdminPage() {
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoUsuario, setNovoUsuario] = useState("");
  const [novoCanal, setNovoCanal] = useState("");

  // Contagem real de críticos abertos — só estampa número quando o servidor
  // respondeu de fato. `null` = ainda não sabe (não é "zero").
  const [criticos, setCriticos] = useState<number | null>(null);
  const [erroAlertas, setErroAlertas] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [rc, ru] = await Promise.all([
        fetch("/api/hm/equipes/usuario-canais"),
        fetch("/api/usuarios"),
      ]);
      const dc = await rc.json();
      if (dc.ok) { setVinculos(dc.vinculos); setCanais(dc.canais); }
      const du = await ru.json();
      if (du.ok) setUsuarios((du.usuarios as Usuario[]).filter((u) => u.ativo));
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch("/api/hm/alertas");
        if (!r.ok) { if (vivo) setErroAlertas(true); return; }
        const d = await r.json();
        if (!d.ok) { if (vivo) setErroAlertas(true); return; }
        const n = (d.alertas as Alerta[]).filter((a) => a.severidade === "critico").length;
        if (vivo) setCriticos(n);
      } catch {
        if (vivo) setErroAlertas(true);
      }
    })();
    return () => { vivo = false; };
  }, []);

  async function salvarVinculo(usuario_id: string, canal: string, acao: "vincular" | "remover") {
    const r = await fetch("/api/hm/equipes/usuario-canais", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id, canal, acao }),
    });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível salvar o vínculo."); return; }
    await carregar();
  }

  // Agrupa os vínculos por pessoa, para a lista ficar legível ("Fulano cuida de X, Y").
  const porUsuario = new Map<string, { nome: string; canais: string[] }>();
  for (const v of vinculos) {
    const at = porUsuario.get(v.usuario_id) ?? { nome: v.usuario_nome, canais: [] };
    at.canais.push(v.canal);
    porUsuario.set(v.usuario_id, at);
  }

  return (
    <PageFade>
      <PageHeader
        title="Administração"
        description="Um lugar só para gerir o sistema — contas, equipes, canais e acessos — independente do portal."
      />

      {/* Precisa de ação: só a Saúde do dinheiro é isso — os outros três cards
          abaixo são configuração. A cor e o número fazem a diferença, não o
          texto: crítico aberto = rose (mesma trava de "pare e confira" do
          resto do sistema), zero crítico = esmeralda, sem contador = neutro. */}
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Precisa de ação</p>
      <Link href="/admin/alertas" className="mb-6 block">
        <Card
          className={cn(
            "p-4 transition hover:shadow-pop",
            criticos !== null && criticos > 0
              ? "border-rose-300 hover:border-rose-400 dark:border-rose-900/60 dark:hover:border-rose-800"
              : "hover:border-brand/40 dark:hover:border-brand-400/40",
          )}
        >
          <div className="flex flex-wrap items-center gap-4">
            <span
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-xl",
                criticos !== null && criticos > 0
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
              )}
            >
              <IconePulso className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Saúde do dinheiro</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Pagamento que entrou sem achar card, oferta fora do catálogo, cancelamento sem board — mais os cancelamentos vindos da Hotmart.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {criticos === null ? (
                erroAlertas ? (
                  <span className="text-xs font-medium text-slate-400">Abrir para conferir</span>
                ) : (
                  <Spinner className="h-4 w-4" />
                )
              ) : criticos > 0 ? (
                <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                  {criticos} crítico{criticos > 1 ? "s" : ""} aberto{criticos > 1 ? "s" : ""}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  Nenhum crítico aberto
                </span>
              )}
              <IconeSeta className="h-4 w-4 text-slate-400" />
            </div>
          </div>
        </Card>
      </Link>

      {/* Ajustes: configuração, não trabalho pendente — peso visual mais leve
          de propósito (ícone neutro, sem cor de estado, sem contador). */}
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Ajustes</p>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AJUSTES.map((a) => (
          <Link key={a.href} href={a.href}>
            <Card className="h-full p-4 transition hover:border-brand/40 hover:shadow-pop dark:hover:border-brand-400/40">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <a.Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.titulo}</h2>
                    <IconeSeta className="h-4 w-4 shrink-0 text-slate-300 dark:text-slate-600" />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{a.desc}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {/* Canal de aquisição → pessoa (0154) — não é atalho nem alerta, é uma
          ferramenta que mora nesta tela; ganha bloco e título próprios para
          não ler como um apêndice solto embaixo dos cards. */}
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Vínculo manual</p>
      <Card className="p-4">
        <div className="mb-3 flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
            <IconeVinculo className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Canal de aquisição → pessoa</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Quem <strong>cuida</strong> de cada canal. A pessoa passa a <strong>ver e trabalhar</strong> os cards com aquela tag (além do pool e dos cards dela), em qualquer equipe.
            </p>
          </div>
        </div>

        {carregando ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <>
            <div className="space-y-2">
              {[...porUsuario.entries()].map(([usuarioId, info]) => (
                <div key={usuarioId} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Avatar nome={info.nome} className="h-6 w-6 text-[10px]" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{info.nome}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {info.canais.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {c}
                        <button
                          onClick={() => salvarVinculo(usuarioId, c, "remover")}
                          className="alvo-toque text-slate-400 hover:text-rose-500"
                          title="Remover este canal desta pessoa"
                          aria-label={`Remover o canal ${c} de ${info.nome}`}
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {porUsuario.size === 0 && <p className="text-xs text-slate-400">Nenhum canal atribuído a ninguém ainda.</p>}
            </div>

            {/* Novo vínculo */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <select value={novoUsuario} onChange={(e) => setNovoUsuario(e.target.value)} className={cn(fieldClass, "flex-1")}>
                <option value="">Pessoa…</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <select value={novoCanal} onChange={(e) => setNovoCanal(e.target.value)} className={cn(fieldClass, "flex-1")}>
                <option value="">Canal…</option>
                {canais.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button
                onClick={() => { if (novoUsuario && novoCanal) { salvarVinculo(novoUsuario, novoCanal, "vincular"); setNovoUsuario(""); setNovoCanal(""); } }}
                disabled={!novoUsuario || !novoCanal}
              >
                Atribuir
              </Button>
            </div>
          </>
        )}
      </Card>
    </PageFade>
  );
}
