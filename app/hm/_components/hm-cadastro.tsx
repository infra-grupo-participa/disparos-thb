"use client";

import { useState } from "react";
import { Button, cn, fieldClass } from "@/app/_components/ui";

// Cadastro manual na esteira HM. A porta para quem o automático não pegou (o
// boleto do sinal que só aprova num UPDATE, invisível para a trigger AFTER
// INSERT) e para quem entra sem passar pela Hotmart (indicação, acordo por fora).
//
// O e-mail é a chave: se a pessoa já existe na base (a Hotmart pode tê-la
// gravado com outra grafia de nome), o cadastro reaproveita o comprador em vez
// de duplicar — e se ela já tem card, devolve o mesmo, sem criar um segundo.

type Resposta = {
  ok: boolean; reason?: string; compradorId?: string; jaExistia?: boolean; nome?: string;
};

const MOTIVO: Record<string, string> = {
  nome_obrigatorio: "Informe o nome.",
  email_obrigatorio: "Informe o e-mail.",
  estagio_invalido: "Etapa de destino inválida.",
};

export function HmCadastroModal({
  onClose, onCadastrado, produto = "HM",
}: {
  onClose: () => void;
  // Recebe o comprador_id criado/encontrado — a tela recarrega e pode abrir a ficha.
  onCadastrado: (compradorId: string, jaExistia: boolean) => void;
  // Board em que o card nasce (0155): HM (default), AURUM ou ETHB.
  produto?: "HM" | "AURUM" | "ETHB";
}) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [documento, setDocumento] = useState("");
  const [turma, setTurma] = useState("T39");
  const [categoria, setCategoria] = useState<"" | "sinal" | "compra_cheia">("");
  const [responsavel, setResponsavel] = useState("");
  const [estagio, setEstagio] = useState<"hm_comprou" | "hm_pendente_liberacao">("hm_comprou");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeEnviar = nome.trim() && email.trim() && !enviando;

  async function enviar() {
    if (!podeEnviar) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/hm/cadastrar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: nome.trim(),
          email: email.trim(),
          telefone: telefone.trim() || undefined,
          documento: documento.trim() || undefined,
          turma: turma.trim() || undefined,
          categoria: categoria || null,
          responsavel: responsavel.trim() || null,
          estagio_chave: estagio,
          produto,
        }),
      });
      const d: Resposta = await r.json();
      if (!d.ok) {
        // Erro do Zod vem em detalhes; o do banco em reason. Traduz o que dá.
        const detalhe = (d as { detalhes?: Array<{ erro: string }> }).detalhes?.[0]?.erro;
        setErro(MOTIVO[d.reason ?? ""] ?? detalhe ?? "Não foi possível cadastrar. Confira os dados.");
        return;
      }
      onCadastrado(d.compradorId!, d.jaExistia === true);
    } catch {
      setErro("Falha de rede. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <div
        className="mt-4 w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Cadastrar na esteira</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Para quem pagou e não apareceu, ou entrou por fora. O e-mail acha quem já existe — não duplica.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
          <label className="sm:col-span-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Nome <span className="text-rose-500">*</span>
            <input className={cn(fieldClass, "mt-1")} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" autoFocus />
          </label>
          <label className="sm:col-span-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
            E-mail <span className="text-rose-500">*</span>
            <input className={cn(fieldClass, "mt-1")} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" type="email" inputMode="email" />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Telefone
            <input className={cn(fieldClass, "mt-1")} value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="(35) 99714-8167" inputMode="tel" />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            CPF
            <input className={cn(fieldClass, "mt-1")} value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="somente números" inputMode="numeric" />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Turma
            <input className={cn(fieldClass, "mt-1")} value={turma} onChange={(e) => setTurma(e.target.value)} placeholder="T39" />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Operador
            <input className={cn(fieldClass, "mt-1")} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="opcional" />
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Entrada
            <select className={cn(fieldClass, "mt-1")} value={categoria} onChange={(e) => setCategoria(e.target.value as typeof categoria)}>
              <option value="">— não informada</option>
              <option value="sinal">Sinal (R$300)</option>
              <option value="compra_cheia">Compra cheia</option>
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
            Onde alocar
            <select className={cn(fieldClass, "mt-1")} value={estagio} onChange={(e) => setEstagio(e.target.value as typeof estagio)}>
              <option value="hm_comprou">Contato Inicial (comercial)</option>
              <option value="hm_pendente_liberacao">Pendente de Liberação (ativação)</option>
            </select>
          </label>
        </div>

        {erro && (
          <p className="mx-5 mb-1 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{erro}</p>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">O padrão — Contato Inicial — é a entrada do funil, igual a quem a Hotmart manda.</p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={enviando}>Cancelar</Button>
            <Button variant="primary" size="sm" onClick={enviar} disabled={!podeEnviar}>
              {enviando ? "Cadastrando…" : "Cadastrar"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
