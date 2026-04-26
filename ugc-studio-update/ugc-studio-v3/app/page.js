'use client'

import { useEffect, useRef, useState } from 'react'

// Hero cauldron auto-cycle — uses the original /landing-assets/ poster set.
// The cauldron IS the brand identity; do not point it at /examples/.
const HERO_CYCLE = ['icecream', 'kipa', 'teeth']
const PRODUCT_AVATARS = { icecream: 'noa', kipa: 'daniel', teeth: 'maya' }

// Flow tabs (Step 1-4) showcase real customer demos from /examples/.
const PRODUCT_CYCLE = ['whitening', 'perfume', 'barbershop']
const PRODUCTS = {
  whitening: {
    script: "אבקת הלבנת שיניים טבעית 100% על בסיס פחם פעיל. מלבינה ומנקה מבלי לפגוע באמייל. רק 30 שניות ביום לחיוך לבן ובוהק.",
    image: "/examples/whitening-product.jpg",
    video: "/examples/whitening-video.mp4",
    poster: "/examples/whitening-product.jpg",
    selected: 2, // Maya
    cat: 'מוצר',
    avatar: 'Maya',
    label: '🦷 אבקת הלבנה',
  },
  perfume: {
    script: "בושם שמש — תערובת ייחודית של פירות הדר ופרחים בלזמיים. ניחוח רענן ליום, חם ומפנק לערב. נשאר על העור 12 שעות.",
    image: "/examples/perfume-product.jpg",
    video: "/examples/perfume-video.mp4",
    poster: "/examples/perfume-product.jpg",
    selected: 2, // Maya
    cat: 'מוצר',
    avatar: 'Maya',
    label: '🌸 בושם שמש',
  },
  barbershop: {
    script: "ברבר שופ הצמרת — מספרת גברים בוטיק במרכז העיר. תספורות מודרניות, גילוח קלאסי בסכין, אווירה מקצועית. תור היום, מראה חדש מחר.",
    image: "/examples/barbershop-business.jpg",
    video: "/examples/barbershop-video.mp4",
    poster: "/examples/barbershop-business.jpg",
    selected: 1, // Daniel
    cat: 'עסק',
    avatar: 'Daniel',
    label: '💈 ברבר שופ',
  },
}

export default function LandingPage() {
  const [type, setType] = useState('product')   // 'product' | 'business' — hero headline variant
  const [voiceActive, setVoiceActive] = useState('noa')

  // Two independent product states:
  //  - heroProduct:  drives the cauldron animation, auto-cycles every 12s,
  //                  never reacts to flow-section tab clicks.
  //  - flowProduct:  drives the Step 1-4 demo (real customer videos).
  const [heroProduct, setHeroProduct] = useState('icecream')
  const [flowProduct, setFlowProduct] = useState('whitening')
  const [liveCount, setLiveCount] = useState(1237)
  // Videos that play INSIDE the cauldron (where "yotzr" text used to be).
  // 4s each, 0.5s crossfade. Independent of heroProduct (12s ingredient cycle).
  const [cauldronVideoIndex, setCauldronVideoIndex] = useState(0)

  const [scrolled, setScrolled] = useState(false)
  const [typedText, setTypedText] = useState('')
  const [hasImage, setHasImage] = useState(false)
  const [imageSrc, setImageSrc] = useState('')
  const [loadingPlan, setLoadingPlan] = useState(null)

  // Global sound state. Only the Step 4 result video plays audio — hero is
  // now a static frames grid. First toggle dismisses the hint permanently.
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [hintDismissed, setHintDismissed] = useState(false)
  const [resultHint, setResultHint] = useState(true)

  const typingIntervalRef = useRef(null)
  const branchRef = useRef(null)
  const branchFillRef = useRef(null)
  const resultVideoRef = useRef(null)
  const typingStartedRef = useRef(false)
  const step1Ref = useRef(null)
  const step4Ref = useRef(null)

  useEffect(() => {
    if (resultVideoRef.current) resultVideoRef.current.muted = !soundEnabled
  }, [soundEnabled])

  useEffect(() => {
    if (hintDismissed) return
    const t = setTimeout(() => setResultHint(false), 3000)
    return () => clearTimeout(t)
  }, [hintDismissed])

  const toggleSound = () => {
    setSoundEnabled(s => !s)
    setHintDismissed(true)
    setResultHint(false)
  }

  // Nav scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Reveal on scroll
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) e.target.classList.add('in')
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -80px 0px' })
    document.querySelectorAll('.reveal').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Branch progressive fill + step activation
  useEffect(() => {
    const update = () => {
      const branch = branchRef.current
      const fill = branchFillRef.current
      if (!branch || !fill) return
      const rect = branch.getBoundingClientRect()
      const viewportH = window.innerHeight
      const branchTop = rect.top
      const branchHeight = rect.height
      const start = viewportH * 0.75
      const end = viewportH * 0.25
      const progress = Math.max(0, Math.min(1, (start - branchTop) / (branchHeight - (start - end))))
      fill.style.height = (progress * 100) + '%'

      document.querySelectorAll('.step').forEach(step => {
        const sr = step.getBoundingClientRect()
        const mid = sr.top + sr.height / 2
        if (mid < viewportH * 0.7 && mid > viewportH * 0.1) {
          step.classList.add('active', 'in')
        } else if (sr.top < viewportH) {
          step.classList.add('in')
        }
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

  // Typewriter
  const retypeText = (text) => {
    if (typingIntervalRef.current) clearInterval(typingIntervalRef.current)
    setTypedText('')
    let i = 0
    typingIntervalRef.current = setInterval(() => {
      if (i < text.length) {
        i++
        setTypedText(text.slice(0, i))
      } else {
        clearInterval(typingIntervalRef.current)
      }
    }, 35)
  }

  // Switch flow-section product (tab click). Affects Step 1-4 only;
  // the hero cauldron auto-cycle is fully independent now.
  const switchProduct = (key) => {
    if (key === flowProduct) return
    setFlowProduct(key)
    const data = PRODUCTS[key]
    retypeText(data.script)
    setHasImage(false)
    setTimeout(() => {
      setImageSrc(data.image)
      setHasImage(true)
    }, 200)
    const rv = resultVideoRef.current
    if (rv) {
      rv.load()
      rv.play().catch(() => {})
    }
  }

  // Hero cauldron: rotate every 12s forever. No user-pause logic —
  // flow tabs can't reach this state.
  useEffect(() => {
    const interval = setInterval(() => {
      setHeroProduct(prev => {
        const i = HERO_CYCLE.indexOf(prev)
        return HERO_CYCLE[(i + 1) % HERO_CYCLE.length]
      })
    }, 12000)
    return () => clearInterval(interval)
  }, [])

  // Inner cauldron videos: 4s each with 0.5s crossfade.
  useEffect(() => {
    const interval = setInterval(() => {
      setCauldronVideoIndex(i => (i + 1) % PRODUCT_CYCLE.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  // Live counter "social proof": tick up every ~6s so it feels alive.
  useEffect(() => {
    const t = setInterval(() => setLiveCount(c => c + Math.floor(Math.random() * 3) + 1), 6000)
    return () => clearInterval(t)
  }, [])

  // Start typing when step 1 enters view
  useEffect(() => {
    const el = step1Ref.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !typingStartedRef.current) {
          typingStartedRef.current = true
          setTimeout(() => {
            retypeText(PRODUCTS[flowProduct].script)
            setTimeout(() => {
              setImageSrc(PRODUCTS[flowProduct].image)
              setHasImage(true)
            }, 2500)
            setTimeout(() => {
              resultVideoRef.current?.play().catch(() => {})
            }, 4000)
          }, 400)
        }
      })
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps

  // Auto-play step 4 video when in view
  useEffect(() => {
    const el = step4Ref.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        const v = resultVideoRef.current
        if (!v) return
        if (e.isIntersecting) v.play().catch(() => {})
        else v.pause()
      })
    }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const onCheckout = async (planType) => {
    if (loadingPlan) return
    setLoadingPlan(planType)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType }),
      })
      const data = await res.json()
      if (data.success && data.url) {
        window.location.href = data.url
        return
      }
      alert('שגיאה: ' + (data.error || 'לא הצלחנו ליצור דף תשלום'))
      setLoadingPlan(null)
    } catch (err) {
      alert('שגיאת רשת: ' + err.message)
      setLoadingPlan(null)
    }
  }

  // Flow-section derived data. Hero animation reads heroProduct directly.
  const data = PRODUCTS[flowProduct]

  return (
    <>
      {/* NAV */}
      <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
        <div className="brand">
          <span className="brand-dot" />
          yotzr<span className="brand-version">· BETA</span>
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

      {/* HERO */}
      <section className="hero">
        <div className="hero-ticker">
          <div className="hero-ticker-track">
            {[0, 1].flatMap(copy => [
              <span key={`a${copy}`}><span className="pulse" /><span>נוצרו השבוע</span><span style={{ color: 'var(--ink)' }}>2,047 סרטונים</span><span style={{ color: 'var(--ink-3)' }}>///</span></span>,
              <span key={`b${copy}`}><span className="pulse" /><span>בונים עכשיו</span><span style={{ color: 'var(--ink)' }}>13 יוצרים פעילים</span><span style={{ color: 'var(--ink-3)' }}>///</span></span>,
              <span key={`c${copy}`}><span className="pulse" /><span>שפה</span><span style={{ color: 'var(--ink)' }}>עברית · HEBREW NATIVE</span><span style={{ color: 'var(--ink-3)' }}>///</span></span>,
              <span key={`d${copy}`}><span className="pulse" /><span>פורמט</span><span style={{ color: 'var(--ink)' }}>9:16 · VERTICAL</span><span style={{ color: 'var(--ink-3)' }}>///</span></span>,
              <span key={`e${copy}`}><span className="pulse" /><span>זמן יצירה ממוצע</span><span style={{ color: 'var(--ink)' }}>2:47 דקות</span><span style={{ color: 'var(--ink-3)' }}>///</span></span>,
            ])}
          </div>
        </div>

        <div className="hero-content">
          <div className="hero-text">
            <div className="eyebrow reveal"><span className="dot">●</span> YOTZR · BETA&nbsp;&nbsp;//&nbsp;&nbsp;AI VIDEO ADS · HEBREW NATIVE</div>
            <div className="hero-toggle reveal delay-1">
              <button className={type === 'product' ? 'active' : ''} onClick={() => setType('product')}>סרטון למוצר</button>
              <button className={type === 'business' ? 'active' : ''} onClick={() => setType('business')}>סרטון לעסק</button>
            </div>
            <h1 className="display-h1 reveal delay-1">
              <div>הפרסומת</div>
              <div>הבאה <span className="accent">שלך.</span></div>
              <div><span className="stroke">3 דקות.</span><span className="en">· 3 min</span></div>
            </h1>
            <p className="hero-sub reveal delay-2">
              {type === 'business'
                ? 'סרטוני שיווק לעסק — מסעדה, חנות, קליניקה, מספרה. תיאור קצר, תמונות של המקום, ואווטאר מגיש את העסק.'
                : 'סרטוני UGC מקצועיים בעברית — בלי מצלמה, בלי שחקנים. בחר אווטאר, העלה מוצר, קבל סרטון מוכן.'}
            </p>
            <div className="hero-cta-row reveal delay-3">
              <a href="#pricing" className="btn btn-primary btn-lg btn-pulse">
                נסה 3 ימים ב-₪20
                <svg viewBox="0 0 16 16" fill="none"><path d="M13 8l-6 5V3l6 5z" fill="currentColor" /></svg>
              </a>
              <a href="#flow" className="btn btn-ghost btn-lg">
                <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" /><path d="M11 8l-4 2.5v-5L11 8z" fill="currentColor" /></svg>
                ראה איך זה עובד
              </a>
            </div>
            <div className="live-proof reveal delay-3">
              <span className="live-dot" />
              <span><b>{liveCount.toLocaleString('en-US')}</b> סרטונים נוצרו השבוע</span>
            </div>
            <div className="hero-cta-micro reveal delay-3">
              <span className="check">✓</span>1 סרטון מלא &nbsp;<span className="check">✓</span>ללא חידוש אוטומטי &nbsp;<span className="check">✓</span>ייצוא MP4 מלא
            </div>
            <div className="hero-footnote reveal delay-4">
              <span style={{ color: 'var(--ink-2)' }}>+2,000 יזמים ישראלים</span>&nbsp;·&nbsp;פייבק ממוצע 11 ימים&nbsp;·&nbsp;כל השפות נתמכות
            </div>
          </div>

          <div className="hero-animation reveal delay-2">
            <div className="editorial-frame">
              <div className="label-top">
                <span className="accent">● LIVE</span> PREVIEW · AUTO-GENERATED
              </div>
              <div className="label-bottom">3 STEPS · 12 SECONDS · INFINITE LOOP</div>
              <span className="corner tl" /><span className="corner tr" />
              <span className="corner bl" /><span className="corner br" />

              <div className="animation-stage-wrapper">
              <div className="animation-stage" key={heroProduct}>
                <div className="stage-glow" />

                <div className="steam">
                  <span /><span /><span /><span /><span /><span />
                </div>

                <div className="ingredient ingredient-product">
                  <picture>
                    <source srcSet={`/landing-assets/product-${heroProduct}.webp`} type="image/webp" />
                    <img src={`/landing-assets/product-${heroProduct}.jpg`} alt="" />
                  </picture>
                  <div className="ingredient-label">מוצר · PRODUCT</div>
                </div>

                <div className="ingredient ingredient-script">
                  <div className="script-card">
                    <div className="script-line" />
                    <div className="script-line" />
                    <div className="script-line short" />
                  </div>
                  <div className="ingredient-label">סקריפט · SCRIPT</div>
                </div>

                <div className="ingredient ingredient-avatar">
                  <picture>
                    <source srcSet={`/landing-assets/avatar-${PRODUCT_AVATARS[heroProduct]}.webp`} type="image/webp" />
                    <img src={`/landing-assets/avatar-${PRODUCT_AVATARS[heroProduct]}.jpg`} alt="" />
                  </picture>
                  <div className="ingredient-label">אווטאר · AVATAR</div>
                </div>

                <svg className="cauldron" viewBox="0 0 300 220" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                  <defs>
                    <linearGradient id="cauldronBody" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#2a1520" />
                      <stop offset="0.5" stopColor="#1a0d14" />
                      <stop offset="1" stopColor="#0A0908" />
                    </linearGradient>
                    <radialGradient id="cauldronInner" cx="0.5" cy="0.3" r="0.7">
                      <stop offset="0" stopColor="#FF0080" stopOpacity="1" />
                      <stop offset="0.6" stopColor="#FF0080" stopOpacity="0.5" />
                      <stop offset="1" stopColor="#FF0080" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="rimGradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0" stopColor="#FF0080" stopOpacity="0.6" />
                      <stop offset="0.5" stopColor="#FF0080" stopOpacity="1" />
                      <stop offset="1" stopColor="#FF0080" stopOpacity="0.6" />
                    </linearGradient>
                  </defs>

                  <path
                    d="M 40 80 Q 40 195 150 205 Q 260 195 260 80 L 275 72 L 268 56 L 32 56 L 25 72 Z"
                    fill="url(#cauldronBody)"
                    stroke="#FF0080"
                    strokeWidth="2.5"
                  />
                  <line x1="32" y1="56" x2="268" y2="56" stroke="url(#rimGradient)" strokeWidth="3" />
                  <ellipse cx="150" cy="70" rx="105" ry="14" fill="url(#cauldronInner)" />

                  {/* Video screen INSIDE the cauldron — replaces "yotzr" text.
                      foreignObject scales with the cauldron viewBox so the videos
                      sit perfectly inside the neon body regardless of cauldron size. */}
                  <foreignObject x="105" y="78" width="90" height="124">
                    <div className="cauldron-screen" xmlns="http://www.w3.org/1999/xhtml">
                      {PRODUCT_CYCLE.map((key, i) => (
                        <video
                          key={key}
                          src={PRODUCTS[key].video}
                          autoPlay
                          muted
                          loop
                          playsInline
                          preload="auto"
                          className={`cauldron-video ${cauldronVideoIndex === i ? 'active' : ''}`}
                        />
                      ))}
                    </div>
                  </foreignObject>

                  <path d="M 32 80 Q 10 90 18 115" stroke="#FF0080" strokeWidth="3" fill="none" />
                  <path d="M 268 80 Q 290 90 282 115" stroke="#FF0080" strokeWidth="3" fill="none" />

                  <circle cx="95" cy="68" r="4" fill="#FF0080" className="bubble b1" />
                  <circle cx="130" cy="62" r="3" fill="#FF0080" className="bubble b2" />
                  <circle cx="165" cy="70" r="3.5" fill="#FF0080" className="bubble b3" />
                  <circle cx="200" cy="65" r="3" fill="#FF0080" className="bubble b4" />
                  <circle cx="225" cy="68" r="2.5" fill="#FF0080" className="bubble b5" />
                </svg>

                <div className="result-frame">
                  <picture>
                    <source srcSet={`/landing-assets/scene3-${heroProduct}.webp`} type="image/webp" />
                    <img src={`/landing-assets/scene3-${heroProduct}.jpg`} alt="" />
                  </picture>
                  <div className="result-badge">
                    <span className="check">✓</span>
                    <span>מוכן</span>
                  </div>
                </div>

                <div className="flash" />
              </div>
              </div>
            </div>
          </div>
        </div>

        <div className="scroll-cue">
          <span>גלול · SCROLL</span>
          <span className="line" />
        </div>
      </section>

      {/* FLOW */}
      <section className="flow-section" id="flow">
        <div className="section-divider">
          <span className="num">02 /</span>
          <span>איך זה עובד · THE FLOW</span>
          <div className="line" />
          <span>4 שלבים · 3 דקות</span>
        </div>

        <div className="flow-header">
          <h2 className="flow-title reveal">
            מ<span className="accent">רעיון</span><br />
            ל<span className="stroke">סרטון</span>
          </h2>
          <p className="flow-lede reveal delay-1">
            ארבעה שלבים. בלי מצלמה, בלי שחקנים. בחר מוצר, תאר אותו, בחר אווטאר — והסרטון מוכן.
          </p>
        </div>

        <div className="tabs reveal delay-2">
          {PRODUCT_CYCLE.map((key, i) => {
            const p = PRODUCTS[key]
            const num = String(i + 1).padStart(2, '0')
            return (
              <button
                key={key}
                className={`tab ${flowProduct === key ? 'active' : ''}`}
                onClick={() => switchProduct(key)}
              >
                <span className="tab-num">{num}</span>
                <span>{p.label}</span>
                <span className="tab-cat">{p.cat}</span>
              </button>
            )
          })}
        </div>

        <div className="flow-branch" ref={branchRef}>
          <div className="branch-line">
            <div className="branch-line-fill" ref={branchFillRef} />
          </div>

          {/* STEP 1 */}
          <div className="step" data-step="1" ref={step1Ref}>
            <div className="step-info">
              <div className="step-label">STEP 01 · תאר</div>
              <h3 className="step-title">ספר לי על המוצר שלך</h3>
              <p className="step-desc">כמה מילים. מה המוצר, מה הבעיה שהוא פותר, למי הוא מיועד. ה-AI לוקח את זה וכותב סקריפט שמוכר בעברית טבעית.</p>
            </div>
            <div className="step-node">01</div>
            <div className="step-visual">
              <div className="cap"><span className="bullet">●</span> INPUT · #prompt</div>
              <div className="demo-textbox-label">תיאור המוצר</div>
              <div className="demo-textbox typing">
                <span>{typedText}</span>
              </div>
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
              <div className={`demo-dropzone ${hasImage ? 'has-image' : ''}`}>
                <div className="demo-dropzone-placeholder">
                  גרור תמונה לכאן<br />
                  <span style={{ color: 'var(--ink-3)' }}>JPG · PNG · WEBP</span>
                </div>
                {imageSrc && (
                  <img src={imageSrc} alt="" loading="lazy" />
                )}
                <div className="demo-dropzone-check">✓ הועלה בהצלחה</div>
              </div>
            </div>
          </div>

          {/* STEP 3 */}
          <div className="step" data-step="3">
            <div className="step-info">
              <div className="step-label">STEP 03 · בחר</div>
              <h3 className="step-title">בחר את האווטאר שידבר</h3>
              <p className="step-desc">6 אווטארים מגוונים עם קריינות עברית מקצועית. לכל אווטאר יש אישיות, סגנון, וקול שונה.</p>
            </div>
            <div className="step-node">03</div>
            <div className="step-visual">
              <div className="cap"><span className="bullet">●</span> CAST · #avatar</div>
              <div className="demo-avatars">
                {[
                  { key: 'noa',    base: '/landing-assets/avatar-noa',    name: 'נועה',  voice: 'נועה · קול נקבי' },
                  { key: 'daniel', base: '/landing-assets/avatar-daniel', name: 'דניאל', voice: 'דניאל · קול זכרי' },
                  { key: 'maya',   base: '/landing-assets/avatar-maya',   name: 'מיה',   voice: 'מיה · קול נקבי עדין' },
                ].map((av, i) => (
                  <div key={av.key} className={`demo-avatar ${i === data.selected ? 'selected' : ''}`}>
                    <picture>
                      <source srcSet={`${av.base}.webp`} type="image/webp" />
                      <img src={`${av.base}.jpg`} alt={av.name} width={1000} height={1000} loading="lazy" />
                    </picture>
                    <div className="name-badge">
                      <span className="name">{av.name}</span>
                      <span className="voice">{av.voice}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="voice-picker">
                <div className="voice-picker-label">בחר קול · VOICE</div>
                <div className="voice-options">
                  <button
                    type="button"
                    className={`voice-option ${voiceActive === 'noa' ? 'active' : ''}`}
                    onClick={() => setVoiceActive('noa')}
                  >
                    <span className="voice-icon">♀</span>
                    <span>נועה</span>
                    <span className="voice-tag">נקבי</span>
                  </button>
                  <button
                    type="button"
                    className={`voice-option ${voiceActive === 'daniel' ? 'active' : ''}`}
                    onClick={() => setVoiceActive('daniel')}
                  >
                    <span className="voice-icon">♂</span>
                    <span>דניאל</span>
                    <span className="voice-tag">זכרי</span>
                  </button>
                  <button type="button" className="voice-option locked" disabled>
                    <span className="voice-icon">🔒</span>
                    <span>קול פרימיום</span>
                    <span className="voice-tag">PRO</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* STEP 4 */}
          <div className="step right-side" data-step="4" ref={step4Ref}>
            <div className="step-info">
              <div className="step-label">STEP 04 · הסרטון שלך</div>
              <h3 className="step-title">מוכן לפרסום.</h3>
              <p className="step-desc">20 שניות, 9:16, עם כתוביות מסונכרנות וקריינות בעברית. ייצוא MP4 — מוכן לטיקטוק, לאינסטגרם, לשורטס.</p>
            </div>
            <div className="step-node">04</div>
            <div className="step-visual">
              <div className="cap"><span className="bullet">●</span> OUTPUT · #ready</div>
              <div className="demo-result">
                <div
                  className="demo-video"
                  onMouseEnter={() => { if (!hintDismissed) setResultHint(true) }}
                  onMouseLeave={() => { if (!hintDismissed) setResultHint(false) }}
                >
                  <video ref={resultVideoRef} muted loop playsInline poster={data.poster} key={data.video}>
                    <source src={data.video} type="video/mp4" />
                  </video>
                  <button
                    className="sound-toggle"
                    onClick={toggleSound}
                    aria-label={soundEnabled ? 'השתק' : 'הפעל סאונד'}
                  >
                    {soundEnabled ? '🔊' : '🔇'}
                  </button>
                  {resultHint && !hintDismissed && (
                    <div className="sound-hint">🔊 לחץ לצליל</div>
                  )}
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

      {/* MID CTA */}
      <section className="mid-cta">
        <div className="mid-cta-inner reveal">
          <div className="mid-cta-text">
            <div className="mid-cta-eyebrow">● עכשיו אצלך · NOW IT'S YOUR TURN</div>
            <h2 className="mid-cta-title">
              ראית איך זה <span className="mid-cta-accent">עובד.</span><br />
              עכשיו תורך.
            </h2>
            <p className="mid-cta-sub">3 דקות מהרעיון לסרטון מוכן לפרסום. בלי מצלמה, בלי שחקנים.</p>
          </div>
          <a href="#pricing" className="btn btn-primary btn-lg mid-cta-btn">
            התחל עכשיו · ₪20
            <svg viewBox="0 0 16 16" fill="none"><path d="M13 8l-6 5V3l6 5z" fill="currentColor" /></svg>
          </a>
        </div>
      </section>

      {/* PRICING */}
      <section className="pricing-section" id="pricing">
        <div className="section-divider">
          <span className="num">03 /</span>
          <span>מחירים · PRICING</span>
          <div className="line" />
          <span>ללא חיובים נסתרים</span>
        </div>

        <div className="pricing-header">
          <h2 className="pricing-title reveal">
            בחר <span className="accent">תוכנית.</span>
          </h2>
          <p className="pricing-lede reveal delay-1">
            התחל ב-₪20 לניסיון. אם זה מתאים — שדרג. אם לא — הניסיון פשוט נגמר. ללא חידוש אוטומטי, ללא התחייבות.
          </p>
        </div>

        <div className="pricing-grid">
          {/* TRIAL */}
          <div className="plan reveal delay-1">
            <div className="plan-icon">🧪</div>
            <div className="plan-label">TRIAL · ניסיון</div>
            <div className="plan-name">ניסיון</div>
            <div className="plan-price">20<span className="currency">₪</span></div>
            <div className="plan-period">3 ימים · חד פעמי</div>
            <ul className="plan-features">
              <li><span className="check">✓</span>1 סרטון מלא (20 שניות)</li>
              <li><span className="check">✓</span>2 אווטארים (זכר + נקבה)</li>
              <li><span className="check">✓</span>2 קולות עברית</li>
              <li><span className="check">✓</span>ייצוא MP4 מלא</li>
              <li><span className="check">✓</span>עריכה מלאה</li>
            </ul>
            <button
              className="btn btn-ghost plan-cta"
              onClick={() => onCheckout('trial')}
              disabled={loadingPlan !== null}
            >
              {loadingPlan === 'trial' ? 'טוען...' : 'התחל ניסיון · ₪20'}
            </button>
            <div className="plan-note">ללא חידוש אוטומטי<br />מסתיים אחרי 3 ימים</div>
          </div>

          {/* BASIC */}
          <div className="plan featured reveal delay-2">
            <div className="plan-badge">⭐ הכי פופולרי</div>
            <div className="plan-icon">💼</div>
            <div className="plan-label">BASIC · בייסיק</div>
            <div className="plan-name">בייסיק</div>
            <div className="plan-price">299<span className="currency">₪</span></div>
            <div className="plan-period">לחודש</div>
            <ul className="plan-features">
              <li><span className="check">✓</span>4 סרטונים בחודש</li>
              <li><span className="check">✓</span>עד 3 אווטרים</li>
              <li><span className="check">✓</span>עד 2 קולות</li>
              <li><span className="check">✓</span>שינוי קריינות 1x לסרטון</li>
              <li><span className="check">✓</span>שינוי סצנה 1x לסרטון</li>
            </ul>
            <button
              className="btn btn-primary plan-cta"
              onClick={() => onCheckout('basic')}
              disabled={loadingPlan !== null}
            >
              {loadingPlan === 'basic' ? 'טוען...' : 'שדרג לבייסיק'}
            </button>
            <div className="plan-note">ביטול בכל עת</div>
          </div>

          {/* PRO */}
          <div className="plan pro-card reveal delay-3">
            <div className="plan-badge pro-badge">🔥 הכי משתלם</div>
            <div className="plan-icon">🔥</div>
            <div className="plan-label">PRO · פרו</div>
            <div className="plan-name pro-title">פרו</div>
            <div className="plan-price">499<span className="currency">₪</span></div>
            <div className="plan-period">לחודש</div>
            <ul className="plan-features">
              <li><span className="check">✓</span>8 סרטונים בחודש</li>
              <li><span className="check">✓</span>כל האווטרים</li>
              <li><span className="check">✓</span>כל הקולות</li>
              <li><span className="check">✓</span>שינוי קריינות 2x לסרטון</li>
              <li><span className="check">✓</span>שינוי סצנה 2x לסרטון</li>
            </ul>
            <button
              className="btn btn-primary pro-cta plan-cta"
              onClick={() => onCheckout('pro')}
              disabled={loadingPlan !== null}
            >
              {loadingPlan === 'pro' ? 'טוען...' : 'שדרג לפרו'}
            </button>
            <div className="plan-note">ביטול בכל עת · Early access</div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="final-cta">
        <div className="final-cta-content">
          <h2 className="final-cta-title reveal">
            התחל <span className="accent">עכשיו.</span>
          </h2>
          <p className="final-cta-sub reveal delay-1">
            ב-3 דקות תהיה לך פרסומת מוכנה לשידור.
          </p>
          <div className="reveal delay-2">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => onCheckout('trial')}
              disabled={loadingPlan !== null}
            >
              {loadingPlan === 'trial' ? 'טוען...' : 'נסה 3 ימים ב-₪20'}
              <svg viewBox="0 0 16 16" fill="none"><path d="M13 8l-6 5V3l6 5z" fill="currentColor" /></svg>
            </button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="footer-grid">
          <div className="footer-brand-block">
            <div className="footer-logo">
              <span className="footer-logo-dot" />
              <span className="footer-logo-text">yotzr<span className="footer-logo-version">· BETA</span></span>
            </div>
            <p className="footer-tagline">
              סרטוני UGC מקצועיים בעברית — בלי מצלמה, בלי שחקנים. AI שמדבר עברית כמו שצריך.
            </p>
            <div className="footer-made">
              <span className="footer-flag">●</span>
              MADE IN ISRAEL · HEBREW-NATIVE AI
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
            <a href="/legal#contact" className="footer-link">צור קשר</a>
            <a href="https://www.instagram.com/yotzr.ai" target="_blank" rel="noopener noreferrer" className="footer-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <circle cx="17.5" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
              </svg>
              Instagram
            </a>
            <a href="https://www.tiktok.com/@yotzr.ai" target="_blank" rel="noopener noreferrer" className="footer-link">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" aria-hidden="true">
                <path d="M19.6 6.5a4.6 4.6 0 0 1-3.6-1.7v8.7a5.5 5.5 0 1 1-5.5-5.5h.7v3a2.6 2.6 0 1 0 1.8 2.5V2h2.9a4.6 4.6 0 0 0 4.6 4.6v0z"/>
              </svg>
              TikTok
            </a>
          </div>
        </div>

        <div className="footer-bottom">
          <span className="footer-copy">© 2026 Yotzr · ברוש 3, נתניה</span>
          <span className="footer-bottom-spacer" />
          <span className="footer-bottom-meta">כל הזכויות שמורות</span>
        </div>
      </footer>

      <style jsx global>{`
        :root {
          --bg: #0A0908;
          --bg-2: #111010;
          --bg-3: #1a1918;
          --ink: #F5F5F4;
          --ink-2: rgba(245,245,244,.64);
          --ink-3: rgba(245,245,244,.38);
          --line: rgba(245,245,244,.1);
          --line-2: rgba(245,245,244,.18);
          --accent: #FF0080;
          --accent-2: #1E90FF;
          --accent-glow: rgba(255,0,128,.4);
          --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
          --display: "Heebo", "Assistant", system-ui, sans-serif;
          --body: "Assistant", "Heebo", system-ui, sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
          background: var(--bg);
          color: var(--ink);
          font-family: var(--body);
          font-weight: 400;
          -webkit-font-smoothing: antialiased;
          overflow-x: hidden;
          min-height: 100vh;
          position: relative;
        }
        ::selection { background: var(--accent); color: #0A0908; }
        body::before {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 100;
          opacity: .22;
          mix-blend-mode: overlay;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
        }
        button { font-family: inherit; cursor: pointer; border: none; background: none; color: inherit; }
        a { color: inherit; text-decoration: none; }
        .mono { font-family: var(--mono); font-size: 11px; letter-spacing: .22em; text-transform: uppercase; color: var(--ink-3); }

        .nav {
          position: fixed; top: 0; left: 0; right: 0; z-index: 50;
          padding: 20px 40px;
          display: flex; align-items: center; justify-content: space-between;
          backdrop-filter: blur(10px);
          background: linear-gradient(to bottom, rgba(10,9,8,.85), rgba(10,9,8,.5));
          border-bottom: 1px solid transparent;
          transition: border-color .3s, background .3s;
        }
        .nav.scrolled { border-color: var(--line); background: rgba(10,9,8,.92); }
        .brand {
          display: flex; align-items: center; gap: 10px;
          font-family: var(--display); font-weight: 900; font-size: 20px; letter-spacing: -.03em;
        }
        .brand-dot {
          width: 10px; height: 10px; border-radius: 2px;
          background: var(--accent); box-shadow: 0 0 20px var(--accent-glow);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .7; transform: scale(.9); } }
        .brand-version {
          font-family: var(--mono); font-size: 10px; letter-spacing: .2em;
          color: var(--ink-3); font-weight: 500; margin-inline-start: 8px;
        }
        .nav-links { display: flex; gap: 32px; font-size: 14px; color: var(--ink-2); }
        .nav-links a { transition: color .2s; }
        .nav-links a:hover { color: var(--ink); }
        .nav-cta { display: flex; gap: 12px; align-items: center; }

        .btn {
          padding: 10px 20px; border-radius: 8px;
          font-size: 14px; font-weight: 600;
          min-height: 44px;
          transition: transform .3s cubic-bezier(.16,1,.3,1),
                      box-shadow .3s cubic-bezier(.16,1,.3,1),
                      background .3s cubic-bezier(.16,1,.3,1),
                      color .3s cubic-bezier(.16,1,.3,1),
                      border-color .3s cubic-bezier(.16,1,.3,1);
          display: inline-flex; align-items: center; gap: 8px;
          font-family: var(--body);
          cursor: pointer;
        }
        .btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 3px;
        }
        .btn-ghost { color: var(--ink); border: 1px solid var(--line-2); background: rgba(255,255,255,.03); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
        .btn-ghost:hover { border-color: var(--ink); background: var(--ink); color: var(--bg); transform: translateY(-2px); }
        .btn-primary {
          background: linear-gradient(135deg, var(--accent) 0%, #d946ef 100%);
          color: #0A0908; font-weight: 700;
          box-shadow: 0 8px 24px -8px var(--accent), inset 0 1px 0 rgba(255,255,255,.18);
        }
        .btn-primary:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 16px 40px -10px var(--accent), inset 0 1px 0 rgba(255,255,255,.22); }
        .btn-primary:active { transform: translateY(-1px) scale(.99); }
        .btn-lg { padding: 18px 30px; font-size: 15px; min-height: 56px; border-radius: 12px; }
        .btn-lg svg { width: 16px; height: 16px; }

        .hero-toggle {
          display: inline-flex; gap: 4px;
          background: var(--bg-2); border: 1px solid var(--line);
          border-radius: 6px; padding: 4px; margin-bottom: 24px;
        }
        .hero-toggle button {
          padding: 10px 22px; border-radius: 4px;
          font-family: var(--body); font-weight: 600; font-size: 14px;
          color: var(--ink-2); background: transparent;
          border: none; cursor: pointer; transition: all .2s;
        }
        .hero-toggle button.active { background: var(--accent); color: var(--bg); }
        .hero-toggle button:hover:not(.active) { color: var(--ink); }

        .hero {
          position: relative; padding: 120px 40px 60px;
          min-height: 100vh; display: flex; flex-direction: column; overflow: hidden;
        }
        .hero-ticker {
          position: absolute; top: 90px; right: 0; left: 0; height: 36px;
          border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
          overflow: hidden; background: rgba(255,0,128,.04);
        }
        .hero-ticker-track {
          display: flex; gap: 60px; white-space: nowrap;
          align-items: center; height: 100%;
          font-family: var(--mono); font-size: 12px; letter-spacing: .16em;
          text-transform: uppercase; color: var(--ink-2);
          animation: ticker 40s linear infinite; padding-inline-start: 60px;
        }
        .hero-ticker-track span { display: inline-flex; align-items: center; gap: 16px; }
        .hero-ticker-track .pulse {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--accent); box-shadow: 0 0 12px var(--accent-glow); flex-shrink: 0;
        }
        @keyframes ticker { 0% { transform: translateX(0); } 100% { transform: translateX(50%); } }

        .hero-content {
          display: grid; grid-template-columns: 1.1fr .9fr;
          gap: 60px; align-items: center; flex: 1; margin-top: 80px;
        }
        .eyebrow {
          font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3); margin-bottom: 20px;
        }
        .eyebrow .dot { color: var(--accent); }
        .display-h1 {
          font-family: var(--display); font-weight: 900; letter-spacing: -.04em;
          line-height: .92; color: var(--ink); font-size: clamp(60px, 9vw, 140px);
        }
        .display-h1 .accent { color: var(--accent); }
        .display-h1 .stroke { -webkit-text-stroke: 2px var(--ink); color: transparent; }
        .display-h1 .en {
          font-family: var(--mono); font-weight: 700; letter-spacing: .02em;
          text-transform: uppercase; font-size: .16em; display: inline-block;
          vertical-align: middle; color: var(--ink-3); margin-inline-start: 16px;
        }
        .hero-sub {
          font-size: 22px; font-weight: 400; color: var(--ink-2);
          max-width: 560px; line-height: 1.55; margin-top: 32px;
          letter-spacing: -.005em;
        }
        .hero-cta-row { display: flex; gap: 12px; margin-top: 40px; align-items: center; flex-wrap: wrap; }
        .hero-cta-micro {
          font-family: var(--mono); font-size: 10px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--ink-3); margin-inline-start: 8px;
        }
        .hero-cta-micro .check { color: var(--accent); margin-left: 4px; }
        .hero-footnote {
          font-family: var(--mono); font-size: 11px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--ink-3); margin-top: 28px;
        }

        /* <picture> should honor parent avatar card dimensions. */
        .demo-avatar picture {
          display: block;
          width: 100%; height: 100%;
          position: absolute; inset: 0;
        }

        /* ============================================================
           HERO ANIMATION — 12s recipe loop: ingredients → cauldron → frame.
           ============================================================ */
        .hero-animation {
          position: relative;
          aspect-ratio: 9/16;
          max-height: 78vh;
          justify-self: start;
          width: 100%;
        }
        .animation-stage-wrapper {
          position: absolute; inset: 12px;
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid var(--line-2);
          background:
            radial-gradient(circle at 50% 100%, rgba(255,0,128,0.15) 0%, transparent 50%),
            var(--bg-2);
        }
        .animation-stage {
          position: absolute; inset: 0;
          animation: stageFadeIn 0.4s ease-out;
        }
        @keyframes stageFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .stage-glow {
          position: absolute; bottom: -100px; left: 50%;
          transform: translateX(-50%);
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(255,0,128,0.4) 0%, transparent 70%);
          filter: blur(40px);
          animation: glowPulse 3s ease-in-out infinite;
          pointer-events: none;
        }
        @keyframes glowPulse {
          0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); }
          50% { opacity: 1; transform: translateX(-50%) scale(1.2); }
        }

        .cauldron {
          position: absolute; bottom: 12%; left: 50%;
          transform: translateX(-50%);
          width: 65%; max-width: 320px;
          z-index: 2;
          filter: drop-shadow(0 0 50px rgba(255,0,128,0.6));
          animation: cauldronShake 12s linear infinite;
        }
        @keyframes cauldronShake {
          0%, 50%, 67%, 100% { transform: translateX(-50%) rotate(0); }
          54% { transform: translateX(calc(-50% - 4px)) rotate(-1deg); }
          57% { transform: translateX(calc(-50% + 4px)) rotate(1deg); }
          60% { transform: translateX(calc(-50% - 3px)) rotate(-0.5deg); }
          63% { transform: translateX(calc(-50% + 3px)) rotate(0.5deg); }
        }

        /* Video screen embedded inside the cauldron via foreignObject.
           Sits in the SVG coordinate space, so it scales with the cauldron. */
        .cauldron-screen {
          width: 100%; height: 100%;
          position: relative;
          border-radius: 6px;
          overflow: hidden;
          background: #000;
          box-shadow:
            inset 0 0 14px rgba(255,0,128,.7),
            inset 0 0 4px rgba(255,0,128,.9);
          border: 1px solid rgba(255,0,128,.55);
        }
        .cauldron-video {
          position: absolute; inset: 0;
          width: 100%; height: 100%;
          object-fit: cover;
          opacity: 0;
          transition: opacity .5s ease-in-out;
          display: block;
        }
        .cauldron-video.active { opacity: 1; }
        @media (prefers-reduced-motion: reduce) {
          .cauldron-video { transition: none; }
        }

        .bubble { opacity: 0; animation: bubbleUp 2s ease-in-out infinite; }
        .bubble.b1 { animation-delay: 0s; }
        .bubble.b2 { animation-delay: 0.6s; }
        .bubble.b3 { animation-delay: 1.2s; }
        .bubble.b4 { animation-delay: 1.8s; }
        .bubble.b5 { animation-delay: 2.4s; }
        @keyframes bubbleUp {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          30% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-15px) scale(1.2); }
        }

        .steam {
          position: absolute; bottom: 40%; left: 50%;
          transform: translateX(-50%);
          width: 50%; height: 50%;
          pointer-events: none; z-index: 3;
        }
        .steam span {
          position: absolute; bottom: 0;
          left: calc(20% + var(--i, 0) * 12%);
          width: 20px; height: 20px; border-radius: 50%;
          background: radial-gradient(circle, rgba(255,0,128,0.6) 0%, transparent 70%);
          filter: blur(8px); opacity: 0;
          animation: steamRise 3s ease-out infinite;
        }
        .steam span:nth-child(1) { --i: 0; animation-delay: 0s; }
        .steam span:nth-child(2) { --i: 1; animation-delay: 0.5s; }
        .steam span:nth-child(3) { --i: 2; animation-delay: 1s; }
        .steam span:nth-child(4) { --i: 3; animation-delay: 1.5s; }
        .steam span:nth-child(5) { --i: 4; animation-delay: 2s; }
        .steam span:nth-child(6) { --i: 5; animation-delay: 2.5s; }
        @keyframes steamRise {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          30% { opacity: 0.8; }
          100% { opacity: 0; transform: translateY(-100px) scale(2); }
        }

        .ingredient {
          position: absolute; top: 5%; left: 50%;
          transform: translateX(-50%);
          width: 38%; max-width: 160px;
          aspect-ratio: 1; opacity: 0; z-index: 4;
        }
        .ingredient picture,
        .ingredient img {
          width: 100%; height: 100%;
          object-fit: cover;
          border-radius: 8px;
          border: 2px solid var(--accent);
          box-shadow: 0 10px 30px rgba(255,0,128,0.4);
          display: block;
        }
        .ingredient-label {
          position: absolute; bottom: -24px; left: 50%;
          transform: translateX(-50%);
          font-family: var(--mono); font-size: 10px; letter-spacing: 0.18em;
          text-transform: uppercase; color: var(--accent);
          white-space: nowrap; font-weight: 700;
        }

        .script-card {
          width: 100%; height: 100%;
          background: var(--bg-3);
          border: 2px solid var(--accent);
          border-radius: 8px;
          padding: 20px 16px;
          display: flex; flex-direction: column; justify-content: center;
          gap: 8px;
          box-shadow: 0 10px 30px rgba(255,0,128,0.4);
        }
        .script-line {
          height: 6px;
          background: linear-gradient(90deg, var(--ink-2) 0%, var(--ink-3) 100%);
          border-radius: 3px;
        }
        .script-line.short { width: 60%; }

        .ingredient-product { animation: fallInProduct 12s linear infinite; animation-delay: 0s; }
        .ingredient-script  { animation: fallInScript  12s linear infinite; animation-delay: 0s; }
        .ingredient-avatar  { animation: fallInAvatar  12s linear infinite; animation-delay: 0s; }

        @keyframes fallInProduct {
          0%   { opacity: 0; transform: translateX(-50%) translateY(-50px) scale(0.8) rotate(-10deg); }
          4%   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) rotate(0deg); }
          8%   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) rotate(0deg); }
          13%  { opacity: 1; transform: translateX(-50%) translateY(80px) scale(0.7) rotate(15deg); }
          16%  { opacity: 0; transform: translateX(-50%) translateY(160px) scale(0.3) rotate(30deg); }
          17%, 100% { opacity: 0; transform: translateX(-50%) translateY(160px) scale(0.3) rotate(30deg); }
        }
        @keyframes fallInScript {
          0%, 17% { opacity: 0; transform: translateX(-50%) translateY(-50px) scale(0.8) rotate(-10deg); }
          21%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) rotate(0deg); }
          25%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) rotate(0deg); }
          30%  { opacity: 1; transform: translateX(-50%) translateY(80px) scale(0.7) rotate(15deg); }
          33%  { opacity: 0; transform: translateX(-50%) translateY(160px) scale(0.3) rotate(30deg); }
          34%, 100% { opacity: 0; transform: translateX(-50%) translateY(160px) scale(0.3) rotate(30deg); }
        }
        @keyframes fallInAvatar {
          0%, 33% { opacity: 0; transform: translateX(-50%) translateY(-50px) scale(0.8) rotate(-10deg); }
          38%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) rotate(0deg); }
          42%  { opacity: 1; transform: translateX(-50%) translateY(0) scale(1) rotate(0deg); }
          47%  { opacity: 1; transform: translateX(-50%) translateY(80px) scale(0.7) rotate(15deg); }
          50%  { opacity: 0; transform: translateX(-50%) translateY(160px) scale(0.3) rotate(30deg); }
          51%, 100% { opacity: 0; transform: translateX(-50%) translateY(160px) scale(0.3) rotate(30deg); }
        }

        .result-frame {
          position: absolute; bottom: 30%; left: 50%;
          transform: translateX(-50%) translateY(100px) scale(0.5);
          width: 42%; max-width: 170px;
          aspect-ratio: 9/16;
          opacity: 0; z-index: 5;
          animation: resultEmerge 12s linear infinite;
          animation-delay: 0s;
        }
        .result-frame picture,
        .result-frame img {
          width: 100%; height: 100%;
          object-fit: cover;
          border-radius: 8px;
          display: block;
        }
        .result-frame img {
          border: 3px solid var(--accent);
          box-shadow:
            0 0 50px rgba(255,0,128,0.6),
            0 10px 30px rgba(0,0,0,0.5);
        }
        @keyframes resultEmerge {
          0%, 67%    { opacity: 0; transform: translateX(-50%) translateY(100px) scale(0.3); }
          72%        { opacity: 1; transform: translateX(-50%) translateY(-30px) scale(1.15); }
          76%        { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
          88%        { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
          92%        { opacity: 0; transform: translateX(-50%) translateY(-30px) scale(0.8); }
          93%, 100%  { opacity: 0; transform: translateX(-50%) translateY(-50px) scale(0.5); }
        }

        .result-badge {
          position: absolute; top: -12px; right: -12px;
          background: var(--accent); color: var(--bg);
          padding: 6px 12px; border-radius: 20px;
          font-family: var(--mono); font-size: 10px; font-weight: 700;
          letter-spacing: 0.1em; text-transform: uppercase;
          display: flex; align-items: center; gap: 5px;
          box-shadow: 0 4px 12px rgba(255,0,128,0.5);
        }
        .result-badge .check { font-size: 12px; font-weight: 900; }

        .flash {
          position: absolute; inset: 0;
          background: white; opacity: 0;
          pointer-events: none; z-index: 6;
          animation: flashPulse 12s linear infinite;
          animation-delay: 0s;
        }
        @keyframes flashPulse {
          0%, 65%, 70%, 100% { opacity: 0; }
          67% { opacity: 0.7; }
          68% { opacity: 0.3; }
          69% { opacity: 0.9; }
        }

        @media (prefers-reduced-motion: reduce) {
          .ingredient-product,
          .ingredient-script,
          .ingredient-avatar,
          .result-frame,
          .flash,
          .cauldron,
          .stage-glow,
          .bubble,
          .steam span { animation: none; }
          .result-frame { opacity: 1; transform: translateX(-50%); }
        }
        .editorial-frame { position: relative; width: 100%; height: 100%; }
        .editorial-frame .corner {
          position: absolute; width: 14px; height: 14px;
          border-color: var(--accent); border-style: solid;
        }
        .editorial-frame .corner.tl { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
        .editorial-frame .corner.tr { top: -1px; right: -1px; border-width: 2px 2px 0 0; }
        .editorial-frame .corner.bl { bottom: -1px; left: -1px; border-width: 0 0 2px 2px; }
        .editorial-frame .corner.br { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }
        .editorial-frame .label-top {
          position: absolute; top: -24px; right: 0;
          font-family: var(--mono); font-size: 10px; letter-spacing: .2em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .editorial-frame .label-top .accent { color: var(--accent); }
        .editorial-frame .label-bottom {
          position: absolute; bottom: -24px; left: 0;
          font-family: var(--mono); font-size: 10px; letter-spacing: .2em;
          text-transform: uppercase; color: var(--ink-3);
        }

        .scroll-cue {
          position: absolute; bottom: 30px; right: 40px;
          font-family: var(--mono); font-size: 10px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3);
          display: flex; align-items: center; gap: 12px;
        }
        .scroll-cue .line {
          width: 40px; height: 1px; background: var(--accent);
          position: relative; overflow: hidden;
        }
        .scroll-cue .line::after {
          content: ""; position: absolute; inset: 0;
          background: var(--bg); animation: cue-line 2s ease-in-out infinite;
        }
        @keyframes cue-line { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }

        .section-divider {
          display: flex; align-items: center; gap: 20px;
          padding: 0 40px; margin: 60px 0 40px;
          font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .section-divider .num { color: var(--accent); font-weight: 700; }
        .section-divider .line { flex: 1; height: 1px; background: var(--line); }

        .flow-section { padding: 40px 40px 140px; position: relative; }
        .flow-header { max-width: 1200px; margin: 0 auto 60px; text-align: center; }
        .flow-title {
          font-family: var(--display); font-weight: 900;
          font-size: clamp(48px, 7vw, 100px); line-height: .95;
          letter-spacing: -.04em; margin-bottom: 24px;
        }
        .flow-title .accent { color: var(--accent); }
        .flow-title .stroke { -webkit-text-stroke: 2px var(--ink); color: transparent; }
        .flow-lede {
          font-size: 20px; color: var(--ink-2); max-width: 560px;
          margin: 0 auto; line-height: 1.5;
        }

        .tabs { display: flex; gap: 14px; justify-content: center; margin-bottom: 60px; flex-wrap: wrap; }
        .tab {
          padding: 14px 24px;
          border: 1px solid rgba(217,70,239,.18);
          background: rgba(255,255,255,.035);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          color: var(--ink-2);
          border-radius: 14px;
          font-family: var(--display);
          font-weight: 600; font-size: 15px;
          min-height: 48px;
          transition: transform .35s cubic-bezier(.16,1,.3,1),
                      border-color .35s cubic-bezier(.16,1,.3,1),
                      background .35s cubic-bezier(.16,1,.3,1),
                      box-shadow .35s cubic-bezier(.16,1,.3,1),
                      color .35s cubic-bezier(.16,1,.3,1);
          display: inline-flex; align-items: center; gap: 10px; position: relative;
          cursor: pointer;
        }
        .tab .tab-num {
          font-family: var(--mono); font-size: 10px; color: var(--ink-3);
          font-weight: 600; letter-spacing: .14em;
        }
        .tab:hover:not(.active) {
          border-color: rgba(217,70,239,.55);
          color: var(--ink);
          transform: translateY(-2px) scale(1.02);
          box-shadow: 0 12px 28px -10px rgba(217,70,239,.35);
          background: rgba(217,70,239,.06);
        }
        .tab.active {
          background: linear-gradient(135deg, var(--accent) 0%, #d946ef 100%);
          color: var(--bg);
          border-color: var(--accent);
          box-shadow: 0 14px 36px -10px rgba(255,0,128,.55), 0 0 0 1px rgba(255,255,255,.1) inset;
          transform: translateY(-1px);
        }
        .tab.active .tab-num { color: var(--bg); opacity: .8; }

        .flow-branch { max-width: 920px; margin: 0 auto; position: relative; }
        .branch-line {
          position: absolute; top: 0; bottom: 0; right: 50%;
          width: 2px; background: var(--line);
          transform: translateX(1px); z-index: 0;
        }
        .branch-line-fill {
          position: absolute; top: 0; right: 0; width: 100%;
          background: linear-gradient(to bottom, var(--accent), var(--accent-2));
          height: 0; transition: height .8s cubic-bezier(.2,.8,.2,1);
          box-shadow: 0 0 20px var(--accent-glow);
        }

        .step {
          position: relative; padding: 60px 0;
          display: grid; grid-template-columns: 1fr 80px 1fr;
          align-items: center; gap: 40px;
          opacity: 0; transform: translateY(30px);
          transition: opacity .8s cubic-bezier(.2,.8,.2,1), transform .8s cubic-bezier(.2,.8,.2,1);
        }
        .step.in { opacity: 1; transform: none; }
        .step-node {
          position: relative; z-index: 2; justify-self: center;
          width: 80px; height: 80px; border-radius: 50%;
          background: var(--bg); border: 2px solid var(--line);
          display: flex; align-items: center; justify-content: center;
          font-family: var(--display); font-weight: 900; font-size: 28px;
          color: var(--ink-3); transition: all .5s cubic-bezier(.2,.8,.2,1);
          letter-spacing: -.03em;
        }
        .step.active .step-node {
          background: var(--accent); border-color: var(--accent);
          color: var(--bg); box-shadow: 0 0 40px var(--accent-glow);
          transform: scale(1.1);
        }
        .step-info { text-align: right; }
        .step.right-side .step-info { text-align: left; }
        .step .step-info { grid-column: 1; grid-row: 1; }
        .step.right-side .step-info { grid-column: 3; grid-row: 1; }
        .step .step-visual { grid-column: 3; grid-row: 1; }
        .step.right-side .step-visual { grid-column: 1; grid-row: 1; }
        .step-label {
          font-family: var(--mono); font-size: 10px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--accent);
          margin-bottom: 12px; font-weight: 700;
        }
        .step-title {
          font-family: var(--display); font-weight: 900;
          font-size: 32px; line-height: 1.05;
          letter-spacing: -.03em; margin-bottom: 12px;
        }
        .step-desc { color: var(--ink-2); font-size: 15px; line-height: 1.5; max-width: 320px; }
        .step.right-side .step-desc { margin-left: 0; margin-right: auto; }
        .step:not(.right-side) .step-desc { margin-left: auto; margin-right: 0; }

        .step-visual {
          position: relative; background: var(--bg-2);
          border: 1px solid var(--line); border-radius: 6px;
          padding: 28px; min-height: 240px;
        }

        .demo-textbox {
          background: var(--bg-3); border: 1px solid var(--line-2);
          border-radius: 4px; padding: 20px;
          font-family: var(--body); font-size: 16px; line-height: 1.55;
          color: var(--ink); min-height: 120px; position: relative;
        }
        .demo-textbox.typing::after {
          content: ""; display: inline-block;
          width: 2px; height: 18px; background: var(--accent);
          margin-inline-start: 2px; vertical-align: middle;
          animation: caret-blink 1s steps(2) infinite;
        }
        @keyframes caret-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
        .demo-textbox-label {
          font-family: var(--mono); font-size: 10px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3); margin-bottom: 10px;
        }

        .demo-dropzone {
          background: var(--bg-3); border: 1.5px dashed var(--line-2);
          border-radius: 4px; padding: 16px;
          display: flex; align-items: center; justify-content: center;
          min-height: 220px; position: relative; overflow: hidden;
          transition: border-color .3s;
        }
        .step.active .demo-dropzone { border-color: var(--accent); }
        .demo-dropzone img {
          max-width: 100%; max-height: 200px; object-fit: contain;
          opacity: 0; transform: scale(.8) translateY(-20px);
          transition: all .6s cubic-bezier(.2,.8,.2,1);
        }
        .demo-dropzone.has-image img { opacity: 1; transform: none; }
        .demo-dropzone-placeholder {
          color: var(--ink-3); font-family: var(--mono);
          font-size: 11px; letter-spacing: .18em;
          text-transform: uppercase; text-align: center;
          line-height: 1.8; transition: opacity .3s;
        }
        .demo-dropzone.has-image .demo-dropzone-placeholder { opacity: 0; position: absolute; }
        .demo-dropzone-check {
          position: absolute; top: 12px; left: 12px;
          font-family: var(--mono); font-size: 10px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--accent);
          background: rgba(255,0,128,.1); border: 1px solid var(--accent);
          padding: 4px 10px; border-radius: 2px;
          opacity: 0; transition: opacity .4s;
        }
        .demo-dropzone.has-image .demo-dropzone-check { opacity: 1; }

        .demo-avatars { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .demo-avatar {
          aspect-ratio: 3/4; border-radius: 4px;
          border: 2px solid var(--line); background: var(--bg-3);
          position: relative; overflow: hidden;
          transition: all .3s; cursor: pointer;
        }
        .demo-avatar img {
          width: 100%; height: 100%;
          object-fit: cover; display: block;
        }
        .demo-avatar .name-badge {
          position: absolute; bottom: 0; left: 0; right: 0;
          padding: 12px 10px 10px;
          background: linear-gradient(to top, rgba(0,0,0,.9), transparent);
        }
        .demo-avatar .name {
          display: block;
          font-family: var(--display); font-weight: 700; font-size: 14px;
          color: var(--ink);
        }
        .demo-avatar .voice {
          display: block;
          font-family: var(--mono); font-size: 9px; letter-spacing: .12em;
          text-transform: uppercase; color: var(--accent);
          margin-top: 3px;
        }
        .demo-avatar.selected {
          border-color: var(--accent);
          box-shadow: 0 0 30px var(--accent-glow);
          transform: scale(1.05);
        }
        .demo-avatar.selected::after {
          content: "✓"; position: absolute; top: 6px; right: 6px;
          width: 20px; height: 20px; background: var(--accent);
          color: var(--bg); border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700; z-index: 3;
        }

        .voice-picker {
          margin-top: 20px; padding-top: 20px;
          border-top: 1px solid var(--line);
        }
        .voice-picker-label {
          font-family: var(--mono); font-size: 10px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3); margin-bottom: 12px;
        }
        .voice-options { display: flex; gap: 8px; flex-wrap: wrap; }
        .voice-option {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          background: var(--bg-3); border: 1px solid var(--line-2);
          border-radius: 4px; font-size: 13px; color: var(--ink-2);
          cursor: pointer; transition: all .2s;
          font-family: var(--body);
        }
        .voice-option.active {
          border-color: var(--accent);
          background: rgba(255,0,128,.1);
          color: var(--ink);
        }
        .voice-option.locked { opacity: .5; cursor: not-allowed; }
        .voice-icon { color: var(--accent); font-size: 16px; }
        .voice-tag {
          font-family: var(--mono); font-size: 9px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .voice-option.active .voice-tag { color: var(--accent); }

        .demo-result {
          position: relative; display: flex; flex-direction: column;
          align-items: center; padding: 12px;
        }
        .demo-video {
          aspect-ratio: 9/16; max-height: 320px; width: auto;
          border-radius: 6px; border: 1px solid var(--line-2);
          background: var(--bg-3); overflow: hidden; position: relative;
        }
        .demo-video video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .demo-result-meta {
          margin-top: 16px; display: flex; gap: 16px;
          font-family: var(--mono); font-size: 10px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .demo-result-meta .accent { color: var(--accent); }
        .demo-result-actions {
          margin-top: 20px; display: flex; gap: 10px;
          width: 100%; justify-content: center;
        }
        .demo-result-actions .btn { padding: 10px 18px; font-size: 13px; }
        .step-visual .cap {
          position: absolute; top: 12px; right: 12px;
          font-family: var(--mono); font-size: 9px; letter-spacing: .14em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .step-visual .cap .bullet { color: var(--accent); }

        .pricing-section { padding: 40px 40px 120px; position: relative; }
        .pricing-header { max-width: 900px; margin: 0 auto 60px; text-align: center; }
        .pricing-title {
          font-family: var(--display); font-weight: 900;
          font-size: clamp(48px, 7vw, 100px); line-height: .95;
          letter-spacing: -.04em; margin-bottom: 20px;
        }
        .pricing-title .accent { color: var(--accent); }
        .pricing-lede {
          font-size: 20px; color: var(--ink-2); max-width: 520px;
          margin: 0 auto; line-height: 1.5;
        }
        .pricing-grid {
          max-width: 1200px; margin: 0 auto;
          display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
        }
        .plan {
          background: var(--bg-2); border: 1px solid var(--line);
          border-radius: 6px; padding: 40px 32px; position: relative;
          display: flex; flex-direction: column; transition: all .3s;
        }
        .plan:hover { border-color: var(--line-2); transform: translateY(-4px); }
        .plan.featured {
          border-color: var(--accent);
          background: linear-gradient(180deg, rgba(255,0,128,.08) 0%, var(--bg-2) 40%);
          box-shadow: 0 20px 60px -20px var(--accent-glow);
        }
        .plan.featured:hover { transform: translateY(-6px); box-shadow: 0 30px 80px -20px var(--accent-glow); }
        .plan-badge {
          position: absolute; top: -12px; right: 24px;
          background: var(--accent); color: var(--bg);
          font-family: var(--mono); font-size: 10px;
          font-weight: 700; letter-spacing: .16em;
          text-transform: uppercase; padding: 6px 14px; border-radius: 2px;
        }
        .plan-icon { font-size: 32px; margin-bottom: 12px; }
        .plan-label {
          font-family: var(--mono); font-size: 10px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3);
          font-weight: 700; margin-bottom: 8px;
        }
        .plan-name {
          font-family: var(--display); font-weight: 900;
          font-size: 28px; letter-spacing: -.03em; margin-bottom: 16px;
        }
        .plan-price {
          font-family: var(--display); font-weight: 900;
          font-size: 56px; letter-spacing: -.04em;
          line-height: 1; margin-bottom: 4px;
        }
        .plan-price .currency {
          font-size: .55em; color: var(--ink-2);
          margin-inline-start: 4px; font-weight: 700;
        }
        .plan-period {
          font-family: var(--mono); font-size: 11px; letter-spacing: .16em;
          text-transform: uppercase; color: var(--ink-3); margin-bottom: 28px;
        }
        .plan.featured .plan-price { color: var(--accent); }
        .plan-features { list-style: none; margin-bottom: 32px; flex: 1; }
        .plan-features li {
          padding: 10px 0; font-size: 14px; color: var(--ink);
          border-bottom: 1px solid var(--line);
          display: flex; align-items: flex-start; gap: 10px; line-height: 1.4;
        }
        .plan-features li:last-child { border-bottom: none; }
        .plan-features li .check {
          color: var(--accent); font-weight: 700;
          flex-shrink: 0; font-size: 16px; line-height: 1.2;
        }
        .plan-features li.muted { color: var(--ink-3); }
        .plan-features li.muted .check { color: var(--ink-3); opacity: .5; }
        .plan-cta {
          width: 100%; justify-content: center;
          padding: 16px; font-size: 15px;
        }
        .plan-note {
          font-family: var(--mono); font-size: 10px; letter-spacing: .14em;
          text-transform: uppercase; color: var(--ink-3);
          text-align: center; margin-top: 12px; line-height: 1.6;
        }

        .final-cta {
          padding: 100px 40px; text-align: center;
          border-top: 1px solid var(--line);
          position: relative; overflow: hidden;
        }
        .final-cta::before {
          content: ""; position: absolute; top: 0; left: 50%;
          transform: translateX(-50%);
          width: 120%; height: 500px;
          background: radial-gradient(ellipse at center top, rgba(255,0,128,.15), transparent 60%);
          pointer-events: none;
        }
        .final-cta-content { position: relative; z-index: 2; }
        .final-cta-title {
          font-family: var(--display); font-weight: 900;
          font-size: clamp(56px, 9vw, 140px); line-height: .92;
          letter-spacing: -.04em; margin-bottom: 24px;
        }
        .final-cta-title .accent {
          background: linear-gradient(135deg, var(--accent) 0%, #ff8be0 50%, #d946ef 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          text-shadow: 0 0 50px rgba(255,0,128,.45);
        }
        .final-cta-sub {
          font-size: 22px; color: var(--ink-2);
          margin-bottom: 40px; line-height: 1.5;
          max-width: 600px; margin-inline: auto;
        }

        .footer {
          padding: 80px 40px 28px;
          border-top: 1px solid var(--line);
          background:
            radial-gradient(ellipse at 50% 0%, rgba(255,0,128,.08), transparent 60%),
            var(--bg);
          color: var(--ink-2);
          position: relative;
        }
        .footer-grid {
          max-width: 1200px;
          margin: 0 auto 56px;
          display: grid;
          grid-template-columns: 1.6fr 1fr 1fr 1fr;
          gap: 56px;
          align-items: start;
        }
        .footer-brand-block { max-width: 360px; }
        .footer-logo {
          display: inline-flex; align-items: center; gap: 10px;
          margin-bottom: 16px;
        }
        .footer-logo-dot {
          width: 10px; height: 10px; border-radius: 2px;
          background: var(--accent);
          box-shadow: 0 0 14px var(--accent-glow);
        }
        .footer-logo-text {
          font-family: var(--display); font-weight: 900;
          font-size: 22px; letter-spacing: -.03em;
          color: var(--ink);
        }
        .footer-logo-version {
          font-family: var(--mono); font-size: 10px; letter-spacing: .2em;
          color: var(--ink-3); font-weight: 500; margin-inline-start: 8px;
        }
        .footer-tagline {
          color: var(--ink-2);
          font-size: 14px; line-height: 1.6;
          margin-bottom: 18px;
        }
        .footer-made {
          font-family: var(--mono); font-size: 10px; letter-spacing: .18em;
          text-transform: uppercase; color: var(--ink-3);
          display: inline-flex; align-items: center; gap: 8px;
        }
        .footer-flag {
          color: var(--accent);
          text-shadow: 0 0 8px var(--accent-glow);
          font-size: 12px;
        }

        .footer-col { display: flex; flex-direction: column; gap: 10px; }
        .footer-col-title {
          font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
          text-transform: uppercase; color: #d946ef;
          font-weight: 700; margin-bottom: 6px;
        }
        .footer-link {
          font-family: var(--body); font-size: 14px;
          color: var(--ink-2);
          display: inline-flex; align-items: center; gap: 8px;
          transition: color .25s cubic-bezier(.16,1,.3,1),
                      transform .25s cubic-bezier(.16,1,.3,1);
          width: fit-content;
        }
        .footer-link:hover {
          color: #ff8be0;
          transform: translateX(-3px);
        }
        .footer-link svg {
          opacity: .8; transition: opacity .25s;
        }
        .footer-link:hover svg { opacity: 1; color: #ff8be0; }

        .footer-bottom {
          max-width: 1200px;
          margin: 0 auto;
          padding-top: 22px;
          border-top: 1px solid var(--line);
          display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
          font-family: var(--mono); font-size: 11px; letter-spacing: .14em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .footer-copy { color: var(--ink-2); }
        .footer-bottom-spacer { flex: 1; }

        @media (max-width: 900px) {
          .footer { padding: 56px 20px 24px; }
          .footer-grid {
            grid-template-columns: 1fr 1fr;
            gap: 36px 24px;
            margin-bottom: 40px;
          }
          .footer-brand-block { grid-column: 1 / -1; max-width: none; }
          .footer-bottom { justify-content: center; text-align: center; }
          .footer-bottom-spacer { display: none; }
        }

        @media (max-width: 900px) {
          .nav { padding: 16px 20px; }
          .nav-links { display: none; }
          .hero { padding: 100px 20px 60px; }
          .hero-content { grid-template-columns: 1fr; gap: 50px; margin-top: 60px; }
          .section-divider { padding: 0 20px; margin: 40px 0 30px; }
          .flow-section, .pricing-section { padding: 30px 20px 80px; }
          .step { grid-template-columns: 50px 1fr; gap: 20px; padding: 40px 0; }
          .step .step-info,
          .step.right-side .step-info { grid-column: 2; grid-row: 1; text-align: right; }
          .step .step-visual,
          .step.right-side .step-visual { grid-column: 2; grid-row: 2; margin-top: 20px; }
          .step-node { width: 50px; height: 50px; font-size: 18px; }
          .branch-line { right: 25px; }
          .pricing-grid { grid-template-columns: 1fr; }
          .scroll-cue { display: none; }
        }
        @media (max-width: 900px) {
          .hero-animation { max-height: 60vh; aspect-ratio: 3/4; }
          .ingredient { width: 30%; }
          .ingredient-label { font-size: 9px; bottom: -20px; }
          .cauldron { width: 35%; }
          .result-frame { width: 35%; }
        }

        .reveal {
          opacity: 0; transform: translateY(24px);
          transition: opacity .8s cubic-bezier(.2,.8,.2,1), transform .8s cubic-bezier(.2,.8,.2,1);
        }
        .reveal.in { opacity: 1; transform: none; }
        .reveal.delay-1 { transition-delay: .1s; }
        .reveal.delay-2 { transition-delay: .2s; }
        .reveal.delay-3 { transition-delay: .3s; }
        .reveal.delay-4 { transition-delay: .4s; }

        /* Sound controls — per-video toggle + first-time hint. */
        .sound-toggle {
          position: absolute; top: 16px; right: 16px; z-index: 10;
          width: 40px; height: 40px; border-radius: 50%;
          background: rgba(0,0,0,.7); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,.14);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px; line-height: 1; cursor: pointer;
          transition: transform .2s, background .2s, border-color .2s;
        }
        .sound-toggle:hover {
          background: rgba(0,0,0,.85);
          border-color: var(--accent);
          transform: scale(1.08);
        }
        .sound-hint {
          position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
          z-index: 10; pointer-events: none;
          background: rgba(0,0,0,.75); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
          border: 1px solid var(--accent);
          color: var(--ink);
          padding: 8px 14px; border-radius: 100px;
          font-family: var(--body); font-weight: 600; font-size: 12px;
          letter-spacing: .02em; white-space: nowrap;
          animation: sound-hint-pulse 1.2s ease-in-out infinite;
          box-shadow: 0 6px 20px rgba(255,0,128,.3);
        }
        @keyframes sound-hint-pulse {
          0%, 100% { transform: translateX(-50%) scale(1); opacity: .95; }
          50% { transform: translateX(-50%) scale(1.06); opacity: 1; }
        }

        /* ===== POLISH — gradients, glass, hover, social proof ===== */
        .tab-cat {
          display: inline-block;
          margin-inline-start: 8px;
          padding: 2px 8px;
          background: rgba(217,70,239,.18);
          color: #d946ef;
          border: 1px solid rgba(217,70,239,.35);
          border-radius: 100px;
          font-family: var(--mono); font-size: 9px;
          letter-spacing: .14em; text-transform: uppercase;
          font-weight: 700;
        }
        .tab.active .tab-cat {
          background: rgba(0,0,0,.25);
          color: var(--bg);
          border-color: transparent;
        }

        /* Pulsing primary CTA — used for the hero "Try" button. */
        .btn-pulse {
          position: relative;
          animation: btn-pulse 2.4s ease-in-out infinite;
        }
        .btn-pulse:hover { animation-play-state: paused; transform: translateY(-3px) scale(1.03); }
        @keyframes btn-pulse {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(255,0,128,.55), 0 8px 24px -6px rgba(255,0,128,.6);
          }
          50% {
            box-shadow: 0 0 0 14px rgba(255,0,128,0), 0 14px 30px -6px rgba(255,0,128,.7);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .btn-pulse { animation: none; }
        }

        /* Live counter under the hero CTA. */
        .live-proof {
          display: inline-flex; align-items: center; gap: 10px;
          margin-top: 14px;
          padding: 8px 14px;
          background: rgba(255,255,255,.04);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(217,70,239,.22);
          border-radius: 100px;
          font-family: var(--body); font-size: 13px;
          color: var(--ink-2);
        }
        .live-proof b { color: var(--ink); font-weight: 800; }
        .live-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #20e070;
          box-shadow: 0 0 10px #20e070;
          animation: live-blink 1.6s ease-in-out infinite;
        }
        @keyframes live-blink { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .4; transform: scale(.85); } }

        /* Sweeping gradient on display-h1 .accent (subtle sheen). */
        .display-h1 .accent {
          background: linear-gradient(135deg, #ff0080 0%, #ff8be0 50%, #d946ef 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          text-shadow: 0 0 40px rgba(255,0,128,.35);
        }

        /* Mid-page CTA — glass card between FLOW and PRICING. */
        .mid-cta {
          padding: 60px 40px;
          position: relative;
          overflow: hidden;
        }
        .mid-cta::before {
          content: ''; position: absolute; inset: 0;
          background:
            radial-gradient(ellipse at 20% 50%, rgba(217,70,239,.18), transparent 55%),
            radial-gradient(ellipse at 80% 50%, rgba(255,0,128,.14), transparent 55%);
          pointer-events: none;
        }
        .mid-cta-inner {
          position: relative;
          max-width: 1100px;
          margin: 0 auto;
          padding: 36px 42px;
          background: rgba(255,255,255,.04);
          backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(217,70,239,.22);
          border-radius: 24px;
          display: flex; align-items: center; justify-content: space-between;
          gap: 32px; flex-wrap: wrap;
          box-shadow: 0 20px 60px -20px rgba(217,70,239,.35);
        }
        .mid-cta-eyebrow {
          font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
          text-transform: uppercase; color: #d946ef;
          margin-bottom: 12px; font-weight: 700;
        }
        .mid-cta-title {
          font-family: var(--display); font-weight: 900;
          font-size: clamp(32px, 4.4vw, 52px);
          line-height: 1.05; letter-spacing: -.03em;
          margin-bottom: 12px; color: var(--ink);
        }
        .mid-cta-accent {
          background: linear-gradient(135deg, #d946ef 0%, #ff8be0 100%);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
        }
        .mid-cta-sub { color: var(--ink-2); font-size: 15px; line-height: 1.5; }
        .mid-cta-btn {
          flex-shrink: 0;
          position: relative;
          padding: 18px 32px;
          font-size: 16px; font-weight: 800;
          min-height: 56px;
          background: linear-gradient(135deg, #ff0080 0%, #d946ef 100%);
          color: #fff;
          border-radius: 100px;
          box-shadow: 0 12px 36px -8px rgba(217,70,239,.65),
                      inset 0 1px 0 rgba(255,255,255,.22);
          transition: transform .35s cubic-bezier(.16,1,.3,1),
                      box-shadow .35s cubic-bezier(.16,1,.3,1);
        }
        .mid-cta-btn::before {
          content: '';
          position: absolute;
          inset: -8px -16px;
          border-radius: inherit;
          background: radial-gradient(ellipse at center, rgba(217,70,239,.55), transparent 70%);
          z-index: -1;
          opacity: .6;
          filter: blur(14px);
          transition: opacity .35s cubic-bezier(.16,1,.3,1);
        }
        .mid-cta-btn:hover {
          transform: translateY(-3px) scale(1.04);
          box-shadow: 0 22px 56px -8px rgba(217,70,239,.85),
                      inset 0 1px 0 rgba(255,255,255,.28);
        }
        .mid-cta-btn:hover::before { opacity: 1; }

        /* Cinematic ambient blob in hero — slow oscillation, behind everything. */
        .hero::before {
          content: '';
          position: absolute;
          top: -10%; right: -20%;
          width: 70vw; height: 70vw;
          max-width: 900px; max-height: 900px;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 40%, rgba(255,0,128,.18), transparent 60%);
          filter: blur(60px);
          z-index: 0;
          pointer-events: none;
          animation: hero-blob 22s ease-in-out infinite;
        }
        @keyframes hero-blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33%      { transform: translate(-6vw, 4vh) scale(1.1); }
          66%      { transform: translate(4vw, -3vh) scale(.95); }
        }
        @media (prefers-reduced-motion: reduce) {
          .hero::before { animation: none; }
        }

        /* Subtle floating particles in the hero. */
        .hero::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image:
            radial-gradient(circle at 12% 20%, rgba(217,70,239,.18) 0, transparent 1.5px),
            radial-gradient(circle at 88% 35%, rgba(255,0,128,.22) 0, transparent 1.5px),
            radial-gradient(circle at 22% 78%, rgba(217,70,239,.15) 0, transparent 1.5px),
            radial-gradient(circle at 72% 88%, rgba(255,0,128,.18) 0, transparent 1.5px),
            radial-gradient(circle at 50% 45%, rgba(217,70,239,.12) 0, transparent 1.5px),
            radial-gradient(circle at 8% 60%, rgba(255,255,255,.08) 0, transparent 1px),
            radial-gradient(circle at 92% 70%, rgba(255,255,255,.08) 0, transparent 1px);
          background-size: 1200px 900px;
          animation: hero-particles 30s linear infinite;
          opacity: .85;
          z-index: 0;
        }
        @keyframes hero-particles {
          0% { background-position: 0 0, 0 0, 0 0, 0 0, 0 0, 0 0, 0 0; }
          100% { background-position: 0 -900px, 0 -900px, 0 -900px, 0 -900px, 0 -900px, 0 -900px, 0 -900px; }
        }
        .hero > * { position: relative; z-index: 1; }
        @media (prefers-reduced-motion: reduce) {
          .hero::after { animation: none; }
        }

        /* Touch-friendly hit targets on mobile. */
        @media (max-width: 900px) {
          .btn { min-height: 48px; }
          .mid-cta { padding: 40px 20px; }
          .mid-cta-inner { padding: 28px 24px; flex-direction: column; align-items: stretch; text-align: center; }
          .mid-cta-btn { width: 100%; justify-content: center; }
        }

        /* ===== PRO CARD — neon green ===== */
        .plan.pro-card {
          background: linear-gradient(180deg, #001a0d 0%, #000 100%);
          border: 2px solid #00ff88;
          box-shadow: 0 0 30px rgba(0,255,136,.33), inset 0 0 20px rgba(0,255,136,.13);
          position: relative;
          overflow: hidden;
        }
        .plan.pro-card::before {
          content: '';
          position: absolute;
          top: -50%; left: -50%;
          width: 200%; height: 200%;
          background: radial-gradient(circle, rgba(0,255,136,.22) 0%, transparent 70%);
          animation: pulse-flame 3s ease-in-out infinite;
          pointer-events: none;
          z-index: 0;
        }
        .plan.pro-card::after {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(140deg, transparent 30%, rgba(0,255,136,.12) 50%, transparent 70%);
          animation: pulse-flame 4.5s ease-in-out infinite reverse;
          pointer-events: none;
          z-index: 0;
        }
        .plan.pro-card > * { position: relative; z-index: 1; }
        @keyframes pulse-flame {
          0%, 100% { opacity: 0.4; transform: scale(0.9); }
          50% { opacity: 0.75; transform: scale(1.1); }
        }
        .plan.pro-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 0 50px rgba(0,255,136,.55), inset 0 0 22px rgba(0,255,136,.18);
          border-color: #00ff88;
        }
        .plan.pro-card .pro-title {
          color: #00ff88;
          text-shadow: 0 0 10px rgba(0,255,136,.85), 0 0 20px rgba(0,255,136,.55);
        }
        .plan.pro-card .plan-price {
          color: #00ff88;
          text-shadow: 0 0 12px rgba(0,255,136,.5);
        }
        .plan.pro-card .plan-price .currency { color: rgba(0,255,136,.7); }
        .plan.pro-card .plan-features li {
          border-bottom-color: rgba(0,255,136,.16);
          color: var(--ink);
        }
        .plan.pro-card .plan-features li .check {
          color: #00ff88;
          text-shadow: 0 0 8px rgba(0,255,136,.85);
        }
        .plan.pro-card .pro-badge {
          background: #00ff88;
          color: #001a0d;
          box-shadow: 0 0 22px rgba(0,255,136,.65);
          font-weight: 800;
        }
        .plan.pro-card .btn-primary.pro-cta {
          background: #00ff88;
          color: #001a0d;
          font-weight: 800;
        }
        .plan.pro-card .btn-primary.pro-cta:hover {
          box-shadow: 0 10px 32px -6px #00ff88;
          transform: translateY(-2px);
        }
        .plan.pro-card .plan-label { color: rgba(0,255,136,.7); }
        .plan.pro-card .plan-note { color: rgba(0,255,136,.5); }
      `}</style>
    </>
  )
}
