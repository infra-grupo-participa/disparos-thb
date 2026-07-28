"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/app/_components/avatar";
import { Button, Spinner, fieldClass } from "@/app/_components/ui";
import { SeloNivel } from "@/app/_components/selo-nivel";
import { useMe } from "@/app/_components/use-me";
import { usePortal } from "@/app/_components/use-portal";

export default function UserMenu() {
  const router = useRouter();
  // Gating pelo hook (regra única de lib/papeis): "Gerenciar usuários" e
  // "Canais de disparo" são gestão de conta — só o master (admin do GP) vê.
  const { me, podeGerirAcesso } = useMe();
  // Base do portal atual — a Central de Ajuda existe dentro de cada portal.
  const { base } = usePortal();
  const [aberto, setAberto] = useState(false);
  const [trocarSenha, setTrocarSenha] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fora(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); }
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, []);

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  if (!me) {
    return (
      <Button variant="ghost" size="sm" onClick={logout}>
        Sair
      </Button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 text-sm transition hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-label="Menu do usuário"
        aria-haspopup="menu"
        aria-expanded={aberto}
      >
        <Avatar nome={me.nome} className="h-7 w-7 text-xs" />
        <span className="hidden max-w-[120px] truncate font-medium text-slate-700 sm:block dark:text-slate-200">{me.nome}</span>
        <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {aberto && (
        <div className="absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
            <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{me.nome}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{me.email}</p>
            {/* NÍVEL efetivo (papel × equipe), não o papel cru: um admin de
                equipe comum lia "Administrador" e não entendia por que não via
                tudo — quem rege a visibilidade é o nível. O SeloNivel deriva
                via lib/papeis e explica o alcance no title. */}
            <SeloNivel usuario={me} className="mt-1.5" />
          </div>
          {/* Central de administração (28/07): um só ponto de entrada para a
              gestão (contas, equipes, canais, canal→pessoa), no lugar dos links
              soltos de antes. Só o master. As telas antigas seguem acessíveis
              por dentro do hub. */}
          {podeGerirAcesso() && (
            <Link href="/admin" onClick={() => setAberto(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></svg>
              Administração
            </Link>
          )}
          <Link href={`${base}/ajuda`} onClick={() => setAberto(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 2.4-3 4" /><path d="M12 17.5h.01" /></svg>
            Central de Ajuda
          </Link>
          <button onClick={() => { setTrocarSenha(true); setAberto(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Trocar minha senha
          </button>
          <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
          <button onClick={logout} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
            <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            Sair
          </button>
        </div>
      )}

      {trocarSenha && <ModalTrocarSenha userId={me.id} onClose={() => setTrocarSenha(false)} />}
    </div>
  );
}

function ModalTrocarSenha({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (nova.length < 6) { setErro("A nova senha precisa ter ao menos 6 caracteres."); return; }
    if (nova !== confirma) { setErro("A confirmação não confere."); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/usuarios/${userId}/senha`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ atualSenha: atual, novaSenha: nova }),
      });
      const d = await r.json();
      if (!d.ok) { setErro(d.reason === "senha_atual_incorreta" ? "Senha atual incorreta." : "Não foi possível trocar a senha."); return; }
      setOk(true);
      setTimeout(onClose, 1200);
    } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="w-full max-w-sm animate-fade-in rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Trocar minha senha</h2>
        {ok ? (
          <p className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">✓ Senha alterada com sucesso.</p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <input type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} placeholder="Senha atual" className={fieldClass} />
              <input type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} placeholder="Nova senha" className={fieldClass} />
              <input type="password" autoComplete="new-password" value={confirma} onChange={(e) => setConfirma(e.target.value)} placeholder="Confirmar nova senha" className={fieldClass} />
            </div>
            {erro && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={salvando}>{salvando && <Spinner className="text-white" />}Salvar</Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
