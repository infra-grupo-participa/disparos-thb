"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cn, fieldClass, Spinner } from "@/app/_components/ui";
import { Avatar } from "@/app/_components/avatar";

type Agendamento = {
  comprador_id: string; nome: string; telefone: string | null; plano: string | null;
  responsavel: string | null; estagio_nome: string | null;
  tipo: "reuniao" | "entrevista"; quando: string | null; resultado: string | null;
};

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function ehFuturo(iso: string | null) {
  return iso ? new Date(iso).getTime() >= Date.now() : false;
}

export default function HmAgendamentosPage() {
  const [rows, setRows] = useState<Agendamento[]>([]);
  const [tipo, setTipo] = useState("");
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (tipo) params.set("tipo", tipo);
      const r = await fetch(`/api/hm/agendamentos?${params.toString()}`);
      const d = await r.json();
      if (d.ok) setRows(d.agendamentos);
    } finally {
      setCarregando(false);
    }
  }, [tipo]);

  useEffect(() => { carregar(); }, [carregar]);

  const proximos = rows.filter((r) => ehFuturo(r.quando));
  const passados = rows.filter((r) => !ehFuturo(r.quando));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Agendamentos · Holding Masters</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Reuniões comerciais e entrevistas de ativação marcadas — T39.</p>
        </div>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={cn(fieldClass, "w-auto")}>
          <option value="">Reuniões e entrevistas</option>
          <option value="reuniao">Só reuniões</option>
          <option value="entrevista">Só entrevistas</option>
        </select>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-3 py-20 text-slate-400"><Spinner className="h-6 w-6" /> Carregando…</div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">Nenhum agendamento marcado ainda.</p>
      ) : (
        <div className="space-y-6">
          <Grupo titulo={`Próximos (${proximos.length})`} rows={proximos} vazio="Sem agendamentos futuros." />
          <Grupo titulo={`Realizados / passados (${passados.length})`} rows={passados} vazio="Nada no passado." atenuado />
        </div>
      )}
    </div>
  );
}

function Grupo({ titulo, rows, vazio, atenuado }: { titulo: string; rows: Agendamento[]; vazio: string; atenuado?: boolean }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{titulo}</h2>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-6 text-center text-sm text-slate-400 dark:border-slate-800 dark:text-slate-500">{vazio}</p>
      ) : (
        <div className={cn("overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", atenuado && "opacity-80")}>
          {rows.map((r, i) => (
            <Link
              key={`${r.comprador_id}-${r.tipo}-${i}`}
              href={`/hm/contatos/${r.comprador_id}`}
              className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 transition last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
            >
              <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                r.tipo === "reuniao" ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300")}>
                {r.tipo === "reuniao" ? "Reunião" : "Entrevista"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{r.nome}</p>
                <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                  {fmt(r.quando)}{r.plano ? ` · ${r.plano}` : ""}{r.resultado ? ` · ${r.resultado}` : ""}
                </p>
              </div>
              {r.responsavel && (
                <div className="flex shrink-0 items-center gap-1.5" title={`Responsável: ${r.responsavel}`}>
                  <Avatar nome={r.responsavel} className="h-6 w-6 text-[10px]" />
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
