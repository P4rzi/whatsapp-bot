// Resultado padrão das Server Actions do painel.
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

/** Converte os erros do Zod em { campo: mensagem } para exibir no formulário. */
export function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.map(String).join(".");
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
