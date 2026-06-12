"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { cn } from "@/app/_components/ui";

// Utilitários de animação (GSAP). Filosofia anti-enjoo: animar UMA vez por
// sessão (não a cada visita/troca de aba) e só na entrada — é uma ferramenta de
// trabalho. Respeitam prefers-reduced-motion. Use `id`/`animKey` p/ o "1x/sessão".

const prefersReduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function sessionGet(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function sessionSet(key: string, v: string) {
  try { sessionStorage.setItem(key, v); } catch { /* noop */ }
}

// Revela em cascata os filhos .js-reveal e faz as barras .js-bar crescerem.
// Com `id`, roda só na 1ª vez da sessão; depois entra seco (sem replay).
export function Reveal({ children, className, id }: { children: React.ReactNode; className?: string; id?: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (prefersReduced()) return;
      const key = id ? `reveal:${id}` : null;
      if (key && sessionGet(key)) return; // já animou nesta sessão → entra direto
      const root = scope.current!;
      const itens = root.querySelectorAll(".js-reveal");
      if (itens.length) {
        gsap.from(itens, { opacity: 0, y: 16, duration: 0.5, ease: "power2.out", stagger: 0.06 });
      }
      root.querySelectorAll<HTMLElement>(".js-bar").forEach((el) => {
        const alvo = el.style.width || getComputedStyle(el).width;
        gsap.fromTo(el, { width: 0 }, { width: alvo, duration: 0.9, ease: "power3.out", delay: 0.2 });
      });
      if (key) sessionSet(key, "1");
    },
    { scope },
  );
  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}

// Conta até `value`. Com `animKey`: na 1ª vez da sessão rola de 0→valor; em
// revisitas entra direto no valor; e quando o valor muda ao vivo, anima só o
// delta (prev→novo). Sem `animKey`, rola de 0 a cada montagem. SSR-safe.
export function AnimNum({
  value,
  suffix = "",
  duration = 1,
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
  const fmt = (n: number) => Math.round(n).toLocaleString("pt-BR") + suffix;
  useGSAP(
    () => {
      const el = ref.current!;
      const key = animKey ? `num:${animKey}` : null;
      if (prefersReduced()) {
        el.textContent = fmt(value);
        if (key) sessionSet(key, String(value));
        return;
      }
      const baseRaw = key ? sessionGet(key) : null;
      const base = baseRaw != null ? parseFloat(baseRaw) : 0;
      const obj = { v: base };
      el.textContent = fmt(base);
      gsap.to(obj, {
        v: value,
        duration: Math.abs(value - base) < 0.5 ? 0 : duration,
        ease: "power2.out",
        onUpdate: () => { el.textContent = fmt(obj.v); },
      });
      if (key) sessionSet(key, String(value));
    },
    { dependencies: [value], scope: ref },
  );
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {fmt(value)}
    </span>
  );
}
