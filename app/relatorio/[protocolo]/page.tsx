"use client";

// A folha de UM relatório emitido — fora da navegação por desenho (destino de leitura, não de
// navegação; TopNav se esconde sozinho aqui, ver app/_components/top-nav.tsx). Imutável: o
// conteúdo vem CONGELADO de cs.relatorio_emitido (lib/protocolo.ts:buscarRelatorioEmitido) —
// reabrir o mesmo protocolo amanhã mostra exatamente os mesmos números, nunca regenera.
import { useEffect, useState } from "react";
import { EmptyState, Spinner } from "@/app/_components/ui";
import { RelatorioFolha, type MetaRelatorio } from "@/app/_components/relatorio-folha";
import { msgErroCarregamento } from "@/app/_components/use-me";
import { PORTAIS, type PortalId } from "@/lib/marcas";
import type { ResultadoRelatorio } from "@/lib/relatorios/tipos";

type Estado =
  | { fase: "carregando" }
  | { fase: "nao_encontrado" }
  | { fase: "sem_permissao" }
  | { fase: "erro"; status?: number }
  | { fase: "ok"; resultado: ResultadoRelatorio; meta: MetaRelatorio };

// O prefixo do protocolo ('HM-20260816-0001' → 'HM') é o próprio código de portal
// (lib/protocolo.ts:proximoProtocolo recebe `opts.portal` = o produto, 'HM'|'AURUM'|'ETHB') —
// e casa 1:1 com Marca.evento em lib/marcas.ts. Não é chute: é o mesmo valor, só relido daqui.
function portalDoProtocolo(protocolo: string): PortalId | null {
  const prefixo = protocolo.split("-")[0];
  const entrada = (Object.entries(PORTAIS) as [PortalId, (typeof PORTAIS)[PortalId]][]).find(
    ([, m]) => m.evento === prefixo,
  );
  return entrada ? entrada[0] : null;
}

export default function RelatorioEmitidoPage({ params }: { params: { protocolo: string } }) {
  const protocolo = params.protocolo;
  const [estado, setEstado] = useState<Estado>({ fase: "carregando" });

  useEffect(() => {
    if (!protocolo) return;
    let cancelado = false;
    setEstado({ fase: "carregando" });
    fetch(`/api/relatorios/emitido/${encodeURIComponent(protocolo)}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({ ok: false }));
        if (cancelado) return;
        if (r.ok && d.ok) {
          const { meta, ...resultado } = d;
          setEstado({ fase: "ok", resultado, meta });
          return;
        }
        if (d.reason === "nao_encontrado") { setEstado({ fase: "nao_encontrado" }); return; }
        if (d.reason === "sem_permissao" || r.status === 403) { setEstado({ fase: "sem_permissao" }); return; }
        setEstado({ fase: "erro", status: r.status });
      })
      .catch(() => { if (!cancelado) setEstado({ fase: "erro" }); });
    return () => { cancelado = true; };
  }, [protocolo]);

  if (estado.fase === "carregando") {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
        <Spinner /> carregando protocolo {protocolo}…
      </div>
    );
  }

  if (estado.fase === "nao_encontrado") {
    return (
      <div className="mx-auto max-w-lg py-16">
        <EmptyState title="Protocolo não encontrado" description={`Não existe relatório emitido com o protocolo "${protocolo}". Confira o número — a folha nunca é apagada depois de emitida.`} />
      </div>
    );
  }

  if (estado.fase === "sem_permissao") {
    return (
      <div className="mx-auto max-w-lg py-16">
        <EmptyState title="Sem acesso a este relatório" description="Sua conta não tem o portal ou o escopo deste protocolo. Fale com um gestor ou o administrador do Grupo Participa se acha que deveria ver esta folha." />
      </div>
    );
  }

  if (estado.fase === "erro") {
    return (
      <div className="mx-auto max-w-lg py-16">
        <EmptyState title="Não foi possível carregar esta folha" description={msgErroCarregamento(estado.status)} />
      </div>
    );
  }

  return (
    <RelatorioFolha
      protocolo={protocolo}
      resultado={estado.resultado}
      meta={estado.meta}
      portalId={portalDoProtocolo(protocolo)}
    />
  );
}
