"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/app/_components/avatar";
import { Button, Card, EmptyState, PageHeader, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { LegendaNiveis, SeloNivel } from "@/app/_components/selo-nivel";

type Papel = "admin" | "disparador" | "operador";
type Portal = "HT" | "SEM" | "HM" | "AURUM" | "ETHB";
type Usuario = {
  id: string; nome: string; email: string; papel: Papel; ativo: boolean; criado_em: string; portais: Portal[];
  // Campos de equipe que o NÍVEL efetivo (lib/papeis.nivelDe) precisa. O GET
  // /api/usuarios os devolve no payload de MASTER (quem vê esta tela); seguem
  // opcionais porque o payload mínimo de não-master não os traz — nesse caso o
  // SeloNivel degrada para "nível ?" em vez de chutar (admin sem equipe_tipo
  // tanto pode ser master quanto gestor).
  equipe_id?: string | null;
  equipe_tipo?: "principal" | "comum" | null;
  lider_equipe?: boolean | null;
};

// Rótulos dos portais para o admin marcar o acesso de cada conta.
const PORTAIS: { id: Portal; label: string }[] = [
  { id: "HT", label: "Holding Total" },
  { id: "SEM", label: "Seminário" },
  // "Curso" (CNHF) saiu em 10/08/2026 — ver o cabeçalho de lib/marcas.ts.
  { id: "HM", label: "Holding Masters" },
  { id: "AURUM", label: "Aurum" },
  { id: "ETHB", label: "ETHB" },
];

export default function UsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [souAdmin, setSouAdmin] = useState<boolean | null>(null);
  const [podeGerirAcesso, setPodeGerirAcesso] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false);
  const [resetar, setResetar] = useState<Usuario | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/usuarios");
      const d = await r.json();
      if (d.ok) { setUsuarios(d.usuarios); setSouAdmin(d.sou_admin); setPodeGerirAcesso(!!d.pode_gerir_acesso); }
      else setSouAdmin(false);
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function patch(id: string, payload: Record<string, unknown>) {
    const r = await fetch(`/api/usuarios/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!d.ok) { alert(traduzErro(d.reason)); return; }
    await carregar();
  }

  // Salva a whitelist de portais de uma conta (só admin do GP). Toggle otimista.
  async function toggglePortal(u: Usuario, portal: Portal) {
    const novos = u.portais.includes(portal) ? u.portais.filter((p) => p !== portal) : [...u.portais, portal];
    setUsuarios((lista) => lista.map((x) => (x.id === u.id ? { ...x, portais: novos } : x)));
    const r = await fetch(`/api/usuarios/${u.id}/portais`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portais: novos }) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível salvar os portais."); await carregar(); }
  }

  // Só o admin do Grupo Participa gere contas. Um admin de equipe comum (Kelly)
  // não gerencia usuários — cada equipe é independente.
  if (souAdmin !== null && !podeGerirAcesso) {
    return (
      <PageFade>
        <EmptyState title="Acesso restrito" description="Apenas administradores do Grupo Participa gerenciam usuários." />
      </PageFade>
    );
  }

  return (
    <PageFade>
      <PageHeader
        title="Usuários"
        description="Operadores da ativação e seus níveis de acesso."
        actions={<Button onClick={() => setNovo(true)}>+ Novo usuário</Button>}
      />

      {/* Como se produz cada nível — o papel sozinho NÃO conta a história toda:
          "Administrador" pode ser master (GP) ou gestor (outra equipe). */}
      <LegendaNiveis className="mb-4" />

      {carregando && usuarios.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Spinner /> Carregando…</div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Usuário</th>
                  <th className="px-4 py-2.5 font-semibold">Papel</th>
                  {/* O NÍVEL efetivo é derivado (papel × equipe) — coluna própria
                      para ficar claro que trocar o papel não decide sozinho. */}
                  <th className="px-4 py-2.5 font-semibold">Nível</th>
                  {podeGerirAcesso && <th className="px-4 py-2.5 font-semibold">Portais</th>}
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {usuarios.map((u) => (
                  <tr key={u.id} className={cn("transition", !u.ativo && "opacity-50")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar nome={u.nome} className="h-9 w-9 text-sm" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800 dark:text-slate-100">{u.nome}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.papel}
                        onChange={(e) => patch(u.id, { papel: e.target.value })}
                        className={cn(fieldClass, "w-auto py-1 text-xs")}
                      >
                        <option value="operador">Operador</option>
                        <option value="disparador">Operador de disparos</option>
                        <option value="admin">Administrador</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {/* master = admin + Grupo Participa; gestor = admin de outra
                          equipe ou estrela de líder; operador = o resto. A equipe
                          e a estrela se mexem na tela de Equipes do HM. */}
                      <SeloNivel usuario={u} />
                    </td>
                    {podeGerirAcesso && (
                      <td className="px-4 py-3">
                        {/* Whitelist de portais da conta — clique para liberar/bloquear. */}
                        <div className="flex flex-wrap gap-1">
                          {PORTAIS.map((p) => {
                            const on = u.portais.includes(p.id);
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => toggglePortal(u, p.id)}
                                title={`${on ? "Bloquear" : "Liberar"} ${p.label} para ${u.nome}`}
                                className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium transition",
                                  on
                                    ? "bg-brand/10 text-brand ring-1 ring-brand/30 dark:bg-brand-400/15 dark:text-brand-300"
                                    : "bg-slate-100 text-slate-400 hover:text-slate-600 dark:bg-slate-800 dark:text-slate-500 dark:hover:text-slate-300")}
                              >
                                {p.id}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                        u.ativo ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", u.ativo ? "bg-emerald-500" : "bg-slate-400")} />
                        {u.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setResetar(u)}>Redefinir senha</Button>
                        <Button variant={u.ativo ? "ghost" : "secondary"} size="sm" onClick={() => patch(u.id, { ativo: !u.ativo })}>
                          {u.ativo ? "Desativar" : "Reativar"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {novo && <ModalNovo onClose={() => setNovo(false)} onCriado={() => { setNovo(false); carregar(); }} />}
      {resetar && <ModalResetar usuario={resetar} onClose={() => setResetar(null)} />}
    </PageFade>
  );
}

function traduzErro(reason?: string): string {
  switch (reason) {
    case "email_em_uso": return "Já existe um usuário com esse e-mail.";
    case "nao_pode_desativar_a_si": return "Você não pode desativar a si mesmo.";
    case "nao_pode_rebaixar_a_si": return "Você não pode remover o seu próprio acesso de administrador.";
    case "forbidden": return "Sem permissão.";
    default: return "Não foi possível concluir a ação.";
  }
}

function ModalNovo({ onClose, onCriado }: { onClose: () => void; onCriado: () => void }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [papel, setPapel] = useState<Papel>("operador");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < 6) { setErro("A senha precisa ter ao menos 6 caracteres."); return; }
    setSalvando(true);
    try {
      const r = await fetch("/api/usuarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, email, senha, papel }) });
      const d = await r.json();
      if (!d.ok) { setErro(traduzErro(d.reason)); return; }
      onCriado();
    } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="w-full max-w-sm animate-fade-in rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Novo usuário</h2>
        <div className="mt-4 space-y-3">
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" className={fieldClass} />
          <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" className={fieldClass} />
          <input type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha inicial" className={fieldClass} />
          <select value={papel} onChange={(e) => setPapel(e.target.value as Papel)} className={fieldClass}>
            <option value="operador">Operador</option>
            <option value="disparador">Operador de disparos</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        {erro && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={salvando}>{salvando && <Spinner className="text-white" />}Criar</Button>
        </div>
      </form>
    </div>
  );
}

function ModalResetar({ usuario, onClose }: { usuario: Usuario; onClose: () => void }) {
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova.length < 6) { setErro("A senha precisa ter ao menos 6 caracteres."); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/usuarios/${usuario.id}/senha`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ novaSenha: nova }) });
      const d = await r.json();
      if (!d.ok) { setErro("Não foi possível redefinir a senha."); return; }
      setOk(true);
      setTimeout(onClose, 1200);
    } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="w-full max-w-sm animate-fade-in rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Redefinir senha</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">de <strong>{usuario.nome}</strong></p>
        {ok ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">✓ Senha redefinida.</p>
        ) : (
          <>
            <input type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova senha" className={cn(fieldClass, "mt-4")} autoFocus />
            {erro && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando && <Spinner className="text-white" />}Redefinir</Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
