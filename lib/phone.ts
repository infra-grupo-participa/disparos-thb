// Normaliza telefone BR para o formato 55DDDNÚMERO (só dígitos).
// Mesma lógica da Edge Function, para consistência entre ingestão, envio e match.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) {
    digits = "55" + digits;
  }
  return digits;
}

// Primeiro nome com capitalização básica, para preencher a variável do template.
export function primeiroNome(nome: string | null | undefined): string {
  if (!nome) return "";
  const t = nome.trim().split(/\s+/)[0] || "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}
