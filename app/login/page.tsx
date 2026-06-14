"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Spinner, cn, fieldClass } from "@/app/_components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), senha: password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        setErro("E-mail ou senha incorretos.");
      }
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm animate-fade-in p-8 shadow-soft">
        <form onSubmit={entrar}>
          {/* Marca */}
          <div className="flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-lg font-semibold tracking-wide text-white shadow-card">
              CS
            </div>
            <h1 className="mt-4 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              CS · Grupo Participa
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Acesso interno — Customer Success HT
            </p>
          </div>

          {/* Campo de e-mail */}
          <div className="mt-8">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              E-mail
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              placeholder="seu@email.com"
              className={cn(
                fieldClass,
                "mt-1.5",
                erro && "border-rose-400 focus:border-rose-500",
              )}
            />
          </div>

          {/* Campo de senha */}
          <div className="mt-4">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700 dark:text-slate-200"
            >
              Senha
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite sua senha"
              className={cn(
                fieldClass,
                "mt-1.5",
                erro && "border-rose-400 focus:border-rose-500",
              )}
            />
            {erro && (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-rose-600 dark:text-rose-400">
                <svg
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM9 9a1 1 0 0 1 2 0v4a1 1 0 1 1-2 0V9Zm1-4a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
                    clipRule="evenodd"
                  />
                </svg>
                {erro}
              </p>
            )}
          </div>

          {/* Ação */}
          <Button
            type="submit"
            disabled={carregando}
            className="mt-6 w-full"
          >
            {carregando ? (
              <>
                <Spinner className="text-white" />
                Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </Button>
        </form>
      </Card>
    </div>
  );
}
