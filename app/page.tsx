import Link from "next/link";

// Tela inicial (pós-login): escolha do portal. Cada um é um espaço próprio —
// HT e Seminário têm telas e dados isolados. Daqui se entra em /ht/* ou
// /seminario/*; a troca também fica disponível no cabeçalho dentro do sistema.
const PORTAIS = [
  {
    id: "ht",
    nome: "Holding Total",
    desc: "Jornada dos compradores do HT — onboarding, grupo e ativação.",
    cor: "#F97316",
    de: "from-orange-500",
    para: "to-amber-400",
  },
  {
    id: "seminario",
    nome: "Seminário",
    desc: "Leads do Seminário — qualificação, grupo e comercial.",
    cor: "#2563EB",
    de: "from-blue-600",
    para: "to-sky-400",
  },
];

export default function SelecaoPortal() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-base font-bold text-white shadow-card">CS</span>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Escolha o portal</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Cada evento tem o seu espaço, com telas e contatos próprios.</p>
      </div>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
        {PORTAIS.map((p) => (
          <Link
            key={p.id}
            href={`/${p.id}/kanban`}
            className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-card transition hover:-translate-y-0.5 hover:shadow-pop dark:border-slate-800 dark:bg-slate-900"
          >
            <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${p.de} ${p.para}`} aria-hidden />
            <span className="flex h-10 w-10 items-center justify-center rounded-lg text-white shadow-card" style={{ backgroundColor: p.cor }}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75-9.75A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v9.75A2.25 2.25 0 0 1 18 18h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z" /></svg>
            </span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900 dark:text-slate-100">{p.nome}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.desc}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand dark:text-brand-300">
              Entrar
              <svg className="h-4 w-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
