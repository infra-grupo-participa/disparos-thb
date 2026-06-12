import { cn } from "@/app/_components/ui";

// Avatar com inicial colorida — cor derivada do nome (estável). Reutilizado no
// menu de usuário, na gestão de usuários e no card do Kanban (responsável).
const AVATAR = [
  "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300",
  "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
];

export function corAvatar(nome: string): string {
  let h = 0;
  for (let i = 0; i < (nome?.length || 0); i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return AVATAR[h % AVATAR.length];
}

export function inicial(nome: string): string {
  return (nome?.trim()?.[0] || "?").toUpperCase();
}

export function Avatar({ nome, className }: { nome: string; className?: string }) {
  return (
    <span
      title={nome}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        corAvatar(nome),
        className || "h-9 w-9 text-sm",
      )}
    >
      {inicial(nome)}
    </span>
  );
}
