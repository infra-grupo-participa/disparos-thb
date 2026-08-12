"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";
import { useMe, msgErroPermissao, msgErroCarregamento } from "@/app/_components/use-me";

type Disparo = {
  id: string; status: string; fase: string | null; operador: string | null; edicao: string | null;
  iniciado_em: string | null; concluido_em: string | null; processando_em: string | null;
  template_nome: string | null;
  total: number; enviados: number; pendentes: number; erros: number; respondidos: number;
  entregue: number; lido: number; so_enviado: number; falha_entrega: number; nao_chegaram: number;
  travado: boolean;
};

const fmtData = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

// Como o disparo se apresenta ao operador: rótulo humano + cor. "Travado" não é um
// status no banco (é 'em_andamento' sem processo vivo) mas é o que importa aqui —
// é o único estado em que o botão Retomar aparece.
function situacao(d: Disparo): { label: string; tom: string } {
  if (d.status === "em_andamento" && d.travado) return { label: "Parado no meio", tom: "rose" };
  if (d.status === "em_andamento") return { label: "Enviando…", tom: "brand" };
  if (d.status === "erro") return { label: "Falhou", tom: "rose" };
  if (d.pendentes > 0) return { label: "Incompleto", tom: "amber" };
  return { label: "Concluído", tom: "emerald" };
}
const TOM_BADGE: Record<string, string> = {
  rose: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  brand: "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};
const TOM_BARRA: Record<string, string> = {
  rose: "bg-rose-500", brand: "bg-brand", amber: "bg-amber-500", emerald: "bg-emerald-500",
};

export default function DisparosPage() {
  const { evento, base } = usePortal();
  const { podeDisparar } = useMe();
  const [disparos, setDisparos] = useState<Disparo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [retomando, setRetomando] = useState<string | null>(null);
  const [atualizandoEntrega, setAtualizandoEntrega] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Falha de rede × erro do servidor na carga inicial: antes ficavam mudas e
  // a tela caía no "Nenhum disparo ainda" — igual a uma base vazia de verdade.
  const [erro, setErro] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/disparos?evento=${evento}`);
      if (!r.ok) { setErro(msgErroCarregamento(r.status)); return; }
      const d = await r.json();
      if (d.ok) { setDisparos(d.disparos as Disparo[]); setErro(null); }
      else setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar os disparos.");
    } catch {
      setErro(msgErroCarregamento());
    } finally { setCarregando(false); }
  }, [evento]);

  useEffect(() => { carregar(); }, [carregar]);

  // Auto-atualiza enquanto houver campanha em movimento — a barra de progresso
  // anda sozinha, como o operador espera ao ver "Enviando…". Para quando tudo
  // assenta, para não bater no servidor à toa.
  // Também pausa com a aba em segundo plano: campanha longa com a aba esquecida
  // aberta batia a cada 6s sem ninguém acompanhando. Volta a atualizar (e recarrega
  // na hora) assim que o operador retorna para a aba.
  const temAtivo = disparos.some((d) => d.status === "em_andamento");
  useEffect(() => {
    if (timer.current) clearInterval(timer.current);
    if (temAtivo) {
      timer.current = setInterval(() => {
        if (!document.hidden) carregar();
      }, 6000);
    }
    const aoVoltar = () => {
      if (temAtivo && !document.hidden) carregar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      if (timer.current) clearInterval(timer.current);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [temAtivo, carregar]);

  async function retomar(d: Disparo) {
    setRetomando(d.id); setAviso(null);
    try {
      const r = await fetch(`/api/disparos/${d.id}/retomar?evento=${evento}`, { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        setAviso(`Retomado — enviando os ${j.pendentes} que faltavam. A barra vai andar aqui.`);
        await carregar();
      } else {
        setAviso(j.reason || "Não foi possível retomar. Tente de novo em instantes.");
      }
    } catch {
      setAviso("Falha de conexão ao retomar. Tente novamente.");
    } finally {
      setRetomando(null);
    }
  }

  // Consulta a entrega real (Meta) dos contatos deste disparo e recarrega a lista.
  async function atualizarEntrega(d: Disparo) {
    setAtualizandoEntrega(d.id); setAviso(null);
    try {
      await fetch(`/api/disparos/${d.id}/status`, { method: "POST" });
      await carregar();
    } catch {
      setAviso("Falha ao consultar a entrega. Tente de novo.");
    } finally {
      setAtualizandoEntrega(null);
    }
  }

  // Reenvia SÓ os que não chegaram (nunca saíram + falha de entrega). Confirma
  // antes: é envio real de WhatsApp para pessoas.
  async function reenviarCaidos(d: Disparo) {
    if (!window.confirm(`Reenviar para os ${d.nao_chegaram} lead(s) que não receberam (nunca enviados + falha de entrega)? Quem já recebeu não será incomodado.`)) return;
    setReenviando(d.id); setAviso(null);
    try {
      const r = await fetch(`/api/disparos/${d.id}/reenviar-caidos?evento=${evento}`, { method: "POST" });
      const j = await r.json();
      if (j.ok) {
        setAviso(`Reenviando para ${j.reenviando} lead(s) que não chegaram. Acompanhe a barra.`);
        await carregar();
      } else {
        setAviso(j.reason || "Não foi possível reenviar agora.");
      }
    } catch {
      setAviso("Falha de conexão ao reenviar.");
    } finally {
      setReenviando(null);
    }
  }

  const pode = podeDisparar(evento);

  return (
    <PageFade>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Disparos</h1>
        <span className="text-sm text-slate-400 dark:text-slate-500">histórico das campanhas — acompanhe e retome o que travou</span>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={carregar}>Atualizar</Button>
      </div>

      {aviso && (
        <div className="mb-4 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 text-sm text-brand-700 dark:border-brand-400/20 dark:bg-brand-400/5 dark:text-brand-300">
          {aviso}
        </div>
      )}
      {/* Erro com lista já carregada (ex.: recarga em background falhou): avisa
          sem trocar a lista inteira por uma tela de erro. */}
      {erro && disparos.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300" role="alert">
          <span>{erro}</span>
          <Button variant="secondary" size="sm" className="shrink-0" onClick={carregar}>Tentar de novo</Button>
        </div>
      )}

      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500 dark:text-slate-400"><Spinner /> Carregando…</div>
      ) : erro && disparos.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={
              <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            }
            title="Não foi possível carregar os disparos"
            description={erro}
            action={<Button variant="secondary" size="sm" onClick={carregar}>Tentar de novo</Button>}
          />
        </Card>
      ) : disparos.length === 0 ? (
        <Card className="p-4"><EmptyState title="Nenhum disparo ainda" description="Quando você enviar uma campanha pelo Kanban, ela aparece aqui com o progresso." /></Card>
      ) : (
        <div className="space-y-3">
          {disparos.map((d) => {
            const s = situacao(d);
            const pct = d.total > 0 ? Math.round((d.enviados / d.total) * 100) : 0;
            const podeRetomar = pode && d.pendentes > 0 && d.status !== "em_andamento" ? true : pode && d.travado;
            return (
              <Card key={d.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", TOM_BADGE[s.tom])}>{s.label}</span>
                      <span className="truncate font-semibold text-slate-900 dark:text-slate-100">{d.template_nome || "Template removido"}</span>
                      <EdicaoBadge edicao={d.edicao} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {fmtData(d.iniciado_em)}
                      {d.operador ? <span className="text-slate-300 dark:text-slate-600"> · por {d.operador}</span> : null}
                      {d.status === "em_andamento" && !d.travado ? <span className="text-brand"> · em andamento</span> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`${base}/inbox?disparo=${d.id}`}>
                      <Button variant="secondary" size="sm">Ver conversas</Button>
                    </Link>
                    {podeRetomar && (
                      <Button size="sm" onClick={() => retomar(d)} disabled={retomando === d.id}>
                        {retomando === d.id ? (<><Spinner className="text-white" /> Retomando…</>) : `Retomar (${d.pendentes})`}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Barra de progresso: enviados / total */}
                <div className="mt-3">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className={cn("h-full rounded-full transition-all", TOM_BARRA[s.tom])} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                    <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">{d.enviados}/{d.total} enviados</span>
                    {d.pendentes > 0 && <span className="tabular-nums text-amber-600 dark:text-amber-400">{d.pendentes} faltando</span>}
                    {d.respondidos > 0 && <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{d.respondidos} responderam</span>}
                    {d.erros > 0 && <span className="tabular-nums text-rose-600 dark:text-rose-400">{d.erros} com erro</span>}
                  </div>

                  {/* Entrega real (Meta) — só aparece quando já foi sincronizada */}
                  {(d.entregue + d.lido + d.so_enviado + d.falha_entrega) > 0 && (
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Entrega:</span>
                      {d.lido > 0 && <span className="tabular-nums text-blue-600 dark:text-blue-300">{d.lido} lidos ✓✓</span>}
                      {d.entregue > 0 && <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{d.entregue} entregues ✓✓</span>}
                      {d.so_enviado > 0 && <span className="tabular-nums text-slate-500 dark:text-slate-400" title="Enviado ao WhatsApp, entrega ainda não confirmada">{d.so_enviado} enviados ✓</span>}
                      {d.falha_entrega > 0 && <span className="tabular-nums text-rose-600 dark:text-rose-400">{d.falha_entrega} falha de entrega ✗</span>}
                    </div>
                  )}
                </div>

                {/* Barra de ações de resultado */}
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Button variant="ghost" size="sm" onClick={() => atualizarEntrega(d)} disabled={atualizandoEntrega === d.id}>
                    {atualizandoEntrega === d.id ? (<><Spinner className="h-3.5 w-3.5" /> Consultando…</>) : "Atualizar entrega"}
                  </Button>
                  {/* Reenvio só quando o disparo já parou (travado usa o Retomar acima) */}
                  {pode && d.nao_chegaram > 0 && !d.travado && d.status !== "em_andamento" && (
                    <Button variant="secondary" size="sm" onClick={() => reenviarCaidos(d)} disabled={reenviando === d.id || retomando === d.id}>
                      {reenviando === d.id ? (<><Spinner className="h-3.5 w-3.5" /> Reenviando…</>) : `Reenviar os ${d.nao_chegaram} que não chegaram`}
                    </Button>
                  )}
                </div>

                {d.travado && (
                  <p className="mt-2 rounded-lg bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                    Esta campanha parou no meio (o envio foi interrompido).{pode ? " Clique em Retomar para enviar o restante." : " Peça a um disparador para retomar."}
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </PageFade>
  );
}
