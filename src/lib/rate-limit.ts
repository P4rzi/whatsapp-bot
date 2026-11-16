// Limite de tentativas em memória (janela fixa). Suficiente para um único processo web.
// Se o web passar a ter várias réplicas, trocar por um contador no banco.

type Bucket = { count: number; resetAt: number };

export function createRateLimiter(options: { limit: number; windowMs: number }) {
  const buckets = new Map<string, Bucket>();

  function cleanup(now: number) {
    if (buckets.size < 1000) return;
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }

  return {
    /** Retorna quantos segundos faltam para liberar, ou 0 se ainda pode tentar. */
    check(key: string, now = Date.now()): number {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) return 0;
      return bucket.count >= options.limit ? Math.ceil((bucket.resetAt - now) / 1000) : 0;
    },
    /** Registra uma falha. */
    hit(key: string, now = Date.now()) {
      cleanup(now);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      } else {
        bucket.count += 1;
      }
    },
    reset(key: string) {
      buckets.delete(key);
    },
  };
}
