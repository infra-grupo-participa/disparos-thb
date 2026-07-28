"use client";

import { MarcaPortal } from "@/app/_components/marca";
import { AtividadeColaboradores } from "@/app/_components/atividade-colaboradores";
import { usePortal } from "@/app/_components/use-portal";

// Atividade por colaborador nos portais genéricos (HT/SEM/CNHF) — o requisito
// da tarefa HT30: "operador faz tudo pelo próprio sistema + visão de todas as
// ações do operador". Mesma leitura do /hm/atividade (componente compartilhado),
// consumindo /api/atividade, que soma o bucket "Ligações" (atendimentos por
// telefone registrados pelo time). O RECORTE é do servidor: master vê todos,
// gestor a própria equipe, operador só a si — a tela mostra o que vier.

export default function AtividadePage() {
  const { portal, evento, nome, ehHT } = usePortal();

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-center gap-2.5">
          <MarcaPortal portal={portal} altura="h-7" comNome={false} />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {ehHT ? "Atividade" : `Atividade · ${nome}`}
          </h1>
        </div>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          O que cada colaborador fez no portal — movimentações, notas, disparos, ligações e demais
          ações assinadas. A lista respeita o seu nível: gestor vê a equipe; operador, as próprias ações.
        </p>
      </div>

      <AtividadeColaboradores endpoint="/api/atividade" params={{ evento }} comLigacoes />
    </div>
  );
}
