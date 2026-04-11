'use client'

import { forwardRef, useState } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva } from 'class-variance-authority'

/**
 * LiquidButton - Liquid Glass style button
 * Based on ui-ux-pro-max skill Style #14: Liquid Glass
 * Effects: Morphing, chromatic aberration, iridescent gradients, 400-600ms transitions
 */

const liquidButtonStyles = {
  base: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    cursor: 'pointer',
    border: 'none',
    outline: 'none',
    fontFamily: 'inherit',
    fontWeight: 700,
    letterSpacing: '0.02em',
    overflow: 'hidden',
    // Liquid Glass: backdrop-filter blur + translucent base
    backdropFilter: 'blur(15px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(15px) saturate(1.4)',
    background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.35), rgba(6, 182, 212, 0.35), rgba(139, 92, 246, 0.25))',
    color: '#ffffff',
    borderRadius: '16px',
    // Iridescent border
    boxShadow: `
      inset 0 1px 0 rgba(255,255,255,0.25),
      inset 0 -1px 0 rgba(0,0,0,0.15),
      0 0 20px rgba(124, 58, 237, 0.2),
      0 0 40px rgba(6, 182, 212, 0.1),
      0 4px 20px rgba(0,0,0,0.3)
    `,
    // 400-600ms transition (Liquid Glass spec)
    transition: 'all 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    textDecoration: 'none',
  },
  hover: {
    background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.5), rgba(6, 182, 212, 0.5), rgba(139, 92, 246, 0.4))',
    boxShadow: `
      inset 0 1px 0 rgba(255,255,255,0.35),
      inset 0 -1px 0 rgba(0,0,0,0.15),
      0 0 30px rgba(124, 58, 237, 0.35),
      0 0 60px rgba(6, 182, 212, 0.2),
      0 8px 32px rgba(0,0,0,0.35)
    `,
    transform: 'translateY(-2px) scale(1.02)',
  },
  active: {
    transform: 'translateY(0px) scale(0.98)',
    transition: 'all 150ms ease',
  },
}

const sizeMap = {
  sm: { padding: '10px 20px', fontSize: '14px', borderRadius: '12px' },
  md: { padding: '14px 32px', fontSize: '16px', borderRadius: '16px' },
  lg: { padding: '18px 44px', fontSize: '18px', borderRadius: '18px' },
  xl: { padding: '22px 56px', fontSize: '22px', borderRadius: '20px' },
}

const LiquidButton = forwardRef(function LiquidButton(
  {
    children,
    size = 'lg',
    asChild = false,
    style = {},
    onClick,
    href,
    ...props
  },
  ref
) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)

  const Comp = asChild ? Slot : href ? 'a' : 'button'
  const sizeStyles = sizeMap[size] || sizeMap.lg

  const combinedStyle = {
    ...liquidButtonStyles.base,
    ...sizeStyles,
    ...(hovered ? liquidButtonStyles.hover : {}),
    ...(pressed ? liquidButtonStyles.active : {}),
    ...style,
  }

  return (
    <Comp
      ref={ref}
      href={href}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={combinedStyle}
      {...props}
    >
      {/* Chromatic aberration shine overlay */}
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '200%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), rgba(124,58,237,0.06), rgba(6,182,212,0.06), transparent)',
          transform: hovered ? 'translateX(50%)' : 'translateX(-20%)',
          transition: 'transform 800ms ease',
          pointerEvents: 'none',
        }}
      />
      {/* Glass reflection */}
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 100%)',
          borderRadius: 'inherit',
          pointerEvents: 'none',
        }}
      />
      <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
        {children}
      </span>
    </Comp>
  )
})

export default LiquidButton
export { LiquidButton }
