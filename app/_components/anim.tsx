"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/app/_components/ui";

// Utilitários de animação (GSAP). Dão vida ao sistema de forma SUTIL: animam na
// entrada de cada tela (e a cada refresh/navegação), mas só na montagem — não
// repetem no polling de 15s. Respeitam prefers-reduced-motion.
// `id`/`animKey` são opcionais (compat.) e hoje não restringem a animação.

const prefersReduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Revela em cascata os filhos .js-reveal e faz as barras .js-bar crescerem.
// Roda uma vez por montagem (entra/atualiza), não no polling.
export function Reveal({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  void id;
  useGSAP(
    () => {
      if (prefersReduced()) return;
      const root = scope.current!;
      const itens = root.querySelectorAll(".js-reveal");
      if (itens.length) {
        gsap.from(itens, { opacity: 0, y: 10, duration: 0.4, ease: "power2.out", stagger: 0.05 });
      }
      root.querySelectorAll<HTMLElement>(".js-bar").forEach((el) => {
        const alvo = el.style.width || getComputedStyle(el).width;
        gsap.fromTo(el, { width: 0 }, { width: alvo, duration: 0.7, ease: "power3.out", delay: 0.1 });
      });
    },
    { scope },
  );
  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}

// Fade sutil do bloco inteiro na entrada — ideal p/ telas de lista (Contatos,
// Inbox), onde animar item a item travaria/cansaria. Anima o próprio container.
export function PageFade({ children, className }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReduced()) return;
      gsap.from(scope.current!, { opacity: 0, y: 8, duration: 0.4, ease: "power2.out" });
    },
    { scope },
  );
  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}

// Conta até `value`. No mount rola de 0→valor; quando o valor muda ao vivo,
// anima só o delta (prev→novo) — sutil e informativo. SSR-safe.
export function AnimNum({
  value,
  suffix = "",
  duration = 0.6,
  className,
  animKey,
}: {
  value: number;
  suffix?: string;
  duration?: number;
  className?: string;
  animKey?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR") + suffix;
  void animKey;
  useGSAP(
    () => {
      const el = ref.current!;
      if (prefersReduced()) {
        el.textContent = fmt(value);
        prev.current = value;
        return;
      }
      const base = prev.current;
      const obj = { v: base };
      el.textContent = fmt(base);
      gsap.to(obj, {
        v: value,
        duration: Math.abs(value - base) < 0.5 ? 0 : duration,
        ease: "power2.out",
        onUpdate: () => { el.textContent = fmt(obj.v); },
      });
      prev.current = value;
    },
    { dependencies: [value], scope: ref },
  );
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {fmt(value)}
    </span>
  );
}
