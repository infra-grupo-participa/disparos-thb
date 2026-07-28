"use client";

import { useCallback } from "react";
import { useProdutoHm } from "./use-produto";

// Fetch com o produto embutido (0155). As telas da esteira (HM/Aurum/ETHB) são
// as MESMAS; o que muda é o board. Este helper anexa ?produto= às chamadas de
// /api/hm/* quando se está num board Aurum/ETHB — para o backend recortar o
// board certo — sem que cada tela precise saber disso. Em HM (default) não
// altera a URL, então o comportamento histórico é idêntico.
export function useFetchHm() {
  const { produto } = useProdutoHm();
  return useCallback(
    (input: string, init?: RequestInit) => {
      if (produto === "HM") return fetch(input, init);
      // Só anexa em chamadas de leitura da esteira; preserva query existente.
      const [path, qs] = input.split("?");
      const sp = new URLSearchParams(qs);
      if (!sp.has("produto")) sp.set("produto", produto);
      return fetch(`${path}?${sp.toString()}`, init);
    },
    [produto],
  );
}
