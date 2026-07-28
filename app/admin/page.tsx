"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, PageHeader, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { Avatar } from "@/app/_components/avatar";

// Central de administração (28/07): um só lugar para gerir o sistema, qualquer
// que seja o portal. As áreas que já têm tela própria (contas, equipes, canais
// de disparo) entram como ATALHOS — não reescrevo o que funciona. A peça nova,
// que ainda não tinha casa, mora AQUI: canal de aquisição → pessoa (0154), cuja
// API (/api/hm/equipes/usuario-canais) já existe. Gate: só master (layout).

type Vinculo = { usuario_id: string; canal: string; usuario_nome: string };
type Usuario = { id: string; nome: string; email: string; ativo: boolean };

const ATALHOS = [
  { href: "/usuarios", titulo: "Contas e portais", desc: "Quem acessa o sistema, o cargo e a quais portais (HT, HM, Aurum, ETHB…) cada conta tem acesso." },
  { href: "/hm/equipes", titulo: "Equipes", desc: "Composição das equipes, líderes, cores, rotas de canal→equipe e a equipe padrão das vendas novas." },
  { href: "/canais", titulo: "Canais de disparo", desc: "Credenciais de API (WhatsApp) por evento — o que cada portal usa para disparar." },
];

export default function AdminPage() {
  const [vinculos, setVinculos] = useState<Vinculo[]>([]);
  const [canais, setCanais] = useState<string[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoUsuario, setNovoUsuario] = useState("");
  const [novoCanal, setNovoCanal] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [rc, ru] = await Promise.all([
        fetch("/api/hm/equipes/usuario-canais"),
        fetch("/api/usuarios"),
      ]);
      const dc = await rc.json();
      if (dc.ok) { setVinculos(dc.vinculos); setCanais(dc.canais); }
      const du = await ru.json();
      if (du.ok) setUsuarios((du.usuarios as Usuario[]).filter((u) => u.ativo));
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function salvarVinculo(usuario_id: string, canal: string, acao: "vincular" | "remover") {
    const r = await fetch("/api/hm/equipes/usuario-canais", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario_id, canal, acao }),
    });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível salvar o vínculo."); return; }
    await carregar();
  }

  // Agrupa os vínculos por pessoa, para a lista ficar legível ("Fulano cuida de X, Y").
  const porUsuario = new Map<string, { nome: string; canais: string[] }>();
  for (const v of vinculos) {
    const at = porUsuario.get(v.usuario_id) ?? { nome: v.usuario_nome, canais: [] };
    at.canais.push(v.canal);
    porUsuario.set(v.usuario_id, at);
  }

  return (
    <PageFade>
      <PageHeader
        title="Administração"
        description="Um lugar só para gerir o sistema — contas, equipes, canais e acessos — independente do portal."
      />

      {/* Atalhos para as áreas que já têm tela própria */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ATALHOS.map((a) => (
          <Link key={a.href} href={a.href}>
            <Card className="h-full p-4 transition hover:border-brand/40 hover:shadow-pop dark:hover:border-brand-400/40">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{a.titulo}</h2>
                <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </div>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{a.desc}</p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Canal de aquisição → pessoa (0154) — a peça nova, mora aqui */}
      <Card className="p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">Canal de aquisição → pessoa</h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Quem <strong>cuida</strong> de cada canal. A pessoa passa a <strong>ver e trabalhar</strong> os cards com aquela tag (além do pool e dos cards dela), em qualquer equipe.
        </p>

        {carregando ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : (
          <>
            <div className="space-y-2">
              {[...porUsuario.entries()].map(([usuarioId, info]) => (
                <div key={usuarioId} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Avatar nome={info.nome} className="h-6 w-6 text-[10px]" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{info.nome}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {info.canais.map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {c}
                        <button
                          onClick={() => salvarVinculo(usuarioId, c, "remover")}
                          className="text-slate-400 hover:text-rose-500"
                          title="Remover este canal desta pessoa"
                        >
                          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {porUsuario.size === 0 && <p className="text-xs text-slate-400">Nenhum canal atribuído a ninguém ainda.</p>}
            </div>

            {/* Novo vínculo */}
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <select value={novoUsuario} onChange={(e) => setNovoUsuario(e.target.value)} className={cn(fieldClass, "flex-1")}>
                <option value="">Pessoa…</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
              <select value={novoCanal} onChange={(e) => setNovoCanal(e.target.value)} className={cn(fieldClass, "flex-1")}>
                <option value="">Canal…</option>
                {canais.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button
                onClick={() => { if (novoUsuario && novoCanal) { salvarVinculo(novoUsuario, novoCanal, "vincular"); setNovoUsuario(""); setNovoCanal(""); } }}
                disabled={!novoUsuario || !novoCanal}
              >
                Atribuir
              </Button>
            </div>
          </>
        )}
      </Card>
    </PageFade>
  );
}
