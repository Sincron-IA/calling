/**
 * Quem pode falar com o bridge pelo navegador.
 *
 * A lista continua EXPLICITA e vem do `.env` (`CALLING_ALLOWED_ORIGINS`,
 * separada por virgula). Nao existe curinga aqui: com `credentials: true` o
 * proprio Fetch proibe `*`, e mesmo que deixasse, abrir para qualquer origem
 * tiraria a unica barreira que resta depois do Cloudflare Access.
 *
 * A unica flexibilidade e a do loopback. Para o navegador,
 * `http://localhost:5173` e `http://127.0.0.1:5173` sao origens DIFERENTES,
 * ainda que cheguem na mesma maquina e na mesma porta. Pessoa nenhuma testando
 * um Vite local pensa nisso: digita um ou outro conforme o dia. Entao quando a
 * lista traz um endereco de loopback, as tres formas equivalentes entram
 * juntas (`localhost`, `127.0.0.1`, `[::1]`) na MESMA porta e no MESMO esquema.
 *
 * Isso nao afrouxa nada: quem esta em `127.0.0.1` ja esta dentro da maquina.
 * Porta diferente continua recusada — se o Vite subiu em 5174 porque a 5173
 * estava ocupada, o endereco vai no `.env`, nao no codigo.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Se a origem for loopback, devolve as tres grafias equivalentes.
 * Qualquer outra origem volta como veio.
 */
export function expandLoopbackOrigin(origin: string): string[] {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    // Nao e URL valida: entra literal, e simplesmente nunca vai casar.
    return [origin]
  }

  if (!LOOPBACK_HOSTNAMES.has(url.hostname)) return [origin]

  const port = url.port ? `:${url.port}` : ''
  return [
    `${url.protocol}//localhost${port}`,
    `${url.protocol}//127.0.0.1${port}`,
    `${url.protocol}//[::1]${port}`,
  ]
}

export interface OriginAllowlist {
  /** O que o `.env` pediu, sem expansao — e isto que se mostra a um humano. */
  configured: string[]
  /** Tudo que de fato passa, ja com as grafias de loopback. */
  effective: string[]
  isAllowed(origin: string): boolean
}

export function buildAllowlist(raw: string | undefined): OriginAllowlist {
  const configured = (raw || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const effective = new Set<string>()
  for (const origin of configured) {
    for (const variant of expandLoopbackOrigin(origin)) effective.add(variant)
  }

  return {
    configured,
    effective: [...effective],
    isAllowed: (origin: string) => effective.has(origin),
  }
}
