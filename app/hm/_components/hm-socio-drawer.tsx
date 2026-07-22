"use client";

import { useState } from "react";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { corAvatar, inicial } from "@/app/_components/avatar";
import { ContatoDoNome } from "@/app/_components/copiavel";

// A FICHA DO SÓCIO — abre ao clicar no card azul do sócio na Ativação. O sócio
// não é um comprador: ele mora pendurado no titular (cs.hm_socios) e tem
// ativação própria (Searchie/Comunidade/Grupo + Facebook). Aqui dá para ver o
// contato inteiro (o card corta o e-mail), tocar os 3 acessos, mandar à base e
// convidar outro sócio para o MESMO titular — tudo sem abrir a ficha do titular.
export type SocioFicha = {
  socio_id: string;
  contato_hm_id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  link_facebook: string | null;
  origem: string | null;
  ativ_searchie: boolean;
  ativ_comunidade: boolean;
  ativ_grupo: boolean;
  titular_comprador_id: string;
  titular_nome: string;
  titular_turma: string | null;
  titular_origem: string | null;
  titular_cancelado: boolean;
  checks_feitos: number;
  status: "nao_iniciado" | "em_ativacao" | "ativado" | "sem_acesso";
  na_base: boolean;
  titular_na_base: boolean;
};

function estadoNaBase(s: SocioFicha): "na_base" | "fora_da_base" | "aguarda_titular" {
  if (s.na_base) return "na_base";
  return s.titular_na_base ? "fora_da_base" : "aguarda_titular";
}

const CHECKS: { campo: "ativ_searchie" | "ativ_comunidade" | "ativ_grupo"; label: string }[] = [
  { campo: "ativ_searchie", label: "Searchie / Óbvio" },
  { campo: "ativ_comunidade", label: "Comunidade THB" },
  { campo: "ativ_grupo", label: "Grupo de informes" },
];

export function HmSocioDrawer({ socio, onClose, onChanged }: {
  socio: SocioFicha;
  onClose: () => void;
  onChanged: () => void;
}) {
  // Cópia local para refletir as edições na hora (otimista); o board recarrega no fechar.
  const [s, setS] = useState<SocioFicha>(socio);
  const [salvando, setSalvando] = useState(false);
  const [fb, setFb] = useState(socio.link_facebook ?? "");
  const [novo, setNovo] = useState({ nome: "", email: "", telefone: "" });
  const [enviando, setEnviando] = useState(false);

  // Toda escrita passa pela rota do TITULAR (o sócio é filho dele).
  async function req(method: "PATCH" | "DELETE" | "POST", body?: Record<string, unknown>, socioId?: string) {
    setSalvando(true);
    try {
      const url = `/api/hm/contato/${s.titular_comprador_id}/socios${socioId ? `?socioId=${socioId}` : ""}`;
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      onChanged();
    } finally {
      setSalvando(false);
    }
  }

  async function toggleCheck(campo: "ativ_searchie" | "ativ_comunidade" | "ativ_grupo") {
    const novoValor = !s[campo];
    setS((x) => {
      const at = { ...x, [campo]: novoValor };
      const n = Number(at.ativ_searchie) + Number(at.ativ_comunidade) + Number(at.ativ_grupo);
      const status: SocioFicha["status"] = at.titular_cancelado ? "sem_acesso" : n === 3 ? "ativado" : n > 0 ? "em_ativacao" : "nao_iniciado";
      return { ...at, checks_feitos: n, status };
    });
    await req("PATCH", { socioId: s.socio_id, [campo]: novoValor });
  }

  async function enviarBase() {
    setEnviando(true);
    try {
      const r = await fetch(`/api/hm/contato/${s.titular_comprador_id}/socios/provisionar`, { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.ok) window.alert(`Não foi possível enviar ${s.nome} à base. Tente de novo.`);
      else if (!d.provisionados) window.alert(`${s.nome} não foi enviado: o titular precisa estar como aluno na base primeiro.`);
      else setS((x) => ({ ...x, na_base: true }));
      onChanged();
    } finally {
      setEnviando(false);
    }
  }

  const base = estadoNaBase(s);
  const baseInfo = base === "na_base"
    ? { txt: "Na base THB", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", hint: "O GPS já enxerga este sócio." }
    : base === "fora_da_base"
      ? { txt: "Fora da base", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", hint: "O titular já é aluno, mas o sócio ainda não foi enviado à base." }
      : { txt: "Aguarda o titular pagar", cls: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400", hint: "O sócio entra na base quando o titular quitar." };

  const statusInfo = s.status === "sem_acesso"
    ? { txt: "Sem acesso — remover", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" }
    : s.status === "ativado"
      ? { txt: "Ativado", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" }
      : s.status === "em_ativacao"
        ? { txt: "Em ativação", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" }
        : { txt: "Não iniciado", cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300" };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-pop animate-fade-in dark:border-slate-800 dark:bg-slate-900">
        {/* Cabeçalho: sócio + contato inteiro (o card cortava o e-mail) */}
        <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", corAvatar(s.nome))}>{inicial(s.nome)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">Sócio</span>
              <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold", statusInfo.cls)}>{statusInfo.txt}</span>
              {s.origem && (
                <span className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" title="Origem do sócio (de onde veio)">
                  {s.origem}
                </span>
              )}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-slate-100" title={s.nome}>{s.nome}</h2>
            <ContatoDoNome telefone={s.telefone} email={s.email} className="mt-0.5" />
            <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
              sócio de <span className="font-medium text-slate-500 dark:text-slate-300">{s.titular_nome}</span>
              {s.titular_origem ? ` · ${s.titular_origem}` : s.titular_turma ? ` · ${s.titular_turma}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" title="Fechar">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {s.titular_cancelado && (
            <p className="rounded-lg bg-rose-100 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              O titular cancelou — o acesso deste sócio deve ser removido.
            </p>
          )}

          {/* Estado na base mestre (GPS) */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Base de alunos (GPS)</p>
            <div className="flex items-center justify-between gap-2">
              <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", baseInfo.cls)} title={baseInfo.hint}>{baseInfo.txt}</span>
              {base === "fora_da_base" && (
                <Button variant="secondary" size="sm" disabled={enviando} onClick={enviarBase}>
                  {enviando ? "Enviando…" : "Enviar à base THB"}
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{baseInfo.hint}</p>
          </div>

          {/* Ativação: os 3 acessos + Facebook */}
          <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Ativação do sócio ({s.checks_feitos}/3)
            </p>
            <div className="space-y-1.5">
              {CHECKS.map((c) => (
                <button
                  key={c.campo}
                  type="button"
                  disabled={salvando}
                  onClick={() => toggleCheck(c.campo)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition",
                    s[c.campo]
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "border-slate-300 bg-white text-slate-600 hover:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
                  )}
                >
                  <span className={cn("flex h-4 w-4 items-center justify-center rounded border", s[c.campo] ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600")}>
                    {s[c.campo] && <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                  </span>
                  {c.label}
                </button>
              ))}
            </div>
            <input
              value={fb}
              disabled={salvando}
              onChange={(e) => setFb(e.target.value)}
              onBlur={() => { if (fb !== (s.link_facebook ?? "")) { setS((x) => ({ ...x, link_facebook: fb || null })); req("PATCH", { socioId: s.socio_id, link_facebook: fb || null }); } }}
              placeholder="Link do Facebook do sócio"
              className={cn(fieldClass, "mt-2 text-xs")}
            />
          </div>

          {/* Convidar OUTRO sócio para o mesmo titular — a associação é automática. */}
          <div className="rounded-lg border border-dashed border-slate-300 p-3 dark:border-slate-700">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              + Sócio de {s.titular_nome.split(" ")[0]}
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Nome" className={cn(fieldClass, "text-[11px]")} />
              <input value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail" className={cn(fieldClass, "text-[11px]")} />
              <input value={novo.telefone} onChange={(e) => setNovo({ ...novo, telefone: e.target.value })} placeholder="Telefone" className={cn(fieldClass, "text-[11px]")} />
            </div>
            <Button
              variant="secondary" size="sm" className="mt-1.5"
              disabled={salvando || novo.nome.trim().length < 2}
              onClick={async () => {
                await req("POST", { nome: novo.nome.trim(), email: novo.email.trim() || null, telefone: novo.telefone.trim() || null });
                setNovo({ nome: "", email: "", telefone: "" });
              }}
            >
              Adicionar sócio
            </Button>
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">Vincula automaticamente a {s.titular_nome} e provisiona na base se o titular já for aluno.</p>
          </div>

          {/* Remover este sócio */}
          <button
            type="button"
            disabled={salvando}
            onClick={() => { if (window.confirm(`Remover o sócio ${s.nome} do card de ${s.titular_nome}?`)) { req("DELETE", undefined, s.socio_id).then(onClose); } }}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-500 transition hover:text-rose-700"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
            Remover sócio deste card
          </button>
        </div>

        {salvando && (
          <div className="flex items-center gap-2 border-t border-slate-100 px-5 py-2 text-xs text-slate-400 dark:border-slate-800">
            <Spinner className="h-3.5 w-3.5" /> salvando…
          </div>
        )}
      </aside>
    </>
  );
}
