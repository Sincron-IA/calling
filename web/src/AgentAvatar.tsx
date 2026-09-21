/**
 * O disco do agente.
 *
 * Era um componente proprio (`AgentDisc`) com 40 linhas de CSS: um `<span>`
 * redondo, um `<img>` dentro, e um estado de React so para voltar para a
 * inicial quando a imagem nao carregava. O `Avatar` do shadcn ja faz
 * exatamente isso — o `AvatarFallback` E o "quando a imagem falha".
 *
 * O que sobra aqui e o que e do Calling e de mais ninguem: a cor do agente
 * pinta a borda e o fundo da inicial. Ela e a UNICA cor forte da interface.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { initialOf } from './agents'
import type { CSSProperties } from 'react'

export interface AgentAvatarProps {
  name: string
  /** Cor do agente, em hex. */
  color: string
  /** Imagem do agente. Vazia (ou que nao carrega) cai na inicial. */
  src?: string
  /** Lado do disco, em px. A inicial acompanha. */
  size?: number
  className?: string
  style?: CSSProperties
  /** Borda mais grossa, para os discos grandes. */
  thick?: boolean
}

export function AgentAvatar({
  name,
  color,
  src = '',
  size = 32,
  className,
  style,
  thick = false,
}: AgentAvatarProps) {
  return (
    <Avatar
      className={cn('shrink-0', thick ? 'border-2' : 'border', className)}
      style={{
        borderColor: color,
        width: size,
        height: size,
        /* OPACO, nao translucido.
           A cor do agente misturada com `transparent` deixava o disco de tras
           aparecer atraves do da frente quando eles se sobrepoem — e a pilha
           de chamadas e a fileira do recado sobrepoem de proposito. Misturar
           com o fundo do cartao da o mesmo tom e nao vaza nada. */
        background: 'var(--card)',
        ...style,
      }}
    >
      <AvatarImage src={src || undefined} alt="" />
      <AvatarFallback
        className="font-medium"
        style={{
          background: `color-mix(in oklch, ${color}, var(--card) 82%)`,
          color,
          // A inicial acompanha o tamanho do disco, seja ele qual for.
          fontSize: Math.round(size * 0.42),
          lineHeight: 1,
        }}
      >
        {initialOf(name)}
      </AvatarFallback>
    </Avatar>
  )
}

export interface AgentAvatarStackItem {
  key: string
  name: string
  color: string
  src?: string
}

/**
 * Varios discos sobrepostos.
 *
 * Duas regras, e as duas sao faceis de errar uma de cada vez:
 *
 *   1. O DA ESQUERDA FICA POR CIMA. A ordem natural de pintura e a do DOM, que
 *      poe o ultimo na frente — o contrario do que se espera de uma pilha que
 *      se le da esquerda para a direita. O `zIndex` decrescente inverte isso.
 *   2. Os discos sao opacos (ver acima), senao a sobreposicao mostra o de tras
 *      por transparencia e nao se enxerga nenhum dos dois.
 */
export function AgentAvatarStack({
  items,
  size = 24,
  overlap = 9,
  thick = false,
  className,
}: {
  items: AgentAvatarStackItem[]
  size?: number
  /** Quantos px cada disco cobre do anterior. */
  overlap?: number
  thick?: boolean
  className?: string
}) {
  return (
    <span className={cn('flex items-center', className)} aria-hidden="true">
      {items.map((item, index) => (
        <AgentAvatar
          key={item.key}
          name={item.name}
          color={item.color}
          src={item.src}
          size={size}
          thick={thick}
          style={{
            marginLeft: index === 0 ? 0 : -overlap,
            zIndex: items.length - index,
          }}
        />
      ))}
    </span>
  )
}
