import { timingSafeEqual } from 'node:crypto'
import type { Request, Response, NextFunction } from 'express'

const SECRET = process.env.CALLING_SHARED_SECRET || ''

if (!SECRET) {
  console.warn(
    '[calling] CALLING_SHARED_SECRET nao definido — o bridge vai recusar todas as chamadas.',
  )
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/**
 * Autenticacao deliberadamente simples: um segredo compartilhado.
 * Isto e uma ferramenta pessoal (Luiz e Matheus), nao um produto multiusuario.
 */
export function requireSecret(req: Request, res: Response, next: NextFunction) {
  if (!SECRET) {
    res.status(503).json({ error: 'Bridge sem segredo configurado.' })
    return
  }

  const header = req.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !safeEqual(token, SECRET)) {
    res.status(401).json({ error: 'Nao autorizado.' })
    return
  }

  next()
}
