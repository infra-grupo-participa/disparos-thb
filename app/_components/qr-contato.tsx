"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

// QR do lead, para o comercial ligar do CELULAR sem digitar número (pedido do
// Victor, 26/08): a pessoa está no computador olhando o card, aponta o celular
// para a tela e cai direto na conversa — ou no discador.
//
// Dois destinos, um seletor:
//   · WhatsApp → https://wa.me/<numero>   abre a conversa com o lead
//   · Ligação  → tel:+<numero>            abre o discador JÁ COM O NÚMERO
// O `tel:` é URI nativa de iOS e Android: o leitor de QR reconhece e entrega ao
// telefone. Falta só apertar o botão de chamar — de propósito, discar sozinho
// não é permitido por nenhum dos dois sistemas.
//
// O QR é gerado AQUI, no navegador. Nenhum serviço externo de QR é chamado, o
// que evita mandar o telefone do lead para fora — é dado de lead, não enfeite.

type Destino = "whatsapp" | "ligacao";

/** Só dígitos, e com o 55 na frente quando o número vier sem país. */
export function normalizaTelefone(bruto: string | null | undefined): string | null {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;          // nem DDD + número: não dá para ligar
  return d.startsWith("55") ? d : `55${d}`;
}

export function destinoUrl(numero: string, destino: Destino): string {
  return destino === "whatsapp" ? `https://wa.me/${numero}` : `tel:+${numero}`;
}

export function QrContato({ telefone, nome }: { telefone: string | null; nome?: string }) {
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState<Destino>("whatsapp");
  const [erro, setErro] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const numero = normalizaTelefone(telefone);

  useEffect(() => {
    if (!aberto || !numero || !canvas.current) return;
    QRCode.toCanvas(canvas.current, destinoUrl(numero, destino), {
      width: 208, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    }).then(() => setErro(null)).catch((e) => setErro(String(e?.message ?? e)));
  }, [aberto, destino, numero]);

  if (!numero) return null;   // sem telefone utilizável, o botão não existe

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Mostrar QR para abrir no celular"
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-200 transition-colors hover:bg-sky-100 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M3 3h8v8H3V3Zm2 2v4h4V5H5Zm8-2h8v8h-8V3Zm2 2v4h4V5h-4ZM3 13h8v8H3v-8Zm2 2v4h4v-4H5Zm10-2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v4h-4v-2h2v-2Z" />
        </svg>
        QR
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setAberto(false)}
          role="dialog"
          aria-modal="true"
          aria-label="QR para abrir no celular"
        >
          <div
            className="w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{nome ?? "Lead"}</p>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">+{numero}</p>
              </div>
              <button
                type="button" onClick={() => setAberto(false)} aria-label="Fechar"
                className="rounded-md px-2 py-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              >✕</button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {([["whatsapp", "WhatsApp"], ["ligacao", "Ligação"]] as const).map(([id, rot]) => (
                <button
                  key={id} type="button" onClick={() => setDestino(id)}
                  aria-pressed={destino === id}
                  className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                    destino === id
                      ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  }`}
                >{rot}</button>
              ))}
            </div>

            <div className="flex justify-center rounded-xl bg-white p-3 ring-1 ring-slate-200 dark:ring-slate-700">
              {erro
                ? <p className="py-16 text-center text-xs text-rose-500">Não consegui gerar o QR: {erro}</p>
                : <canvas ref={canvas} className="h-52 w-52" />}
            </div>

            <p className="mt-3 text-center text-[11px] leading-snug text-slate-500 dark:text-slate-400">
              {destino === "whatsapp"
                ? "Aponte o celular: abre a conversa no WhatsApp."
                : "Aponte o celular: abre o discador com o número pronto."}
            </p>

            {/* Quem já está no celular não precisa escanear a própria tela. */}
            <a
              href={destinoUrl(numero, destino)}
              target="_blank" rel="noreferrer"
              className="mt-3 block rounded-lg bg-slate-900 px-3 py-2 text-center text-xs font-medium text-white transition-colors hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              {destino === "whatsapp" ? "Abrir WhatsApp aqui" : "Ligar deste aparelho"}
            </a>
          </div>
        </div>
      )}
    </>
  );
}
