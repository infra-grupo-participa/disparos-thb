"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/app/_components/ui";

// Utilitários de animação (GSAP). Mantidos sutis e só na entrada — é uma
// ferramenta de trabalho, não uma vitrine. Respeitam prefers-reduced-motion.

const prefersReduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Revela em cascata os filhos com a classe .js-reveal e faz as barras
// .js-bar crescerem da esquerda. Roda uma vez, na montagem.
export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReduced()) return;
      const root = scope.current!;
      const itens = root.querySelectorAll(".js-reveal");
      if (itens.length) {
        gsap.from(itens, { opacity: 0, y: 16, duration: 0.5, ease: "power2.out", stagger: 0.06 });
      }
      root.querySelectorAll<HTMLElement>(".js-bar").forEach((el) => {
        const alvo = el.style.width || getComputedStyle(el).width;
        gsap.fromTo(el, { width: 0 }, { width: alvo, duration: 0.9, ease: "power3.out", delay: 0.2 });
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

// Conta de 0 (ou do valor anterior) até `value`, reanimando quando muda — bom
// para os KPIs do dashboard, que repollam ao vivo. SSR-safe (já renderiza o valor).
export function AnimNum({
  value,
  suffix = "",
  duration = 1,
  className,
}: {
  value: number;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR") + suffix;
  useGSAP(
    () => {
      const el = ref.current!;
      if (prefersReduced()) {
        el.textContent = fmt(value);
        prev.current = value;
        return;
      }
      const obj = { v: prev.current };
      el.textContent = fmt(prev.current);
      gsap.to(obj, {
        v: value,
        duration,
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
