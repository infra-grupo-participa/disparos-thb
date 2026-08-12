"use client";

// Selo do NÍVEL efetivo (master / gestor / operador). O nível é DERIVADO de
// papel × equipe × estrela de líder — a regra mora em lib/papeis.nivelDe e este
// componente só a EXIBE. NUNCA reimplementar a derivação aqui: cada tela
// combinando os campos por conta própria foi exatamente o que gerou os furos
// fechados em 27/07.
//
// Degradação honesta: se a rota que alimentou a tela NÃO mandou os campos de
// equipe (equipe_tipo / lider_equipe indefinidos), o selo assume o estado
// "não sei" em vez de chutar — um admin sem equipe_tipo tanto pode ser master
// (GP) quanto gestor (equipe comum), e mostrar o errado é pior que não mostrar.

import { nivelDe, type Nivel, type Papel, type TipoEquipe } from "@/lib/papeis";
import { cn } from "@/app/_components/ui";

// O que o selo precisa saber sobre a conta. `undefined` = "a rota não mandou o
// campo" (degrada); `null` = "veio, e é vazio" (conta sem equipe / sem estrela).
export type UsuarioSeloNivel = {
  id: string;
  papel: Papel | null | undefined;
  equipe_id?: string | null;
  equipe_tipo?: TipoEquipe | null;
  lider_equipe?: boolean | null;
  // 11/08: a flag muda MUITO o que a pessoa pode (vê e age na esteira inteira,
  // distribui para qualquer equipe). Um "gestor" com ela e outro sem são coisas
  // diferentes — o selo tem de dizer isso, senão a tela mente por omissão.
  gerente_distribuidor?: boolean | null;
};

const ESTILO: Record<Nivel, string> = {
  master: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300",
  gestor: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  operador: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const ICONE: Record<Nivel, React.ReactNode> = {
  // Escudo: o master gere o sistema inteiro.
  master: (
    <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" /></svg>
  ),
  // Estrela: ecoa a estrela de líder — os dois caminhos (admin de equipe ou
  // estrela) desembocam no MESMO nível.
  gestor: (
    <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z" /></svg>
  ),
  operador: (
    <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
  ),
};

function tituloDe(nivel: Nivel, u: UsuarioSeloNivel): string {
  if (u.gerente_distribuidor) {
    return "Gerente — vê e trabalha a esteira INTEIRA (todas as equipes) e distribui card para qualquer pessoa, travando a atribuição para o operador não desfazer. NÃO gere contas, portais nem equipes.";
  }
  if (nivel === "master") {
    return "Master — Administrador da equipe Grupo Participa (principal). Vê e gere tudo: contas, equipes, canais e todos os cards.";
  }
  if (nivel === "gestor") {
    const motivo = u.papel === "admin" ? "é Administrador de uma equipe" : "tem a estrela de líder";
    return `Gestor — ${motivo}. Vê e distribui os cards da PRÓPRIA equipe (e puxa do pool).`;
  }
  return "Operador — vê o pool e os cards atribuídos a ele; assume só para si.";
}

// O selo em si. Reusado pelo SeloNivel e pela LegendaNiveis, para a legenda
// mostrar EXATAMENTE o que aparece nas listas.
function Selinho({ nivel, title, className }: { nivel: Nivel; title?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
        ESTILO[nivel],
        className,
      )}
      title={title}
    >
      {ICONE[nivel]}
      {nivel}
    </span>
  );
}

export function SeloNivel({ usuario, className }: { usuario: UsuarioSeloNivel; className?: string }) {
  // Dá para calcular o nível com o que veio? Para um admin, a dúvida é a equipe
  // (GP = master, outra = gestor); para os demais, é a estrela de líder
  // (com = gestor, sem = operador).
  const completo = usuario.papel === "admin" ? usuario.equipe_tipo !== undefined : usuario.lider_equipe !== undefined;
  if (!completo) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded border border-dashed border-slate-300 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-600 dark:text-slate-500",
          className,
        )}
        title="Nível não calculado: esta lista ainda não informa a equipe/estrela desta conta. O nível é papel × equipe — veja a legenda ou a tela de Equipes."
      >
        nível ?
      </span>
    );
  }
  const nivel = nivelDe({
    id: usuario.id,
    papel: usuario.papel,
    equipe_id: usuario.equipe_id ?? null,
    equipe_tipo: usuario.equipe_tipo ?? null,
    lider_equipe: usuario.lider_equipe ?? false,
  });
  if (usuario.gerente_distribuidor && nivel !== "master") {
    return (
      <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
        <Selinho nivel={nivel} title={tituloDe(nivel, usuario)} />
        <SeloGerente />
      </span>
    );
  }
  return <Selinho nivel={nivel} title={tituloDe(nivel, usuario)} className={className} />;
}

// Selo próprio, ao lado do nível: gerente é um ACRÉSCIMO ao nível, não um nível
// novo — quem tem a flag continua sendo gestor (ou operador) para tudo o mais.
export function SeloGerente({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
        "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
        className,
      )}
      title="Gerente — vê e trabalha a esteira inteira, de todas as equipes, e distribui card para qualquer pessoa. Não gere contas, portais nem equipes."
    >
      <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
      gerente
    </span>
  );
}

// Explicação em TEXTO VISÍVEL (não só no hover do title) do que o nível desta
// conta permite — usada junto do SeloNivel nas telas de gestão (0155, pedido
// do Marcio: quem administra precisa bater o olho e entender "o que esta
// pessoa consegue fazer" sem abrir o código nem passar o mouse). Reaproveita
// tituloDe: a MESMA frase do title, só que sempre visível em vez de escondida.
export function DescricaoNivel({ usuario, className }: { usuario: UsuarioSeloNivel; className?: string }) {
  const completo = usuario.papel === "admin" ? usuario.equipe_tipo !== undefined : usuario.lider_equipe !== undefined;
  if (!completo) {
    return (
      <p className={cn("text-xs text-slate-400 dark:text-slate-500", className)}>
        Nível não calculado — esta lista ainda não trouxe a equipe/estrela desta conta.
      </p>
    );
  }
  const nivel = nivelDe({
    id: usuario.id,
    papel: usuario.papel,
    equipe_id: usuario.equipe_id ?? null,
    equipe_tipo: usuario.equipe_tipo ?? null,
    lider_equipe: usuario.lider_equipe ?? false,
  });
  return <p className={cn("text-xs text-slate-500 dark:text-slate-400", className)}>{tituloDe(nivel, usuario)}</p>;
}

// Legenda curta de "como se produz cada nível" — para o Marcio olhar a tela de
// Contas e saber que botão mexer.
export function LegendaNiveis({ className }: { className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400", className)}>
      <Selinho nivel="master" />
      <span>= Administrador da equipe Grupo Participa (vê e gere tudo)</span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <Selinho nivel="gestor" />
      <span>= Administrador de outra equipe OU líder (estrela, na tela de Equipes) — distribui na própria equipe</span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <Selinho nivel="operador" />
      <span>= os demais (pool + os próprios cards)</span>
      <span className="text-slate-300 dark:text-slate-600">·</span>
      <SeloGerente />
      <span>= acréscimo ao nível: trabalha a esteira inteira e distribui para qualquer equipe</span>
    </p>
  );
}
