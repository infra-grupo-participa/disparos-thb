// deno test supabase/functions/hotmart-events-webhook/avisar.test.ts
// O fetch do Slack é mockado (globalThis.fetch); a porta do banco é um dublê que
// registra as chamadas. Nenhuma rede real.
import { assertEquals } from "jsr:@std/assert@1";
import type { Aviso } from "./decidir_aviso.ts";
import { avisarUmaVez, type PortaDeAviso, postarNoSlack } from "./avisar.ts";

const URL_SLACK = "https://hooks.slack.invalid/teste";
const AVISO: Aviso = { tipo: "VENDA", chave: "HP0000000001" };
const CORPO = { text: "teste" };

function porta(reivindica: boolean) {
  const chamadas = { reivindicar: 0, liberar: [] as Aviso[] };
  const p: PortaDeAviso = {
    reivindicar: () => { chamadas.reivindicar++; return Promise.resolve(reivindica); },
    liberar: (a) => { chamadas.liberar.push(a); return Promise.resolve(); },
  };
  return { p, chamadas };
}

async function comFetch<T>(resposta: () => Promise<Response>, fn: (posts: string[]) => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const posts: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    posts.push(String(input));
    return resposta();
  }) as typeof fetch;
  try {
    return await fn(posts);
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("Slack devolve 500: publicar dá false e a chave é LIBERADA", async () => {
  const { p, chamadas } = porta(true);
  const publicou = await comFetch(
    () => Promise.resolve(new Response("erro", { status: 500 })),
    async (posts) => {
      const r = await avisarUmaVez(AVISO, "HM", () => postarNoSlack(URL_SLACK, CORPO, "teste"), p);
      assertEquals(posts, [URL_SLACK]);
      return r;
    },
  );
  assertEquals(publicou, false);
  assertEquals(chamadas.reivindicar, 1);
  assertEquals(chamadas.liberar, [AVISO]);
});

Deno.test("Slack lança exceção (rede/timeout): chave liberada", async () => {
  const { p, chamadas } = porta(true);
  const publicou = await comFetch(
    () => Promise.reject(new TypeError("conexão recusada")),
    () => avisarUmaVez(AVISO, "HM", () => postarNoSlack(URL_SLACK, CORPO, "teste"), p),
  );
  assertEquals(publicou, false);
  assertEquals(chamadas.liberar, [AVISO]);
});

Deno.test("Slack devolve 200: publica e NÃO libera", async () => {
  const { p, chamadas } = porta(true);
  const publicou = await comFetch(
    () => Promise.resolve(new Response("ok", { status: 200 })),
    () => avisarUmaVez(AVISO, "HM", () => postarNoSlack(URL_SLACK, CORPO, "teste"), p),
  );
  assertEquals(publicou, true);
  assertEquals(chamadas.liberar, []);
});

Deno.test("chave já reivindicada (2º envio da Hotmart): não chama o Slack nem libera", async () => {
  const { p, chamadas } = porta(false);
  await comFetch(
    () => Promise.resolve(new Response("ok", { status: 200 })),
    async (posts) => {
      assertEquals(await avisarUmaVez(AVISO, "HM", () => postarNoSlack(URL_SLACK, CORPO, "teste"), p), false);
      assertEquals(posts, []);
    },
  );
  assertEquals(chamadas.liberar, []);
});

Deno.test("liberação que falha não derruba o fluxo (não fatal)", async () => {
  const p: PortaDeAviso = {
    reivindicar: () => Promise.resolve(true),
    liberar: () => Promise.reject(new Error("banco fora")),
  };
  const publicou = await comFetch(
    () => Promise.resolve(new Response("erro", { status: 500 })),
    () => avisarUmaVez(AVISO, "HM", () => postarNoSlack(URL_SLACK, CORPO, "teste"), p),
  );
  assertEquals(publicou, false);
});

Deno.test("NADA: nem reivindica", async () => {
  const { p, chamadas } = porta(true);
  assertEquals(await avisarUmaVez({ tipo: "NADA", chave: null }, "HM", () => Promise.resolve(true), p), false);
  assertEquals(chamadas.reivindicar, 0);
});
