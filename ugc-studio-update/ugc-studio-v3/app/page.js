'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import './styles/landing.css'

/* ---------- shared atoms ---------- */
function Dust({ count = 70 }) {
  const specks = useMemo(() => {
    const arr = []
    for (let i = 0; i < count; i++) {
      const cls = Math.random() < 0.5
        ? 'tiny'
        : (Math.random() < 0.7 ? 'small' : (Math.random() < 0.9 ? '' : 'big'))
      arr.push({
        id: i,
        cls,
        left: Math.random() * 100,
        delay: Math.random() * -18,
        dur: 12 + Math.random() * 14,
      })
    }
    return arr
  }, [count])
  return (
    <div className="dust" aria-hidden="true">
      {specks.map(s => (
        <span
          key={s.id}
          className={'speck ' + s.cls}
          style={{
            left: s.left + '%',
            bottom: '-20px',
            animationDelay: s.delay + 's',
            animationDuration: s.dur + 's',
          }}
        />
      ))}
    </div>
  )
}

function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <span className="blob b1" />
      <span className="blob b2" />
    </div>
  )
}

/* ---------- NAV ---------- */
function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <nav className={'nav' + (scrolled ? ' scrolled' : '')}>
      <div className="brand">
        <span className="brand-dot" />yotzr<span className="brand-version">· BETA</span>
      </div>
      <div className="nav-links">
        <a href="#flow">איך זה עובד</a>
        <a href="#pricing">מחירים</a>
        <a href="/login">כניסה</a>
      </div>
      <div className="nav-cta">
        <a href="/login" className="btn btn-ghost">התחברות</a>
        <a href="#pricing" className="btn btn-primary">התחל ניסיון</a>
      </div>
    </nav>
  )
}

/* ---------- HERO ---------- */
const HERO_VIDEOS = [
  { src: '/hero-videos/perfume.mp4',    label: 'בושם שמש',         emoji: '🌸' },
  { src: '/hero-videos/barbershop.mp4', label: 'ברבר שופ הצמרת',  emoji: '💈' },
  { src: '/hero-videos/whitening.mp4',  label: 'אבקת הלבנה',       emoji: '✨' },
]

function HeroVideoGrid() {
  return (
    <div className="hero-video-grid" aria-label="דוגמאות סרטונים">
      {HERO_VIDEOS.map(v => (
        <figure key={v.src} className="hero-video-card">
          <video
            src={v.src}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
          />
          <figcaption className="hvc-label">
            <span className="hvc-emoji" aria-hidden="true">{v.emoji}</span>
            <span>{v.label}</span>
          </figcaption>
        </figure>
      ))}
    </div>
  )
}

function Hero() {
  const [type, setType] = useState('product')
  const [count, setCount] = useState(1237)
  useEffect(() => {
    const t = setInterval(
      () => setCount(c => c + Math.floor(Math.random() * 3) + 1),
      6000,
    )
    return () => clearInterval(t)
  }, [])
  return (
    <section className="hero">
      <Ambient />
      <Dust count={70} />
      <div className="hero-ticker">
        <div className="hero-ticker-track">
          {[0, 1].flatMap(c => [
            <span key={'a' + c}><span className="pulse" /><span>נוצרו השבוע</span><span className="strong">2,047 סרטונים</span><span className="sep">///</span></span>,
            <span key={'b' + c}><span className="pulse" /><span>בונים עכשיו</span><span className="strong">13 יוצרים פעילים</span><span className="sep">///</span></span>,
            <span key={'c' + c}><span className="pulse" /><span>שפה</span><span className="strong">עברית · HEBREW NATIVE</span><span className="sep">///</span></span>,
            <span key={'d' + c}><span className="pulse" /><span>פורמט</span><span className="strong">9:16 · VERTICAL</span><span className="sep">///</span></span>,
            <span key={'e' + c}><span className="pulse" /><span>זמן יצירה</span><span className="strong">2:47 דקות</span><span className="sep">///</span></span>,
          ])}
        </div>
      </div>
      <div className="left">
        <div className="eyebrow">
          <span className="dot">●</span>YOTZR · BETA &nbsp;//&nbsp; AI VIDEO ADS · HEBREW NATIVE
        </div>
        <div className="hero-toggle">
          <button className={type === 'product' ? 'active' : ''} onClick={() => setType('product')}>סרטון למוצר</button>
          <button className={type === 'business' ? 'active' : ''} onClick={() => setType('business')}>סרטון לעסק</button>
        </div>
        <h1 className="h-display h1">
          <div>הפרסומת</div>
          <div>הבאה <span className="accent">שלך.</span></div>
          <div><span className="stroke">3 דקות.</span><span className="en">· 3 min</span></div>
        </h1>
        <p className="sub">
          {type === 'business'
            ? 'סרטוני שיווק לעסק — מסעדה, חנות, קליניקה, מספרה. תיאור קצר, תמונות של המקום, ואווטאר מגיש את העסק.'
            : 'סטודיו AI לסרטוני UGC בעברית. בחר אווטאר, תאר מוצר — קבל סרטון מוכן לפרסום בלי מצלמה ובלי שחקנים.'}
        </p>
        <div className="live-proof">
          <span className="live-dot" />
          <span><b>{count.toLocaleString('en-US')}</b> סרטונים נוצרו השבוע</span>
        </div>
        <div className="cta-row">
          <a href="#pricing" className="btn btn-primary btn-lg btn-pulse">
            נסה 3 ימים ב-₪20
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <path d="M13 8l-6 5V3l6 5z" fill="currentColor" />
            </svg>
          </a>
          <a href="#flow" className="btn btn-ghost btn-lg">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
              <path d="M11 8l-4 2.5v-5L11 8z" fill="currentColor" />
            </svg>
            ראה איך זה עובד
          </a>
          <span className="cta-micro">
            <span className="check">✓</span>1 סרטון מלא&nbsp;
            <span className="check">✓</span>ללא חידוש&nbsp;
            <span className="check">✓</span>MP4
          </span>
        </div>
      </div>
      <div className="right-stage">
        <HeroVideoGrid />
      </div>
    </section>
  )
}

/* ---------- FLOW ---------- */
const PRODUCTS = {
  whitening: {
    script: 'אבקת הלבנת שיניים טבעית 100% על בסיס פחם פעיל. מלבינה ומנקה מבלי לפגוע באמייל. רק 30 שניות ביום לחיוך לבן ובוהק.',
    image: '/examples/whitening-product.jpg',
    video: '/examples/whitening-video.mp4',
    layer: 'l1',
    selected: 2,
    cat: 'מוצר',
    emoji: '🦷',
    label: 'אבקת הלבנה',
  },
  perfume: {
    script: 'בושם שמש — תערובת ייחודית של פירות הדר ופרחים בלזמיים. ניחוח רענן ליום, חם ומפנק לערב. נשאר על העור 12 שעות.',
    image: '/examples/perfume-product.jpg',
    video: '/examples/perfume-video.mp4',
    layer: 'l2',
    selected: 2,
    cat: 'מוצר',
    emoji: '🌸',
    label: 'בושם שמש',
  },
  barbershop: {
    script: 'ברבר שופ הצמרת — מספרת גברים בוטיק במרכז העיר. תספורות מודרניות, גילוח קלאסי בסכין, אווירה מקצועית. תור היום, מראה חדש מחר.',
    image: '/examples/barbershop-business.jpg',
    video: '/examples/barbershop-video.mp4',
    layer: 'l3',
    selected: 1,
    cat: 'עסק',
    emoji: '💈',
    label: 'ברבר שופ',
  },
}
const PRODUCT_KEYS = ['whitening', 'perfume', 'barbershop']

function DropImage({ layer, src }) {
  const [err, setErr] = useState(false)
  if (err) {
    return (
      <div
        style={{
          width: '70%',
          aspectRatio: '1',
          borderRadius: 8,
          background:
            layer === 'l1'
              ? 'linear-gradient(135deg,#ffe1ec,#ff4d8f)'
              : layer === 'l2'
                ? 'linear-gradient(135deg,#fff4cf,#f06090)'
                : 'linear-gradient(135deg,#1a1410,#ff5577)',
          boxShadow: '0 20px 60px -10px rgba(255,20,147,.4), 0 0 0 1px rgba(255,20,147,.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'JetBrains Mono',
          fontSize: 11,
          letterSpacing: '.18em',
          color: '#fff',
          textShadow: '0 2px 8px rgba(0,0,0,.5)',
        }}
      >
        ● PRODUCT IMAGE
      </div>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" onError={() => setErr(true)} />
}

function ResultVideo({ data }) {
  const [err, setErr] = useState(false)
  const [muted, setMuted] = useState(true)
  const videoRef = useRef(null)

  // Reset error + force-mute whenever the active product changes, so a fresh
  // <video> autoplays cleanly under the browser's autoplay policy.
  useEffect(() => {
    setErr(false)
    setMuted(true)
  }, [data.video])

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    const next = !v.muted
    v.muted = next
    setMuted(next)
    // If unmuting, make sure playback resumes (iOS may have paused on src change).
    if (!next) v.play().catch(() => {})
  }

  if (err) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background:
            data.layer === 'l1'
              ? 'linear-gradient(180deg,#ffe1ec,#5a0820)'
              : data.layer === 'l2'
                ? 'linear-gradient(180deg,#fff4cf,#2e0822)'
                : 'linear-gradient(180deg,#1a1410,#2a0612)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            bottom: 18,
            left: 8,
            right: 8,
            textAlign: 'center',
            fontFamily: 'Heebo',
            fontWeight: 900,
            fontSize: 13,
            color: '#fff',
            textShadow: '0 2px 8px rgba(0,0,0,.7)',
            lineHeight: 1.15,
          }}
        >
          ● {data.label}
          <br />
          <span style={{ color: '#ff1493', textShadow: '0 0 8px #ff1493' }}>3 דקות.</span>
        </div>
      </div>
    )
  }
  return (
    <>
      <video
        key={data.video}
        ref={videoRef}
        src={data.video}
        autoPlay
        muted={muted}
        loop
        playsInline
        poster={data.image}
        onError={() => setErr(true)}
      />
      <button
        type="button"
        className="mute-toggle"
        onClick={toggleMute}
        aria-label={muted ? 'הפעל קול' : 'השתק'}
        aria-pressed={!muted}
      >
        {muted ? '🔇' : '🔊'}
      </button>
    </>
  )
}

function FlowSection() {
  const [active, setActive] = useState('whitening')
  const [typed, setTyped] = useState('')
  const [hasImage, setHasImage] = useState(false)
  const [voice, setVoice] = useState('noa')
  const branchRef = useRef(null)
  const fillRef = useRef(null)
  const typingRef = useRef(null)
  const data = PRODUCTS[active]

  const retype = (text) => {
    if (typingRef.current) clearInterval(typingRef.current)
    setTyped('')
    let i = 0
    typingRef.current = setInterval(() => {
      i++
      setTyped(text.slice(0, i))
      if (i >= text.length) clearInterval(typingRef.current)
    }, 35)
  }

  useEffect(() => {
    retype(PRODUCTS.whitening.script)
    const t = setTimeout(() => setHasImage(true), 2200)
    return () => {
      clearTimeout(t)
      if (typingRef.current) clearInterval(typingRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchTo = (key) => {
    if (key === active) return
    setActive(key)
    setHasImage(false)
    retype(PRODUCTS[key].script)
    setTimeout(() => setHasImage(true), 600)
  }

  useEffect(() => {
    const update = () => {
      const branch = branchRef.current
      const fill = fillRef.current
      if (!branch || !fill) return
      const r = branch.getBoundingClientRect()
      const vh = window.innerHeight
      const start = vh * 0.75
      const end = vh * 0.25
      const progress = Math.max(0, Math.min(1, (start - r.top) / (r.height - (start - end))))
      fill.style.height = (progress * 100) + '%'
      document.querySelectorAll('.step').forEach(s => {
        const sr = s.getBoundingClientRect()
        const mid = sr.top + sr.height / 2
        if (mid < vh * 0.7 && mid > vh * 0.1) s.classList.add('active', 'in')
        else if (sr.top < vh) s.classList.add('in')
      })
    }
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update, { passive: true })
    update()
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return (
    <section className="flow-section" id="flow">
      <Ambient />
      <Dust count={40} />
      <div className="section-divider">
        <span className="num">02 /</span>
        <span>מרעיון לסרטון · THE FLOW</span>
        <span className="line" />
        <span>4 שלבים · 3 דקות</span>
      </div>
      <div className="flow-header">
        <h2 className="flow-title">מ<span className="accent">רעיון</span><br />ל<span className="stroke">סרטון</span></h2>
        <p className="flow-lede">ארבעה שלבים. בלי מצלמה, בלי שחקנים. בחר מוצר, תאר אותו, בחר אווטאר — והסרטון מוכן.</p>
      </div>

      <div className="tabs">
        {PRODUCT_KEYS.map((k, i) => {
          const p = PRODUCTS[k]
          const num = String(i + 1).padStart(2, '0')
          return (
            <button
              key={k}
              className={'tab' + (active === k ? ' active' : '')}
              onClick={() => switchTo(k)}
            >
              <span className="tab-num">{num}</span>
              <span className="tab-emoji">{p.emoji}</span>
              <span className="tab-label">
                <span>{p.label}</span>
                <span className="tab-cat">{p.cat}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="flow-branch" ref={branchRef}>
        <div className="branch-line"><div className="branch-line-fill" ref={fillRef} /></div>

        {/* STEP 1 */}
        <div className="step" data-step="1">
          <div className="step-info">
            <div className="step-label">STEP 01 · תאר</div>
            <h3 className="step-title">ספר לי על המוצר שלך</h3>
            <p className="step-desc">כמה מילים. מה המוצר, מה הבעיה שהוא פותר, למי הוא מיועד. ה-AI לוקח את זה וכותב סקריפט שמוכר בעברית טבעית.</p>
          </div>
          <div className="step-node">01</div>
          <div className="step-visual">
            <div className="cap"><span className="bullet">●</span> INPUT · #prompt</div>
            <div className="demo-textbox-label">תיאור המוצר</div>
            <div className="demo-textbox typing"><span>{typed}</span></div>
          </div>
        </div>

        {/* STEP 2 */}
        <div className="step right-side" data-step="2">
          <div className="step-info">
            <div className="step-label">STEP 02 · העלה</div>
            <h3 className="step-title">הוסף תמונה של המוצר</h3>
            <p className="step-desc">תמונה אחת נקייה של המוצר או של העסק. ה-AI משתמש בה כרפרנס כדי להבטיח שהסרטון ייראה אמיתי.</p>
          </div>
          <div className="step-node">02</div>
          <div className="step-visual">
            <div className="cap"><span className="bullet">●</span> UPLOAD · #asset</div>
            <div className={'demo-dropzone' + (hasImage ? ' has-image' : '')}>
              <div className={'demo-dropzone-placeholder' + (hasImage ? ' hidden' : '')}>
                גרור תמונה לכאן<br />
                <span style={{ color: 'var(--ink-3)' }}>JPG · PNG · WEBP</span>
              </div>
              {hasImage && <DropImage layer={data.layer} src={data.image} />}
              <div className="demo-dropzone-check">✓ הועלה בהצלחה</div>
            </div>
          </div>
        </div>

        {/* STEP 3 */}
        <div className="step" data-step="3">
          <div className="step-info">
            <div className="step-label">STEP 03 · בחר</div>
            <h3 className="step-title">בחר את האווטאר שידבר</h3>
            <p className="step-desc">6 אווטארים מגוונים עם קריינות עברית מקצועית. לכל אווטאר אישיות, סגנון, וקול שונה.</p>
          </div>
          <div className="step-node">03</div>
          <div className="step-visual">
            <div className="cap"><span className="bullet">●</span> CAST · #avatar</div>
            <div className="demo-avatars">
              {[
                { name: 'נועה', voice: 'נועה · נקבי', cls: '' },
                { name: 'דניאל', voice: 'דניאל · זכרי', cls: 'b' },
                { name: 'מיה', voice: 'מיה · עדין', cls: 'c' },
              ].map((av, i) => (
                <div key={i} className={'demo-avatar' + (i === data.selected ? ' selected' : '')}>
                  <div className="ph"><div className={'face-glyph ' + av.cls} /></div>
                  <div className="name-badge">
                    <span className="name">{av.name}</span>
                    <span className="voice">{av.voice}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="voice-picker-label">בחר קול · VOICE</div>
            <div className="voice-options">
              <button
                className={'voice-option' + (voice === 'noa' ? ' active' : '')}
                onClick={() => setVoice('noa')}
              >
                <span className="voice-icon">♀</span><span>נועה</span><span className="voice-tag">נקבי</span>
              </button>
              <button
                className={'voice-option' + (voice === 'daniel' ? ' active' : '')}
                onClick={() => setVoice('daniel')}
              >
                <span className="voice-icon">♂</span><span>דניאל</span><span className="voice-tag">זכרי</span>
              </button>
              <button className="voice-option locked" disabled>
                <span className="voice-icon">🔒</span><span>פרימיום</span><span className="voice-tag">PRO</span>
              </button>
            </div>
          </div>
        </div>

        {/* STEP 4 — REVEAL */}
        <div className="step right-side" data-step="4">
          <div className="step-info">
            <div className="step-label">STEP 04 · הסרטון שלך</div>
            <h3 className="step-title">
              מוכן{' '}
              <span style={{
                background: 'var(--grad)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
                filter: 'drop-shadow(0 0 18px var(--pink-soft))',
              }}>לפרסום.</span>
            </h3>
            <p className="step-desc">20 שניות, 9:16, עם כתוביות מסונכרנות וקריינות בעברית. ייצוא MP4 — מוכן לטיקטוק, לאינסטגרם, לשורטס.</p>
          </div>
          <div className="step-node">04</div>
          <div className="step-visual">
            <span className="corner-glow tl" /><span className="corner-glow tr" />
            <span className="corner-glow bl" /><span className="corner-glow br" />
            <div className="cap"><span className="bullet">●</span> OUTPUT · #ready</div>
            <div className="demo-result">
              <div className="reveal-label">● THE REVEAL · הסרטון שלך</div>
              <div className="demo-video">
                <ResultVideo data={data} />
              </div>
              <div className="demo-result-meta">
                <span><span className="accent">●</span> 20s</span>
                <span>9:16</span>
                <span>1080p</span>
                <span>HEB VO</span>
              </div>
              <div className="demo-result-actions">
                <button className="btn btn-primary">הורד MP4</button>
                <button className="btn btn-ghost">שתף</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ---------- MID CTA ---------- */
function MidCTA() {
  return (
    <section className="mid-cta">
      <div className="mid-cta-inner">
        <div className="mid-cta-text">
          <div className="mid-cta-eyebrow">● עכשיו אצלך · NOW IT&apos;S YOUR TURN</div>
          <h2 className="mid-cta-title">
            ראית איך זה <span className="mid-cta-accent">עובד.</span>
            <br />עכשיו תורך.
          </h2>
          <p className="mid-cta-sub">3 דקות מהרעיון לסרטון מוכן לפרסום. בלי מצלמה, בלי שחקנים.</p>
        </div>
        <a href="#pricing" className="btn btn-primary btn-lg btn-pulse mid-cta-btn">
          התחל עכשיו · ₪20
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path d="M13 8l-6 5V3l6 5z" fill="currentColor" />
          </svg>
        </a>
      </div>
    </section>
  )
}

/* ---------- PRICING ---------- */
const PLANS = [
  {
    tier: 'trial',
    name: 'ניסיון',
    label: 'TRIAL · ניסיון',
    icon: '🧪',
    price: '20',
    period: '3 ימים · חד פעמי',
    features: [
      '1 סרטון מלא (20 שניות)',
      '2 אווטארים (זכר + נקבה)',
      '2 קולות עברית',
      'ייצוא MP4 מלא',
      'עריכה מלאה',
    ],
    cta: 'התחל ניסיון · ₪20',
    note: 'ללא חידוש אוטומטי · מסתיים אחרי 3 ימים',
    badge: null,
  },
  {
    tier: 'basic',
    name: 'בייסיק',
    label: 'BASIC · בייסיק',
    icon: '💼',
    price: '299',
    period: 'לחודש',
    features: [
      '4 סרטונים בחודש',
      'עד 3 אווטרים',
      'עד 2 קולות',
      'שינוי קריינות 1x לסרטון',
      'שינוי סצנה 1x לסרטון',
    ],
    cta: 'שדרג לבייסיק',
    note: 'ביטול בכל עת',
    badge: '⭐ הכי פופולרי',
  },
  {
    tier: 'pro',
    name: 'פרו',
    label: 'PRO · פרו',
    icon: '🔥',
    price: '499',
    period: 'לחודש',
    features: [
      '8 סרטונים בחודש',
      'כל האווטרים',
      'כל הקולות',
      'שינוי קריינות 2x לסרטון',
      'שינוי סצנה 2x לסרטון',
    ],
    cta: 'שדרג לפרו',
    note: 'ביטול בכל עת · Early access',
    badge: '🔥 הכי משתלם',
  },
]

function PricingCard({ plan }) {
  return (
    <div className={'price-card price-' + plan.tier}>
      {plan.tier === 'pro' && (
        <>
          <span className="flame f1" aria-hidden="true" />
          <span className="flame f2" aria-hidden="true" />
          <span className="flame f3" aria-hidden="true" />
          <span className="pro-grid" aria-hidden="true" />
        </>
      )}
      {plan.badge && <div className="price-badge">{plan.badge}</div>}
      <div className="price-icon">{plan.icon}</div>
      <div className="price-label">{plan.label}</div>
      <div className="price-name">{plan.name}</div>
      <div className="price-amount">{plan.price}<span className="cur">₪</span></div>
      <div className="price-period">{plan.period}</div>
      <ul className="price-features">
        {plan.features.map((f, j) => (
          <li key={j}><span className="check">✓</span>{f}</li>
        ))}
      </ul>
      <button className={'price-btn price-btn-' + plan.tier}>{plan.cta}</button>
      <div className="price-note">{plan.note}</div>
    </div>
  )
}

function Pricing() {
  return (
    <section className="pricing-section" id="pricing">
      <div className="section-divider">
        <span className="num">03 /</span>
        <span>מחירים · PRICING</span>
        <span className="line" />
        <span>ללא חיובים נסתרים</span>
      </div>
      <div className="pricing-header">
        <h2 className="pricing-title">בחר <span className="accent">תוכנית.</span></h2>
        <p className="pricing-lede">התחל ב-₪20 לניסיון. אם זה מתאים — שדרג. אם לא — הניסיון פשוט נגמר. ללא חידוש אוטומטי, ללא התחייבות.</p>
      </div>
      <div className="pricing-grid">
        {PLANS.map(p => <PricingCard key={p.tier} plan={p} />)}
      </div>
    </section>
  )
}

/* ---------- FINAL CTA ---------- */
function FinalCTA() {
  return (
    <section className="final-cta">
      <Dust count={40} />
      <div className="final-cta-content">
        <div className="final-cta-eyebrow">START · NOW · עכשיו</div>
        <h1 className="final-cta-title">התחל <span className="accent">עכשיו.</span></h1>
        <p className="final-cta-sub">ב-3 דקות תהיה לך פרסומת מוכנה לשידור.</p>
        <a href="#pricing" className="btn btn-primary btn-lg btn-pulse">
          נסה 3 ימים ב-₪20
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path d="M13 8l-6 5V3l6 5z" fill="currentColor" />
          </svg>
        </a>
        <div className="final-cta-micro">
          <span className="check">✓</span>1 סרטון מלא&nbsp;
          <span className="check">✓</span>ללא חידוש&nbsp;
          <span className="check">✓</span>ייצוא MP4
        </div>
      </div>
    </section>
  )
}

/* ---------- FOOTER ---------- */
function Footer() {
  return (
    <footer className="footer">
      <div className="footer-grid">
        <div className="footer-brand-block">
          <div className="footer-logo">
            <span className="footer-logo-dot" />yotzr<span className="footer-logo-version">· BETA</span>
          </div>
          <p className="footer-tagline">סרטוני UGC מקצועיים בעברית — בלי מצלמה, בלי שחקנים. AI שמדבר עברית כמו שצריך.</p>
          <div className="footer-made">
            <span className="footer-flag">●</span>MADE IN ISRAEL · HEBREW-NATIVE AI
          </div>
        </div>
        <div className="footer-col">
          <div className="footer-col-title">מוצר</div>
          <a href="#flow" className="footer-link">איך זה עובד</a>
          <a href="#pricing" className="footer-link">מחירים</a>
          <a href="/login" className="footer-link">כניסה</a>
        </div>
        <div className="footer-col">
          <div className="footer-col-title">משפטי</div>
          <a href="/legal#terms" className="footer-link">תקנון</a>
          <a href="/legal#privacy" className="footer-link">פרטיות</a>
          <a href="/legal#refund" className="footer-link">ביטול והחזר</a>
        </div>
        <div className="footer-col">
          <div className="footer-col-title">צור קשר</div>
          <a href="mailto:hello@yotzr.com" className="footer-link">צור קשר</a>
          <a href="#" className="footer-link">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r=".7" fill="currentColor" stroke="none" />
            </svg>
            Instagram
          </a>
          <a href="#" className="footer-link">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M19.6 6.5a4.6 4.6 0 0 1-3.6-1.7v8.7a5.5 5.5 0 1 1-5.5-5.5h.7v3a2.6 2.6 0 1 0 1.8 2.5V2h2.9a4.6 4.6 0 0 0 4.6 4.6z" />
            </svg>
            TikTok
          </a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© 2026 Yotzr · ברוש 3, נתניה</span>
        <span className="footer-bottom-spacer" />
        <span>כל הזכויות שמורות</span>
      </div>
    </footer>
  )
}

/* ---------- PAGE ---------- */
export default function LandingPage() {
  useEffect(() => {
    document.body.classList.add('yotzr-landing')
    return () => document.body.classList.remove('yotzr-landing')
  }, [])
  return (
    <div className="yotzr">
      <Nav />
      <Hero />
      <FlowSection />
      <MidCTA />
      <Pricing />
      <FinalCTA />
      <Footer />
    </div>
  )
}
