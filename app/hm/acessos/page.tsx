"use client";

import { useCallback, useEffect, useState } from "react";
import { cn, fieldClass, fieldCompactClass, Spinner } from "@/app/_components/ui";
import { useMe } from "@/app/_components/use-me";

// Consulta dos acessos do GPS — só admin.
//
// Duas coisas que NÃO são a mesma e vivem sendo confundidas:
//   • HABILITADO — a pessoa tem linha na base, então o GPS consegue casá-la (por
//     DOCUMENTO) quando ela entrar. É o que o funil cria.
//   • ENTROU — ela é membro/cliente no GPS de fato.
// Criar acesso não faz ninguém entrar: o GPS é de adesão. Por isso esta tela mostra
// os dois lados juntos — e destaca quem está sem CPF, que o GPS nunca vai achar.

type Acesso = {
  aluno_id: string;
  nome: string; email: string | null; telefone: string | null; documento: string | null;
  tipo: "trilha" | "aluno";
  turma: string | null; plano: string | null;
  status_acesso: string | null; regra_acesso: string | null;
  data_compra: string | null; data_expiracao: string | null; acesso_vencido: boolean;
  situacao_financeira: string | null; cancelado_em: string | null; criado_em: string | null;
  gps_membro: boolean; gps_cliente: boolean; sem_documento: boolean;
  comprador_id: string | null;
};
type Resumo = { total: number; trilha: number; aluno: number; entraram: number; sem_documento: number; vencidos: number };

function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export default function GpsAcessosPage() {
  // Só o MASTER (admin do Grupo Participa) — um admin de equipe comum não
  // consulta os acessos do GPS. A rota barra igual no servidor.
  const { me, ehMaster } = useMe();
  const admin = ehMaster();

  const [acessos, setAcessos] = useState<Acesso[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [q, setQ] = useState("");
  const [tipo, setTipo] = useState("");
  const [situacao, setSituacao] = useState("");
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!admin) { setCarregando(false); return; }
    setCarregando(true);
    try {
      const p = new URLSearchParams();
      if (q) p.set("q", q);
      if (tipo) p.set("tipo", tipo);
      if (situacao) p.set("situacao", situacao);
      const r = await fetch(`/api/hm/acessos?${p.toString()}`);
      const d = await r.json();
      if (d.ok) { setAcessos(d.acessos); setResumo(d.resumo); }
    } finally {
      setCarregando(false);
    }
  }, [q, tipo, situacao, admin]);

  // Busca com respiro: não dispara a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => { carregar(); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregar, q]);

  if (me && !admin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Consulta restrita</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Só o administrador do Grupo Participa consulta os acessos do GPS.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Acessos do GPS</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Quem o funil <strong>habilitou</strong> (tem cadastro na base, então o GPS o encontra pelo documento)
          e quem de fato <strong>entrou</strong> no GPS. Criar o acesso não faz a pessoa entrar — a entrada é dela.
        </p>
      </div>

      {/* Placar do conjunto inteiro — o retrato, não o recorte filtrado. */}
      {resumo && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Placar rotulo="Acessos habilitados" valor={resumo.total} dica="Cadastros na base que o GPS consegue casar" />
          <Placar rotulo="Entraram no GPS" valor={resumo.entraram} tom="bom"
            dica="São membros/clientes no GPS de fato" />
          <Placar rotulo="Trilha (sinal)" valor={resumo.trilha} tom="trilha"
            dica="Pagaram o sinal de R$300 — acesso para trilhar, sem turma" />
          <Placar rotulo="Sem CPF" valor={resumo.sem_documento} tom={resumo.sem_documento ? "alerta" : undefined}
            dica="O GPS casa por documento: sem CPF, ele nunca acha a pessoa" />
          <Placar rotulo="Acesso vencido" valor={resumo.vencidos} tom={resumo.vencidos ? "alerta" : undefined}
            dica="A validade do acesso já passou" />
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, e-mail, CPF ou telefone…"
          className={cn(fieldClass, "max-w-xs")}
        />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={fieldCompactClass}>
          <option value="">Todos os tipos</option>
          <option value="trilha">Trilha (sinal)</option>
          <option value="aluno">Aluno</option>
        </select>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} className={fieldCompactClass}>
          <option value="">Qualquer situação</option>
          <option value="entrou">Entrou no GPS</option>
          <option value="nao_entrou">Ainda não entrou</option>
          <option value="sem_documento">Sem CPF</option>
          <option value="vencido">Acesso vencido</option>
        </select>
        {(q || tipo || situacao) && (
          <button
            onClick={() => { setQ(""); setTipo(""); setSituacao(""); }}
            className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            Limpar
          </button>
        )}
        {carregando && <Spinner className="h-4 w-4 text-slate-400" />}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
              <th className="px-3 py-2.5 font-semibold">Pessoa</th>
              <th className="px-3 py-2.5 font-semibold">Tipo</th>
              <th className="px-3 py-2.5 font-semibold">Turma</th>
              <th className="px-3 py-2.5 font-semibold">No GPS</th>
              <th className="px-3 py-2.5 font-semibold">Criado</th>
              <th className="px-3 py-2.5 font-semibold">Validade</th>
              <th className="px-3 py-2.5 font-semibold">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {acessos.length === 0 && !carregando ? (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-slate-400">Nenhum acesso com esses filtros.</td></tr>
            ) : (
              acessos.map((a) => (
                <tr key={a.aluno_id} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-slate-800 dark:text-slate-100">{a.nome}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">{a.email ?? a.telefone ?? "—"}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                      a.tipo === "trilha"
                        ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
                        : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300")}>
                      {a.tipo === "trilha" ? "Trilha (sinal)" : "Aluno"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">{a.turma ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {a.gps_membro || a.gps_cliente ? (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        {a.gps_membro ? "Membro" : "Cliente"}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">ainda não entrou</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-slate-500 dark:text-slate-400">{fmtData(a.criado_em)}</td>
                  <td className={cn("px-3 py-2.5", a.acesso_vencido ? "text-rose-600 dark:text-rose-400" : "text-slate-500 dark:text-slate-400")}>
                    {fmtData(a.data_expiracao)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {a.sem_documento && (
                        <span title="O GPS casa por documento — sem CPF ele não encontra esta pessoa"
                          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                          sem CPF
                        </span>
                      )}
                      {a.acesso_vencido && (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                          vencido
                        </span>
                      )}
                      {a.cancelado_em && (
                        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          cancelado
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {acessos.length >= 500 && (
        <p className="mt-2 text-xs text-slate-400">Mostrando os 500 mais recentes — refine a busca para ver o resto.</p>
      )}
    </div>
  );
}

function Placar({ rotulo, valor, tom, dica }: { rotulo: string; valor: number; tom?: "bom" | "alerta" | "trilha"; dica?: string }) {
  return (
    <div title={dica} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{rotulo}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums",
        tom === "bom" ? "text-emerald-600 dark:text-emerald-400"
        : tom === "alerta" ? "text-amber-600 dark:text-amber-400"
        : tom === "trilha" ? "text-violet-600 dark:text-violet-400"
        : "text-slate-800 dark:text-slate-100")}>{valor}</p>
    </div>
  );
}
