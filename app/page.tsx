import Link from "next/link";
import { MarcaCasa, MarcaPortal } from "@/app/_components/marca";
import { PORTAIS, type PortalId } from "@/lib/marcas";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";

// Tela inicial (pós-login): escolha do portal. Cada um é um espaço próprio —
// HT, Seminário e HM têm telas e dados isolados. Daqui se entra em /ht/*,
// /seminario/* ou /hm/*; a troca também fica no cabeçalho, dentro do sistema.
// A identidade de cada portal (nome, cor, logo) vem de lib/marcas.
// Controle de acesso (0145): só os portais liberados para a conta aparecem aqui.
// AURUM e ETHB (0155): board próprio = a MESMA esteira do HM recortada por
// produto (/aurum/kanban, /ethb/kanban). Já entram na seleção; o card só nasce
// nesses boards por cadastro manual (ou, no futuro, por compra da oferta do
// produto). Só aparecem para quem tem o portal na whitelist (0145).
const ORDEM: PortalId[] = ["ht", "seminario", "hm", "curso", "aurum", "ethb"];
const EVENTO_DO_SLUG: Record<PortalId, string> = { ht: "HT", seminario: "SEM", hm: "HM", curso: "CNHF", aurum: "AURUM", ethb: "ETHB" };

export default async function SelecaoPortal({ searchParams }: { searchParams: { sem_acesso?: string } }) {
  const sessao = await getSessao();
  const portais = sessao?.portais ?? [];
  const visiveis = ORDEM.filter((id) => podeAcessarPortal(portais, EVENTO_DO_SLUG[id]));
  const semAcesso = searchParams.sem_acesso;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <MarcaCasa altura="h-11" className="mb-3" />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Escolha o portal</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Cada evento tem o seu espaço, com telas e leads próprios.</p>
        {semAcesso && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
            Você não tem acesso a esse portal. Fale com um administrador do Grupo Participa.
          </p>
        )}
      </div>

      {visiveis.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-6 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Nenhum portal liberado para a sua conta ainda.<br />Peça a um administrador do Grupo Participa para liberar seu acesso.
        </p>
      ) : (
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {visiveis.map((id) => {
          const p = PORTAIS[id];
          return (
            <Link
              key={id}
              href={`/${id}/kanban`}
              className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop dark:border-slate-800 dark:bg-slate-900"
            >
              <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${p.gradiente}`} aria-hidden />
              {/* A marca do evento é o rosto do card: com logo oficial, ela ocupa
                  o lugar do nome; sem logo, entra o monograma e o título abaixo. */}
              <div className="flex h-12 items-center">
                <MarcaPortal portal={id} altura="h-10" comNome={false} />
              </div>
              <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">{p.nome}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.desc}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand dark:text-brand-300">
                Entrar
                <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
              </span>
            </Link>
          );
        })}
      </div>
      )}
    </div>
  );
}
