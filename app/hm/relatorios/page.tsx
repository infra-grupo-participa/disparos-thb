"use client";

import { useEffect, useMemo, useState } from "react";
import { MarcaPortal } from "@/app/_components/marca";
import { Button, Card, EmptyState, Spinner, fieldClass, cn } from "@/app/_components/ui";
import { Callout } from "@/app/_components/ui-base";
import { toast } from "@/app/_components/toast";
import { msgErroCarregamento } from "@/app/_components/use-me";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import type { DefinicaoRelatorio } from "@/lib/relatorios/tipos";

// Aba de Relatórios (F5, 16/08): dropdown de tipos + período + Gerar. O dropdown vem SEMPRE de
// GET /api/relatorios — zero lista de tipo hardcoded aqui. Acrescentar um relatório novo no
// backend (1 arquivo + 1 linha em lib/relatorios/registry.ts) faz ele aparecer aqui sozinho,
// sem tocar esta tela. A folha em si é outra rota (/relatorio/[protocolo]), aberta em aba nova.

type TipoRelatorio = Pick<DefinicaoRelatorio, "id" | "nome" | "descricao" | "params">;

type Atalho = "hoje" | "7d" | "30d" | "mes_passado" | "personalizado";
const ATALHOS: { id: Atalho; rotulo: string }[] = [
  { id: "hoje", rotulo: "Hoje" },
  { id: "7d", rotulo: "7 dias" },
  { id: "30d", rotulo: "30 dias" },
  { id: "mes_passado", rotulo: "Mês passado" },
  { id: "personalizado", rotulo: "Personalizado" },
];

function isoHoje(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDiasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoMesPassado(): { de: string; ate: string } {
  const hoje = new Date();
  const de = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const ate = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
  return { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) };
}

/** Resolve o atalho escolhido em {de, ate} — null quando o recorte ainda não está completo
 *  (personalizado sem as duas datas), para o botão Gerar ficar desabilitado em vez de mandar
 *  período pela metade. */
function periodoDoAtalho(atalho: Atalho, deCustom: string, ateCustom: string): { de: string; ate: string } | null {
  if (atalho === "hoje") { const h = isoHoje(); return { de: h, ate: h }; }
  if (atalho === "7d") return { de: isoDiasAtras(6), ate: isoHoje() };
  if (atalho === "30d") return { de: isoDiasAtras(29), ate: isoHoje() };
  if (atalho === "mes_passado") return isoMesPassado();
  if (!deCustom || !ateCustom || deCustom > ateCustom) return null;
  return { de: deCustom, ate: ateCustom };
}

export default function RelatoriosPage() {
  const { produto, portal, nome: nomePortal } = useProdutoHm();

  const [tipos, setTipos] = useState<TipoRelatorio[] | null>(null);
  const [erroCarregar, setErroCarregar] = useState<number | "rede" | null>(null);

  const [tipoId, setTipoId] = useState<string>("");
  const [atalho, setAtalho] = useState<Atalho>("30d");
  const [deCustom, setDeCustom] = useState("");
  const [ateCustom, setAteCustom] = useState("");

  const [gerando, setGerando] = useState(false);
  const [erroGerar, setErroGerar] = useState<string | null>(null);
  const [emitido, setEmitido] = useState<{ protocolo: string; linhas: number } | null>(null);

  useEffect(() => {
    let cancelado = false;
    setTipos(null);
    setErroCarregar(null);
    fetch(`/api/relatorios?produto=${produto}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (cancelado) return;
        if (!d.ok) { setErroCarregar(0); return; }
        setTipos(d.tipos);
        setTipoId((atual) => atual || d.tipos[0]?.id || "");
      })
      .catch((status) => { if (!cancelado) setErroCarregar(typeof status === "number" ? status : "rede"); });
    return () => { cancelado = true; };
  }, [produto]);

  const tipo = useMemo(() => tipos?.find((t) => t.id === tipoId) ?? null, [tipos, tipoId]);
  const exigePeriodo = !!tipo?.params.includes("periodo");
  const periodo = useMemo(() => periodoDoAtalho(atalho, deCustom, ateCustom), [atalho, deCustom, ateCustom]);
  const podeGerar = !!tipo && (!exigePeriodo || !!periodo) && !gerando;

  async function gerar() {
    if (!tipo || !podeGerar) return;
    setGerando(true);
    setErroGerar(null);
    setEmitido(null);
    try {
      const sp = new URLSearchParams({ produto });
      if (exigePeriodo && periodo) { sp.set("de", periodo.de); sp.set("ate", periodo.ate); }
      const r = await fetch(`/api/relatorios/${tipo.id}?${sp.toString()}`, { method: "POST" });
      const d = await r.json().catch(() => ({ ok: false }));
      if (!r.ok || !d.ok) {
        const msg =
          d.reason === "sem_permissao" ? "Sua conta não pode gerar este relatório."
          : d.reason === "periodo_obrigatorio" ? "Escolha um período válido."
          : d.reason === "data_invalida" ? "Período inválido."
          : "Não foi possível gerar o relatório. Tente de novo em instantes.";
        setErroGerar(msg);
        toast(msg, "erro");
        return;
      }
      setEmitido({ protocolo: d.protocolo, linhas: d.linhas });
      toast(`Relatório emitido — protocolo ${d.protocolo}`);
      window.open(`/relatorio/${d.protocolo}`, "_blank", "noopener,noreferrer");
    } catch {
      setErroGerar(msgErroCarregamento());
    } finally {
      setGerando(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2.5">
        <MarcaPortal portal={portal} altura="h-7" comNome={false} />
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Relatórios · {nomePortal}</h1>
      </div>

      <Card className="max-w-2xl p-5">
        {erroCarregar !== null ? (
          <EmptyState
            title="Não foi possível carregar os tipos de relatório"
            description={typeof erroCarregar === "number" && erroCarregar > 0 ? msgErroCarregamento(erroCarregar) : msgErroCarregamento()}
          />
        ) : tipos === null ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-400"><Spinner /> carregando tipos de relatório…</div>
        ) : tipos.length === 0 ? (
          <EmptyState
            title="Nenhum relatório disponível para sua conta neste portal"
            description="Fale com um gestor ou o administrador do Grupo Participa se acha que deveria ter acesso."
          />
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="tipo-relatorio" className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                Tipo de relatório
              </label>
              <select
                id="tipo-relatorio"
                className={fieldClass}
                value={tipoId}
                onChange={(e) => { setTipoId(e.target.value); setEmitido(null); setErroGerar(null); }}
              >
                {tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
              {tipo?.descricao && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{tipo.descricao}</p>}
            </div>

            {exigePeriodo && (
              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">Período</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Atalho de período">
                  {ATALHOS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={atalho === a.id}
                      onClick={() => setAtalho(a.id)}
                      className={cn(
                        "alvo-toque rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                        atalho === a.id
                          ? "border-brand bg-brand/10 text-brand-700 dark:border-brand-400 dark:bg-brand-400/10 dark:text-brand-200"
                          : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                      )}
                    >
                      {a.rotulo}
                    </button>
                  ))}
                </div>

                {atalho === "personalizado" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor="periodo-de">De</label>
                    <input id="periodo-de" type="date" className={cn(fieldClass, "w-auto")} value={deCustom} max={ateCustom || undefined}
                      onChange={(e) => setDeCustom(e.target.value)} />
                    <span className="text-xs text-slate-400">até</span>
                    <label className="sr-only" htmlFor="periodo-ate">Até</label>
                    <input id="periodo-ate" type="date" className={cn(fieldClass, "w-auto")} value={ateCustom} min={deCustom || undefined}
                      onChange={(e) => setAteCustom(e.target.value)} />
                  </div>
                ) : (
                  periodo && (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(`${periodo.de}T00:00:00`).toLocaleDateString("pt-BR")} até {new Date(`${periodo.ate}T00:00:00`).toLocaleDateString("pt-BR")}
                    </p>
                  )
                )}
                {atalho === "personalizado" && !periodo && (deCustom || ateCustom) && (
                  <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">Escolha as duas datas — a data final não pode vir antes da inicial.</p>
                )}
              </div>
            )}

            {erroGerar && (
              <Callout titulo="Não gerou" tom="bloqueio">{erroGerar}</Callout>
            )}

            {emitido && !erroGerar && (
              <Callout titulo={`Protocolo ${emitido.protocolo}`} tom="positivo">
                {emitido.linhas === 0
                  ? "Nenhum dado encontrado no período — a folha abriu numa aba nova e explica o motivo."
                  : `Abriu numa aba nova. Se o navegador bloqueou o popup, `}
                {emitido.linhas > 0 && (
                  <a href={`/relatorio/${emitido.protocolo}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                    clique aqui para abrir
                  </a>
                )}
                {emitido.linhas === 0 && (
                  <>
                    {" "}
                    <a href={`/relatorio/${emitido.protocolo}`} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                      Abrir de novo
                    </a>
                  </>
                )}
              </Callout>
            )}

            <div className="flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
              <Button onClick={gerar} disabled={!podeGerar}>
                {gerando ? (<><Spinner className="text-white" /> Gerando…</>) : "Gerar relatório"}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
