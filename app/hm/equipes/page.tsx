"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, Spinner, cn, fieldClass, fieldCompactClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { MarcaPortal } from "@/app/_components/marca";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { useMe } from "@/app/_components/use-me";
import { Avatar } from "@/app/_components/avatar";
import { SeloNivel } from "@/app/_components/selo-nivel";

// Equipes do HM (0140), em DOIS modos pelos níveis (lib/papeis):
//   • MASTER (admin do GP): gere tudo — membros, cargos, líderes, cores, rotas
//     de canal e criação de equipe.
//   • GESTOR (admin/líder de equipe comum): só VÊ a própria equipe — é como ele
//     sabe a quem pode distribuir. Nada de edição: composição é do master.
//   • Operador não entra (a rota e o menu já escondem).

type Papel = "admin" | "disparador" | "operador";
type Equipe = { id: string; nome: string; tipo: "principal" | "comum"; cor: string; ativo: boolean; membros: number };
type Usuario = { id: string; nome: string; email: string; papel: Papel; ativo: boolean; equipe_id: string | null; lider_equipe: boolean };
type Rota = { canal: string; equipe_id: string; equipe_nome: string; equipe_cor: string };

const LABEL_PAPEL: Record<Papel, string> = {
  admin: "Administrador",
  disparador: "Operador de disparos",
  operador: "Operador",
};


export default function HmEquipesPage() {
  const { me, ehMaster, podeDistribuir } = useMe();
  const { portal, nome: nomePortal } = useProdutoHm(); // marca e título do portal atual
  const [equipes, setEquipes] = useState<Equipe[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [novaCor, setNovaCor] = useState("#0d9488");
  const [rotaCanal, setRotaCanal] = useState("");
  const [rotaEquipe, setRotaEquipe] = useState("");
  const [equipePadrao, setEquipePadrao] = useState<string | null>(null);
  const [remover, setRemover] = useState<{ equipeId: string; usuario: Usuario } | null>(null);

  // Ver = master OU gestor (null enquanto carrega). Editar = SÓ master.
  const podeVer = me ? podeDistribuir() : null;
  const podeEditar = ehMaster();

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const re = await fetch("/api/hm/equipes");
      const de = await re.json();
      if (de.ok) { setEquipes(de.equipes); setUsuarios(de.usuarios); }
      // Rotas canal → equipe e equipe padrão são config global: só o master.
      if (podeEditar) {
        const [rr, rp] = await Promise.all([
          fetch("/api/hm/equipes/rotas"),
          fetch("/api/hm/equipes/padrao"),
        ]);
        const dr = await rr.json();
        if (dr.ok) { setRotas(dr.rotas); setCanais(dr.canais); }
        const dp = await rp.json();
        if (dp.ok) setEquipePadrao(dp.equipe_id ?? null);
      }
    } finally { setCarregando(false); }
  }, [podeEditar]);
  useEffect(() => { if (podeVer) carregar(); else if (podeVer === false) setCarregando(false); }, [podeVer, carregar]);

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

  async function membro(id: string, usuario_id: string, acao: "vincular" | "remover", papel?: Papel, lider_equipe?: boolean) {
    const r = await fetch(`/api/hm/equipes/${id}/membros`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario_id, acao, papel, lider_equipe }) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível atualizar o membro."); return; }
    await carregar();
  }

  async function salvarRota(canal: string, equipe_id: string | null, nomeEquipeAtual?: string) {
    // Remover rota afeta só as vendas QUE AINDA VÃO CHEGAR — os cards que já
    // nasceram na equipe não voltam. Vale um "tem certeza" com o efeito escrito.
    if (equipe_id === null && !confirm(`Remover a rota de "${canal}"? As próximas vendas desse canal deixam de cair direto em "${nomeEquipeAtual}" e passam pelo pool aberto.`)) return;
    const r = await fetch("/api/hm/equipes/rotas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ canal, equipe_id }) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível salvar a rota."); return; }
    await carregar();
  }

  async function salvarEquipePadrao(equipe_id: string | null) {
    setEquipePadrao(equipe_id); // otimista
    const r = await fetch("/api/hm/equipes/padrao", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ equipe_id }) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível salvar a equipe padrão."); await carregar(); }
  }

  if (podeVer === false) {
    return (
      <PageFade>
        <EmptyState title="Acesso restrito" description="Só gestores de equipe e administradores do Grupo Participa veem as equipes." />
      </PageFade>
    );
  }

  // O gestor só enxerga a PRÓPRIA equipe (defensivo — o servidor já recorta).
  const equipesVisiveis = podeEditar ? equipes : equipes.filter((eq) => eq.id === me?.equipe_id);

  return (
    <PageFade>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              {podeEditar ? `Equipes · ${nomePortal}` : `Minha equipe · ${nomePortal}`}
            </h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {podeEditar
              ? "Quem é de cada equipe, o cargo de cada um e quais canais caem direto para cada equipe."
              : "Quem faz parte da sua equipe — são as pessoas para quem você pode distribuir cards. A composição é gerida pelo Grupo Participa."}
          </p>
          {podeEditar && (
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Cargo decide o que a pessoa faz (quem dispara); a estrela decide quem lidera. Os dois, junto com a equipe, formam o selo de Nível ao lado do nome.
            </p>
          )}
        </div>
        <HmVisao atual="equipes" filtros={{}} podeConfig />
      </div>

      {carregando ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className={podeEditar ? "grid gap-4 lg:grid-cols-2" : "mx-auto max-w-2xl"}>
          {/* Equipes + membros */}
          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
              {podeEditar ? "Equipes e membros" : "Membros da equipe"}
            </h2>
            {!podeEditar && equipesVisiveis.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">Você ainda não está vinculado a uma equipe — fale com o Grupo Participa.</p>
            )}
            <div className="space-y-4">
              {equipesVisiveis.map((eq) => {
                const membrosEq = usuarios.filter((u) => u.equipe_id === eq.id);
                return (
                <div key={eq.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  {/* Cabeçalho da equipe: faixa na cor da equipe + nome + contagem */}
                  <div className="flex items-center gap-2 border-l-4 bg-slate-50 px-3 py-2 dark:bg-slate-800/40" style={{ borderLeftColor: eq.cor }}>
                    {podeEditar ? (
                      <input
                        type="color"
                        value={eq.cor}
                        onChange={(e) => patchEquipe(eq.id, { cor: e.target.value })}
                        title="Cor da equipe (borda e selo do card na Jornada)"
                        className="h-5 w-5 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent dark:border-slate-600"
                      />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded" style={{ backgroundColor: eq.cor }} title="Cor da equipe (borda e selo do card na Jornada)" />
                    )}
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{eq.nome}</span>
                    {eq.tipo === "principal" && (
                      <span className="rounded bg-indigo-100 px-1.5 py-px text-[10px] font-semibold uppercase text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" title="Equipe do Grupo Participa — o administrador dela (master) vê e gere tudo">
                        principal · GP
                      </span>
                    )}
                    <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400">
                      {membrosEq.length} {membrosEq.length === 1 ? "pessoa" : "pessoas"}
                    </span>
                  </div>
                  {/* Membros desta equipe. Layout em 2 linhas por pessoa: identidade
                      em cima (avatar + nome/email, ocupa a largura), ações embaixo
                      (cargo + líder + remover) — evita o select cobrir o texto e dá ar. */}
                  <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {membrosEq.map((u) => (
                      <div key={u.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Avatar nome={u.nome} className="h-9 w-9 shrink-0 text-xs" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{u.nome}</span>
                              {/* A estrela existe em QUALQUER equipe (modelo 27/07):
                                  líder do GP = gestor do GP, não mais master. */}
                              {u.lider_equipe && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" title="Líder desta equipe">
                                  <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>
                                  líder
                                </span>
                              )}
                              {/* O nível EFETIVO (lib/papeis.nivelDe): deixa visível
                                  que admin + GP = master e admin + Equipe 2 = gestor. */}
                              <SeloNivel usuario={{ id: u.id, papel: u.papel, equipe_id: u.equipe_id, equipe_tipo: eq.tipo, lider_equipe: u.lider_equipe }} />
                            </div>
                            <span className="block truncate text-xs text-slate-400 dark:text-slate-500">{u.email}</span>
                          </div>
                          {/* Ações à direita — SÓ o master mexe na composição */}
                          {podeEditar && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              {/* Estrela em QUALQUER equipe — inclusive no GP (líder
                                  do GP = gestor do GP). O backend já aceitava; só a
                                  UI travava em equipe comum (sobra do modelo antigo). */}
                              <button
                                type="button"
                                onClick={() => membro(eq.id, u.id, "vincular", undefined, !u.lider_equipe)}
                                title={u.lider_equipe ? "Tirar como líder da equipe" : "Tornar líder desta equipe (vira gestor: vê e distribui os cards dela)"}
                                className={cn("rounded-md p-1.5 transition",
                                  u.lider_equipe
                                    ? "text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                                    : "text-slate-300 hover:bg-slate-100 hover:text-amber-400 dark:text-slate-600 dark:hover:bg-slate-800")}
                              >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill={u.lider_equipe ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>
                              </button>
                              <button
                                onClick={() => setRemover({ equipeId: eq.id, usuario: u })}
                                className="alvo-toque rounded-md p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-500/10"
                                title="Tirar da equipe"
                                aria-label={`Tirar ${u.nome} da equipe ${eq.nome}`}
                              >
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                              </button>
                            </div>
                          )}
                        </div>
                        {/* Cargo: o master troca; o gestor só lê */}
                        <div className="mt-1.5 pl-[calc(2.25rem+0.625rem)]">
                          {podeEditar ? (
                            <select
                              value={u.papel}
                              onChange={(e) => membro(eq.id, u.id, "vincular", e.target.value as Papel)}
                              className={cn(fieldCompactClass, "h-7 py-0 text-xs")}
                              title="Cargo do membro"
                            >
                              <option value="operador">Operador</option>
                              <option value="disparador">Operador de disparos</option>
                              <option value="admin">Administrador</option>
                            </select>
                          ) : (
                            <span className="text-xs text-slate-500 dark:text-slate-400">{LABEL_PAPEL[u.papel]}</span>
                          )}
                        </div>
                      </div>
                    ))}
                    {membrosEq.length === 0 && (
                      <p className="px-3 py-3 text-xs text-slate-400">Sem ninguém nesta equipe ainda — adicione alguém da lista &ldquo;Sem equipe&rdquo; abaixo.</p>
                    )}
                  </div>
                </div>
                );
              })}
            </div>

            {/* Sem equipe → atribuir (só o master compõe equipe) */}
            {podeEditar && usuarios.some((u) => u.ativo && !u.equipe_id) && (
              <div className="mt-4 rounded-xl border border-dashed border-amber-300 bg-amber-50/40 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
                <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                  {usuarios.filter((u) => u.ativo && !u.equipe_id).length} sem equipe — atribua a alguma
                </p>
                <div className="space-y-1">
                  {usuarios.filter((u) => u.ativo && !u.equipe_id).map((u) => (
                    <div key={u.id} className="flex items-center gap-2.5 rounded-lg bg-white px-2.5 py-1.5 dark:bg-slate-900">
                      <Avatar nome={u.nome} className="h-7 w-7 shrink-0 text-[10px]" />
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-700 dark:text-slate-200">{u.nome}</span>
                        <span className="block truncate text-xs text-slate-400">{LABEL_PAPEL[u.papel]}</span>
                      </div>
                      <select
                        defaultValue=""
                        onChange={(e) => { if (e.target.value) membro(e.target.value, u.id, "vincular"); }}
                        className={cn(fieldCompactClass, "h-8 shrink-0 py-0 text-xs")}
                        title="Adicionar esta pessoa a uma equipe"
                      >
                        <option value="">Adicionar à…</option>
                        {equipes.map((eq) => <option key={eq.id} value={eq.id}>{eq.nome}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Criar equipe comum — só o master */}
            {podeEditar && (
              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <input type="color" value={novaCor} onChange={(e) => setNovaCor(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-300 bg-transparent dark:border-slate-600" title="Cor da nova equipe" />
                <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Nome da nova equipe" className={cn(fieldClass, "flex-1")} />
                <Button onClick={criarEquipe} disabled={novoNome.trim().length < 2}>Criar equipe</Button>
              </div>
            )}
          </Card>

          {/* Config global (só o master): equipe padrão + roteamento por canal */}
          {podeEditar && (
          <div className="space-y-4">
          {/* Equipe padrão para novas vendas */}
          <Card className="p-4">
            <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Equipe padrão das vendas novas</h2>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              Toda venda de HM que entrar <strong>de agora em diante</strong> já cai nesta equipe. Os cards que já estão no board não mudam — só as compras novas. Deixe em &ldquo;Ninguém&rdquo; para que caiam no pool aberto.
            </p>
            <select
              value={equipePadrao ?? ""}
              onChange={(e) => salvarEquipePadrao(e.target.value || null)}
              className={cn(fieldClass, "w-full")}
              title="Equipe que recebe automaticamente as novas vendas de HM"
            >
              <option value="">Ninguém (fica sem dono, livre para qualquer um pegar)</option>
              {equipes.map((eq) => <option key={eq.id} value={eq.id}>{eq.nome}</option>)}
            </select>
            {equipePadrao && (() => {
              const eq = equipes.find((x) => x.id === equipePadrao);
              return eq ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: eq.cor }} />
                  Novas vendas caem em <strong className="text-slate-700 dark:text-slate-200">{eq.nome}</strong>.
                </p>
              ) : null;
            })()}
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
                  <button onClick={() => salvarRota(r.canal, null, r.equipe_nome)} className="alvo-toque text-xs text-slate-400 hover:text-rose-500" title="Remover rota" aria-label={`Remover rota do canal ${r.canal}`}>remover</button>
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
        </div>
      )}

      {remover && (
        <ModalConfirmarRemover
          usuario={remover.usuario}
          equipeNome={equipes.find((eq) => eq.id === remover.equipeId)?.nome ?? ""}
          onClose={() => setRemover(null)}
          onConfirmar={async () => { await membro(remover.equipeId, remover.usuario.id, "remover"); setRemover(null); }}
        />
      )}
    </PageFade>
  );
}

// Confirmação de "Tirar da equipe" — destrutivo o bastante pra explicar antes:
// a pessoa some da visão da equipe (só sobra pool + os cards que já são dela),
// e perde a estrela de líder se tinha. Os cards dela não mudam de dono.
function ModalConfirmarRemover({ usuario, equipeNome, onClose, onConfirmar }: { usuario: Usuario; equipeNome: string; onClose: () => void; onConfirmar: () => Promise<void> }) {
  const [salvando, setSalvando] = useState(false);

  async function confirmar() {
    setSalvando(true);
    try { await onConfirmar(); } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose} role="alertdialog" aria-modal="true" aria-labelledby="titulo-remover-membro">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm animate-fade-in rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 id="titulo-remover-membro" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Tirar {usuario.nome} de {equipeNome}?</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
          <li className="flex gap-2"><span aria-hidden className="text-rose-500">•</span> Ela deixa de ver e distribuir os cards <strong>desta equipe</strong> — sobram os alunos sem dono e os que já são dela.</li>
          {usuario.lider_equipe && (
            <li className="flex gap-2"><span aria-hidden className="text-rose-500">•</span> Perde a estrela de líder junto (ninguém lidera equipe nenhuma).</li>
          )}
          <li className="flex gap-2"><span aria-hidden className="text-rose-500">•</span> Os cards que já são dela <strong>não mudam de dono</strong>.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">Pode adicionar de volta a qualquer momento.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="button" variant="danger" onClick={confirmar} disabled={salvando}>{salvando && <Spinner className="text-white" />}Tirar da equipe</Button>
        </div>
      </div>
    </div>
  );
}
