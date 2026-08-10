"use client";

import { MarcaPortal } from "@/app/_components/marca";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { useMe } from "@/app/_components/use-me";
import { AtividadeColaboradores } from "@/app/_components/atividade-colaboradores";

// Registro de atividade por colaborador (A1). Responde "quem fez o quê" na
// esteira HM no período — movimentações, notas, disparos e as demais ações
// assinadas (responsável, tag, pagamento, cadastro). A captura é a timeline;
// esta tela é a leitura agregada por pessoa. A tabela em si é compartilhada
// com a tela genérica dos portais (atividade-colaboradores).

export default function HmAtividadePage() {
  // podeDistribuir → a aba "Equipes" do alternador aparece para master e gestor.
  const { podeDistribuir } = useMe();
  const { produto, portal, nome: nomePortal } = useProdutoHm(); // board, marca e título

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Atividade · {nomePortal}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            O que cada colaborador fez na esteira — movimentações, notas, disparos e as demais ações assinadas.
          </p>
        </div>
        <HmVisao atual="atividade" filtros={{}} podeConfig={podeDistribuir()} />
      </div>

      {/* O board vai no endpoint (0164): sem `?produto=`, a Atividade do Aurum
          mostrava o movimento do HM — esta tela não usa o useFetchHm. */}
      <AtividadeColaboradores endpoint={produto === "HM" ? "/api/hm/atividade" : `/api/hm/atividade?produto=${produto}`} />
    </div>
  );
}
