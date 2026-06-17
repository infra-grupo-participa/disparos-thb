"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Renderiza os filhos em document.body — fora de qualquer ancestral com
// transform/filter/backdrop-blur, que viram "containing block" e quebram o
// position:fixed (o modal de confirmação se ancorava ao DisparoModal, que tem
// backdrop-blur, e saía da viewport ao rolar). SSR-safe: só monta no cliente.
export function Portal({ children }: { children: ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  if (!montado) return null;
  return createPortal(children, document.body);
}
