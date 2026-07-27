"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { MarcaPortal } from "@/app/_components/marca";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { useMe } from "@/app/_components/use-me";

// Config de equipes do HM (0140) — só para quem vê tudo (GP/admin). Aqui o ADM
// geral define quem é de qual equipe, o cargo (operador normal x de disparos), a
// cor/nome da equipe e quais canais de aquisição caem direto para cada equipe.

type Papel = "admin" | "disparador" | "operador";
type Equipe = { id: string; nome: string; tipo: "principal" | "comum"; cor: string; ativo: boolean; membros: number };
type Usuario = { id: string; nome: string; email: string; papel: Papel; ativo: boolean; equipe_id: string | null };
type Rota = { canal: string; equipe_id: string; equipe_nome: string; equipe_cor: string };

const LABEL_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  disparador: "Operador de disparos",
  operador: "Operador",
};

export default function HmEquipesPage() {
  const { me, podeVerTudo } = useMe();
  const [equipes, setEquipes] = useState<Equipe[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [novaCor, setNovaCor] = useState("#0d9488");
  const [rotaCanal, setRotaCanal] = useState("");
  const [rotaEquipe, setRotaEquipe] = useState("");

  const podeConfig = me ? podeVerTudo() : null;

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [re, rr] = await Promise.all([fetch("/api/hm/equipes"), fetch("/api/hm/equipes/rotas")]);
      const de = await re.json();
      if (de.ok) { setEquipes(de.equipes); setUsuarios(de.usuarios); }
      const dr = await rr.json();
      if (dr.ok) { setRotas(dr.rotas); setCanais(dr.canais); }
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { if (podeConfig) carregar(); else if (podeConfig === false) setCarregando(false); }, [podeConfig, carregar]);

  async function criarEquipe() {
    const nome = novoNome.trim();
    if (nome.length < 2) return;
    const r = await fetch("/api/hm/equipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, cor: novaCor }) });
    const d = await r.json();
    if (!d.ok) { alert(d.reason === "nome_em_uso" ? "Já existe uma equipe com esse nome." : "Não foi possível criar."); return; }
    setNovoNome("");
    await carregar();
  }

  async function patchEquipe(id: string, payload: Record<string, unknown>) {
    const r = await fetch(`/api/hm/equipes/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível atualizar."); return; }
    await carregar();
  }

  async function membro(id: string, usuario_id: string, acao: "vincular" | "remover", papel?: Papel) {
    const r = await fetch(`/api/hm/equipes/${id}/membros`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario_id, acao, papel }) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível atualizar o membro."); return; }
    await carregar();
  }

  async function salvarRota(canal: string, equipe_id: string | null) {
    const r = await fetch("/api/hm/equipes/rotas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal, equipe_id }) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível salvar a rota."); return; }
    await carregar();
  }

  if (podeConfig === false) {
    return (
      <PageFade>
        <EmptyState title="Acesso restrito" description="Só o Grupo Participa (ou um administrador) gerencia as equipes." />
      </PageFade>
    );
  }

  return (
    <PageFade>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal="hm" altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Equipes · Holding Masters</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Quem é de cada equipe, o cargo de cada um e quais canais caem direto para cada equipe.
          </p>
        </div>
        <HmVisao atual="equipes" filtros={{}} podeConfig />
      </div>

      {carregando ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Equipes + membros */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">Equipes e membros</h2>
            <div className="space-y-4">
              {equipes.map((eq) => (
                <div key={eq.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={eq.cor}
                      onChange={(e) => patchEquipe(eq.id, { cor: e.target.value })}
                      title="Cor da equipe (borda/selo do card)"
                      className="h-6 w-6 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent dark:border-slate-600"
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-100">{eq.nome}</span>
                    {eq.tipo === "principal" && (
                      <span className="rounded bg-indigo-100 px-1.5 py-px text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" title="Vê todos os cards de todas as equipes">
                        principal · vê tudo
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">{eq.membros} membro(s)</span>
                  </div>
                  {/* Membros desta equipe */}
                  <div className="mt-2 space-y-1">
                    {usuarios.filter((u) => u.equipe_id === eq.id).map((u) => (
                      <div key={u.id} className="flex items-center gap-2 text-sm">
                        <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{u.nome}</span>
                        <select
                          value={u.papel}
                          onChange={(e) => membro(eq.id, u.id, "vincular", e.target.value as Papel)}
                          className={cn(fieldClass, "h-7 w-auto py-0 text-xs")}
                          title="Cargo do membro"
                        >
                          <option value="operador">Operador</option>
                          <option value="disparador">Operador de disparos</option>
                          <option value="admin">Administrador</option>
                        </select>
                        <button onClick={() => membro(eq.id, u.id, "remover")} className="text-xs text-slate-400 hover:text-rose-500" title="Tirar da equipe">remover</button>
                      </div>
                    ))}
                    {usuarios.filter((u) => u.equipe_id === eq.id).length === 0 && (
                      <p className="text-xs text-slate-400">Sem membros ainda.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Sem equipe → atribuir */}
            {usuarios.some((u) => u.ativo && !u.equipe_id) && (
              <div className="mt-4 rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
                <p className="mb-2 text-xs font-medium text-slate-500">Sem equipe</p>
                <div className="space-y-1">
                  {usuarios.filter((u) => u.ativo && !u.equipe_id).map((u) => (
                    <div key={u.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">{u.nome} <span className="text-xs text-slate-400">· {LABEL_PAPEL[u.papel]}</span></span>
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) membro(e.target.value, u.id, "vincular"); }}
                        className={cn(fieldClass, "h-7 w-auto py-0 text-xs")}
                      >
                        <option value="">Adicionar à equipe…</option>
                        {equipes.map((eq) => <option key={eq.id} value={eq.id}>{eq.nome}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Criar equipe comum */}
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <input type="color" value={novaCor} onChange={(e) => setNovaCor(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent dark:border-slate-600" />
              <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome da nova equipe" className={cn(fieldClass, "flex-1")} />
              <Button onClick={criarEquipe} disabled={novoNome.trim().length < 2}>Criar equipe</Button>
            </div>
          </Card>

          {/* Rotas canal → equipe */}
          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Roteamento de canais</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Um canal roteado cai direto na equipe (o card nasce dela, sem passar pelo pool aberto).
            </p>
            <div className="space-y-1">
              {rotas.map((r) => (
                <div key={r.canal} className="flex items-center gap-2 text-sm">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: r.equipe_cor }} />
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">{r.canal}</span>
                  <span className="text-xs text-slate-400">→ {r.equipe_nome}</span>
                  <button onClick={() => salvarRota(r.canal, null)} className="text-xs text-slate-400 hover:text-rose-500" title="Remover rota">remover</button>
                </div>
              ))}
              {rotas.length === 0 && <p className="text-xs text-slate-400">Nenhum canal roteado.</p>}
            </div>

            {/* Nova rota */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <select value={rotaCanal} onChange={(e) => setRotaCanal(e.target.value)} className={cn(fieldClass, "flex-1")}>
                <option value="">Canal…</option>
                {canais.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={rotaEquipe} onChange={(e) => setRotaEquipe(e.target.value)} className={cn(fieldClass, "w-auto")}>
                <option value="">Equipe…</option>
                {equipes.map((eq) => <option key={eq.id} value={eq.id}>{eq.nome}</option>)}
              </select>
              <Button
                onClick={() => { if (rotaCanal && rotaEquipe) { salvarRota(rotaCanal, rotaEquipe); setRotaCanal(""); setRotaEquipe(""); } }}
                disabled={!rotaCanal || !rotaEquipe}
              >
                Rotear
              </Button>
            </div>
          </Card>
        </div>
      )}
    </PageFade>
  );
}
