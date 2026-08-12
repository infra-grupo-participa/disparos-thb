// Biblioteca de componentes atômicos do design system.
// Atoms reutilizáveis para garantir consistência visual entre as telas.
import type { ReactNode } from "react";

// Junta classes condicionalmente (sem dependência externa).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

// Classe-base para campos de formulário (input, select, textarea).
// `alvo-toque` também no CAMPO (11/08): a busca do board media 32px no celular
// — errar o toque num campo de texto custa mais que num botão, porque o teclado
// só abre se o foco pegar. A classe só age em tela sem mouse (globals.css).
export const fieldClass =
  "alvo-toque w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-xs outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/15";

// O mesmo campo, na largura do conteúdo — para selects de barra de filtro.
// Existe porque `cn` concatena sem resolver conflito de Tailwind: um "w-auto"
// passado por cima de fieldClass NÃO vence o "w-full" dele (quem decide é a
// ordem no CSS gerado, não a ordem na string) e o select explode para a linha
// inteira, empilhando os filtros.
//
// O recorte é por PALAVRA, em qualquer posição da string (11/08). Era `^w-full `
// — ancorado no começo — e bastou `alvo-toque` entrar na frente de fieldClass
// para o replace parar de casar: `w-full` sobreviveu, e os três filtros do board
// do HT viraram três caixas empilhadas ocupando um terço da tela. Só apareceu
// olhando a captura; nenhum teste reclamou.
export const fieldCompactClass = fieldClass.replace(/(^|\s)w-full(\s|$)/, "$1");

// ---- Button -------------------------------------------------------------
type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "icon";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

const BTN_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-brand text-white shadow-card hover:bg-brand-light dark:bg-brand-500 dark:hover:bg-brand-400",
  secondary: "border border-slate-300 bg-white text-slate-700 shadow-card hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
  ghost: "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800",
  danger: "bg-rose-600 text-white shadow-card hover:bg-rose-700 dark:bg-rose-600 dark:hover:bg-rose-500",
};
const BTN_SIZES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
  // Botão só-ícone (fechar drawer, ações compactas): quadrado, sem padding
  // extra — o ícone centraliza pelo flex do próprio Button.
  icon: "h-8 w-8 text-sm",
};

export function Button({ children, variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  return (
    <button
      className={cn(
        // `alvo-toque` no COMPONENTE (11/08): a validação no Chromium a 412px
        // mediu 30-32px em botão de export, cadastro e filtro — o dedo erra.
        // A classe só age em telas sem mouse (globals.css), então o desktop
        // continua com a mesma densidade.
        "alvo-toque inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
        BTN_VARIANTS[variant],
        BTN_SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---- Card ---------------------------------------------------------------
export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-xl border border-slate-200/80 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900", className)}>{children}</div>;
}

// ---- PageHeader ---------------------------------------------------------
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---- EmptyState ---------------------------------------------------------
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900/40">
      {icon && <div className="mb-3 text-slate-300 dark:text-slate-600">{icon}</div>}
      <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---- Spinner ------------------------------------------------------------
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin text-slate-400", className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}
