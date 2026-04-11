'use client'

import { forwardRef, useState } from 'react'
import { Slot } from '@radix-ui/react-slot'

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
    backdropFilter: 'blur(15px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(15px) saturate(1.4)',
    background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.4), rgba(168, 85, 247, 0.4), rgba(139, 92, 246, 0.3))',
    color: '#ffffff',
    borderRadius: '16px',
    boxShadow: `
      inset 0 1px 0 rgba(255,255,255,0.2),
      inset 0 -1px 0 rgba(0,0,0,0.15),
      0 0 30px rgba(124, 58, 237, 0.3),
      0 0 60px rgba(168, 85, 247, 0.15),
      0 4px 20px rgba(0,0,0,0.3)
    `,
    transition: 'all 500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
    textDecoration: 'none',
  },
  hover: {
    background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.55), rgba(168, 85, 247, 0.55), rgba(139, 92, 246, 0.45))',
    boxShadow: `
      inset 0 1px 0 rgba(255,255,255,0.3),
      inset 0 -1px 0 rgba(0,0,0,0.15),
      0 0 40px rgba(124, 58, 237, 0.4),
      0 0 80px rgba(168, 85, 247, 0.2),
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
  { children, size = 'lg', asChild = false, style = {}, onClick, href, ...props },
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
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '200%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), rgba(168,85,247,0.08), rgba(124,58,237,0.08), transparent)',
          transform: hovered ? 'translateX(50%)' : 'translateX(-20%)',
          transition: 'transform 800ms ease',
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, transparent 100%)',
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
