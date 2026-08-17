import type { DefinicaoRelatorio } from "@/lib/relatorios/tipos";
import { carteiraComercial } from "@/lib/relatorios/carteira-comercial";
import { acoesDoComercial } from "@/lib/relatorios/acoes-do-comercial";
import { visaoGeral } from "@/lib/relatorios/visao-geral";

// O ÍNDICE — único arquivo que lista os relatórios. Acrescentar um relatório novo é
// acrescentar 1 arquivo (que reusa um serviço já existente, ver tipos.ts §4.1) + 1 linha
// aqui. A tela (F5) nunca muda: ela lê GET /api/relatorios e monta o dropdown com o que
// voltar — nenhum `if (tipo === ...)` em lugar nenhum.
export const REGISTRY: DefinicaoRelatorio[] = [carteiraComercial, acoesDoComercial, visaoGeral];

const PESO_NIVEL: Record<"operador" | "gestor" | "master", number> = { operador: 0, gestor: 1, master: 2 };

/** Os relatórios que ESTA sessão pode gerar NESTE portal — nível mínimo + portal, os dois
 *  filtrados aqui (nunca no front). */
export function relatoriosDisponiveis(
  sessao: { nivel: "master" | "gestor" | "operador" },
  portal: string,
): DefinicaoRelatorio[] {
  return REGISTRY.filter((r) => {
    if (!r.portais.includes(portal as DefinicaoRelatorio["portais"][number])) return false;
    if (r.nivel && PESO_NIVEL[sessao.nivel] < PESO_NIVEL[r.nivel]) return false;
    return true;
  });
}

export function relatorioPorId(id: string): DefinicaoRelatorio | undefined {
  return REGISTRY.find((r) => r.id === id);
}
