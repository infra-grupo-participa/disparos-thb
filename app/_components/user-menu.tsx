"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/app/_components/avatar";
import { Button, Spinner, cn, fieldClass } from "@/app/_components/ui";

type Me = { id: string; nome: string; email: string; papel: "admin" | "operador" };

export default function UserMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [aberto, setAberto] = useState(false);
  const [trocarSenha, setTrocarSenha] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok) setMe(d.usuario); }).catch(() => {});
  }, []);

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
      <button onClick={logout} className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100">
        Sair
      </button>
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
            <span className={cn("mt-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              me.papel === "admin" ? "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300")}>
              {me.papel === "admin" ? "Administrador" : "Operador"}
            </span>
          </div>
          {me.papel === "admin" && (
            <Link href="/usuarios" onClick={() => setAberto(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
              <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              Gerenciar usuários
            </Link>
          )}
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
