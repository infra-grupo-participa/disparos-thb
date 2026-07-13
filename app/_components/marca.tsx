import Image from "next/image";
import { MARCA_CASA, PORTAIS, type PortalId } from "@/lib/marcas";
import { cn } from "./ui";

// Marca do evento. Onde há SVG oficial (public/marcas/<id>.svg) a logo aparece;
// onde ainda não há, o portal se apresenta pelo monograma da sigla na cor dele —
// o mesmo desenho que o sistema já usava. Trocar um pelo outro é uma linha em
// lib/marcas, e nenhuma tela precisa saber qual dos dois está em uso.
//
// `unoptimized`: o otimizador de imagens do Next não processa SVG (exigiria
// dangerouslyAllowSVG); como o arquivo é nosso e estático, servi-lo direto de
// /public é o caminho certo.

type Props = {
  portal: PortalId;
  /** Altura da marca em classe Tailwind (a largura acompanha). */
  altura?: string;
  /** Mostra o nome do portal ao lado do monograma (ignorado quando há logo). */
  comNome?: boolean;
  className?: string;
};

export function MarcaPortal({ portal, altura = "h-8", comNome = true, className }: Props) {
  const m = PORTAIS[portal];

  if (m.logo && m.logoRatio) {
    const [w, h] = m.logoRatio;
    return (
      <Image
        src={m.logo}
        alt={m.nome}
        width={w}
        height={h}
        unoptimized
        priority
        className={cn(altura, "w-auto", className)}
      />
    );
  }

  return (
    <span className={cn("flex items-center gap-2", className)}>
      <span
        className={cn("flex aspect-square items-center justify-center rounded-lg text-xs font-bold text-white shadow-card", altura)}
        style={{ backgroundColor: m.cor }}
        title={m.nome}
      >
        {m.sigla}
      </span>
      {comNome && (
        <span className="hidden truncate text-sm font-semibold text-slate-800 sm:block dark:text-slate-100">{m.nome}</span>
      )}
    </span>
  );
}

// Marca da casa — login e topo da tela de seleção.
export function MarcaCasa({ altura = "h-11", className }: { altura?: string; className?: string }) {
  if (MARCA_CASA.logo && MARCA_CASA.logoRatio) {
    const [w, h] = MARCA_CASA.logoRatio;
    return (
      <Image src={MARCA_CASA.logo} alt={MARCA_CASA.nome} width={w} height={h} unoptimized priority className={cn(altura, "w-auto", className)} />
    );
  }
  return (
    <span
      className={cn(
        "flex aspect-square items-center justify-center rounded-2xl bg-brand text-base font-semibold tracking-wide text-white shadow-card",
        altura,
        className,
      )}
    >
      {MARCA_CASA.sigla}
    </span>
  );
}
