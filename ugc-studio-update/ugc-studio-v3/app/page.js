'use client'

import { useEffect, useRef, useState } from 'react'

// Product images now ship as {base}.webp + {base}.jpg for mobile fallback,
// so `image` stores the base path (no extension).
const PRODUCTS = {
  icecream: {
    script: "חזית הגלידריה הכי צבעונית בתל אביב. גלידה איטלקית עם טעמים ייחודיים, ישיבה בחוץ, אווירה שכונתית חמה. מתאים לקיץ, למשפחות, ולחברים.",
    image: "/landing-assets/product-icecream",
    imageW: 1000, imageH: 545,
    video: "/landing-assets/video-icecream.mp4",
    poster: "/landing-assets/poster-icecream.jpg",
    selected: 0,
  },
  kipa: {
    script: "כיפת קטיפה איכותית בגווני ורוד ופודרה עם רקמה מעוצבת. מתאימה לחתונות, לבר מצווה ולשבת. הרגשה רכה, מראה אלגנטי, ייחודית במיוחד.",
    image: "/landing-assets/product-kipa",
    imageW: 500, imageH: 500,
    video: "/landing-assets/video-kipa.mp4",
    poster: "/landing-assets/poster-kipa.jpg",
    selected: 1,
  },
  teeth: {
    script: "אבקת הלבנת שיניים טבעית 100% על בסיס פחם פעיל. מלבינה ומנקה מבלי לפגוע באמייל. רק 30 שניות ביום לחיוך לבן ובוהק.",
    image: "/landing-assets/product-teeth",
    imageW: 1000, imageH: 1000,
    video: "/landing-assets/video-teeth.mp4",
    poster: "/landing-assets/poster-teeth.jpg",
    selected: 2,
  },
}

export default function LandingPage() {
  const [type, setType] = useState('product')   // 'product' | 'business' — hero headline variant
  const [voiceActive, setVoiceActive] = useState('noa')
  const [currentProduct, setCurrentProduct] = useState('icecream')
  const [scrolled, setScrolled] = useState(false)
  const [typedText, setTypedText] = useState('')
  const [hasImage, setHasImage] = useState(false)
  const [imageSrc, setImageSrc] = useState('')

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

  // Switch product (from tab click)
  const switchProduct = (key) => {
    if (key === currentProduct) return
    setCurrentProduct(key)
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

  // Start typing when step 1 enters view
  useEffect(() => {
    const el = step1Ref.current
    if (!el) return
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting && !typingStartedRef.current) {
          typingStartedRef.current = true
          setTimeout(() => {
            retypeText(PRODUCTS[currentProduct].script)
            setTimeout(() => {
              setImageSrc(PRODUCTS[currentProduct].image)
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

  const onCheckout = (tier) => {
    console.log(`TODO: implement checkout for ${tier}`)
  }

  const data = PRODUCTS[currentProduct]

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
              <a href="#pricing" className="btn btn-primary btn-lg">
                נסה 3 ימים ב-₪20
                <svg viewBox="0 0 16 16" fill="none"><path d="M13 8l-6 5V3l6 5z" fill="currentColor" /></svg>
              </a>
              <a href="#flow" className="btn btn-ghost btn-lg">
                <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" /><path d="M11 8l-4 2.5v-5L11 8z" fill="currentColor" /></svg>
                ראה איך זה עובד
              </a>
            </div>
            <div className="hero-cta-micro reveal delay-3">
              <span className="check">✓</span>1 סרטון מלא &nbsp;<span className="check">✓</span>ללא חידוש אוטומטי &nbsp;<span className="check">✓</span>ייצוא MP4 מלא
            </div>
            <div className="hero-footnote reveal delay-4">
              <span style={{ color: 'var(--ink-2)' }}>+2,000 יזמים ישראלים</span>&nbsp;·&nbsp;פייבק ממוצע 11 ימים&nbsp;·&nbsp;כל השפות נתמכות
            </div>
          </div>

        </div>

        <div className="scroll-cue">
          <span>גלול · SCROLL</span>
          <span className="line" />
        </div>
      </section>

      {/* HERO MARQUEE — full-width horizontal scroller */}
      <section className="hero-marquee">
        <div className="marquee-label">
          <span className="pulse" />
          <span>+2,047 סרטונים נוצרו השבוע</span>
          <span className="sep">///</span>
          <span>AUTOPLAY</span>
          <span className="sep">///</span>
          <span className="accent">HOVER TO PAUSE</span>
        </div>

        <div className="marquee-track">
          <div className="marquee-row">
            {[1, 2, 3, 4, 5, 6].map(n => {
              const base = `/landing-assets/frames/frame-0${n}`
              return (
                <div key={`a-${n}`} className={`marquee-frame tilt-${n}`}>
                  <picture>
                    <source srcSet={`${base}.webp`} type="image/webp" />
                    <img src={`${base}.jpg`} alt="" loading="lazy" width={1000} height={1792} />
                  </picture>
                  {n === 2 && <div className="frame-badge badge-new">● NEW</div>}
                  {n === 4 && <div className="frame-badge badge-trending">+2K</div>}
                  {n === 5 && <div className="frame-badge badge-hot">🔥 VIRAL</div>}
                </div>
              )
            })}
            {[1, 2, 3, 4, 5, 6].map(n => {
              const base = `/landing-assets/frames/frame-0${n}`
              return (
                <div key={`b-${n}`} className={`marquee-frame tilt-${n}`} aria-hidden="true">
                  <picture>
                    <source srcSet={`${base}.webp`} type="image/webp" />
                    <img src={`${base}.jpg`} alt="" loading="lazy" width={1000} height={1792} />
                  </picture>
                </div>
              )
            })}
          </div>
        </div>

        <div className="marquee-bottom">
          <span>9:16 · VERTICAL</span>
          <span className="sep">///</span>
          <span>HEBREW VOICEOVER</span>
          <span className="sep">///</span>
          <span>H.264 MP4</span>
          <span className="sep">///</span>
          <span className="accent">READY TO POST</span>
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
          {[
            { key: 'icecream', num: '01', label: '🍨 גלידה פופ' },
            { key: 'kipa', num: '02', label: '🧢 כיפה' },
            { key: 'teeth', num: '03', label: '🦷 אבקת הלבנה' },
          ].map(t => (
            <button
              key={t.key}
              className={`tab ${currentProduct === t.key ? 'active' : ''}`}
              onClick={() => switchProduct(t.key)}
            >
              <span className="tab-num">{t.num}</span>
              <span>{t.label}</span>
            </button>
          ))}
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
                  <picture>
                    <source srcSet={`${imageSrc}.webp`} type="image/webp" />
                    <img src={`${imageSrc}.jpg`} alt="" width={data.imageW} height={data.imageH} loading="lazy" />
                  </picture>
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
            <button className="btn btn-ghost plan-cta" onClick={() => onCheckout('trial')}>התחל ניסיון · ₪20</button>
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
              <li><span className="check">✓</span>3 אווטארים</li>
              <li><span className="check">✓</span>2 קולות עברית</li>
              <li><span className="check">✓</span>ייצוא 4K</li>
              <li><span className="check">✓</span>מצב &quot;סרטון עסק&quot;</li>
            </ul>
            <button className="btn btn-primary plan-cta" onClick={() => onCheckout('basic')}>שדרג לבייסיק</button>
            <div className="plan-note">ביטול בכל עת</div>
          </div>

          {/* PRO */}
          <div className="plan reveal delay-3">
            <div className="plan-icon">🔥</div>
            <div className="plan-label">PRO · פרו</div>
            <div className="plan-name">פרו</div>
            <div className="plan-price">499<span className="currency">₪</span></div>
            <div className="plan-period">לחודש</div>
            <ul className="plan-features">
              <li><span className="check">✓</span>8 סרטונים בחודש</li>
              <li><span className="check">✓</span>כל האווטארים (6+)</li>
              <li><span className="check">✓</span>כל הקולות (כולל פרימיום)</li>
              <li><span className="check">✓</span>ייצוא 4K · ללא לוגו</li>
              <li><span className="check">✓</span>עדיפות בתור</li>
              <li><span className="check">✓</span>תמיכה אישית ב-WhatsApp</li>
            </ul>
            <button className="btn btn-ghost plan-cta" onClick={() => onCheckout('pro')}>שדרג לפרו</button>
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
            <a href="#pricing" className="btn btn-primary btn-lg">
              נסה 3 ימים ב-₪20
              <svg viewBox="0 0 16 16" fill="none"><path d="M13 8l-6 5V3l6 5z" fill="currentColor" /></svg>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="brand">yotzr. <span style={{ color: 'var(--ink-3)' }}>© 2026</span></div>
        <div>MADE IN ISRAEL · <span style={{ color: 'var(--accent)' }}>●</span> HEBREW-NATIVE AI</div>
        <div>
          <a href="#" style={{ color: 'var(--ink-2)', marginInlineEnd: 20 }}>תנאי שימוש</a>
          <a href="#" style={{ color: 'var(--ink-2)' }}>פרטיות</a>
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
          padding: 10px 20px; border-radius: 4px;
          font-size: 14px; font-weight: 600;
          transition: all .2s;
          display: inline-flex; align-items: center; gap: 8px;
          font-family: var(--body);
        }
        .btn-ghost { color: var(--ink); border: 1px solid var(--line-2); }
        .btn-ghost:hover { border-color: var(--ink); background: var(--ink); color: var(--bg); }
        .btn-primary { background: var(--accent); color: #0A0908; font-weight: 700; }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 10px 30px -8px var(--accent); }
        .btn-lg { padding: 18px 30px; font-size: 15px; }
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
          position: relative; padding: 120px 40px 40px;
          min-height: auto; display: flex; flex-direction: column; overflow: hidden;
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
          display: flex; flex-direction: column;
          align-items: center; text-align: center;
          gap: 32px; flex: 1;
          margin-top: 80px;
          max-width: 1000px; margin-inline: auto;
          width: 100%;
        }
        .hero-content > * { margin-top: 0; }
        .eyebrow {
          font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .eyebrow .dot { color: var(--accent); }
        .display-h1 {
          font-family: var(--display); font-weight: 900; letter-spacing: -.04em;
          line-height: .92; color: var(--ink); font-size: clamp(70px, 10vw, 180px);
        }
        .display-h1 .accent { color: var(--accent); }
        .display-h1 .stroke { -webkit-text-stroke: 2px var(--ink); color: transparent; }
        .display-h1 .en {
          font-family: var(--mono); font-weight: 700; letter-spacing: .02em;
          text-transform: uppercase; font-size: .16em; display: inline-block;
          vertical-align: middle; color: var(--ink-3); margin-inline-start: 16px;
        }
        .hero-text {
          display: flex; flex-direction: column; align-items: center;
          width: 100%;
        }
        .hero-sub {
          font-size: 22px; font-weight: 400; color: var(--ink-2);
          max-width: 600px; line-height: 1.45; margin-top: 32px;
          text-align: center;
        }
        .hero-cta-row {
          display: flex; gap: 12px; margin-top: 40px;
          align-items: center; justify-content: center; flex-wrap: wrap;
        }
        .hero-cta-micro {
          font-family: var(--mono); font-size: 10px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--ink-3); margin-inline-start: 8px;
          margin-top: 12px; text-align: center;
        }
        .hero-cta-micro .check { color: var(--accent); margin-left: 4px; }
        .hero-footnote {
          font-family: var(--mono); font-size: 11px; letter-spacing: .15em;
          text-transform: uppercase; color: var(--ink-3); margin-top: 28px;
          text-align: center;
        }

        /* <picture> should honor parent avatar card dimensions. */
        .demo-avatar picture {
          display: block;
          width: 100%; height: 100%;
          position: absolute; inset: 0;
        }

        /* ============================================================
           HERO MARQUEE — full-width infinite horizontal scroller.
           ============================================================ */
        .hero-marquee {
          position: relative;
          padding: 40px 0 60px;
          overflow: hidden;
          background: linear-gradient(
            to bottom,
            transparent 0%,
            rgba(255, 0, 128, 0.03) 50%,
            transparent 100%
          );
          border-top: 1px solid var(--line);
          border-bottom: 1px solid var(--line);
        }
        .marquee-label,
        .marquee-bottom {
          display: flex; justify-content: center; align-items: center;
          gap: 16px; padding: 0 40px;
          font-family: var(--mono); font-size: 11px; letter-spacing: 0.22em;
          text-transform: uppercase; color: var(--ink-3); flex-wrap: wrap;
        }
        .marquee-label .sep,
        .marquee-bottom .sep { color: var(--ink-3); opacity: .4; }
        .marquee-label .accent,
        .marquee-bottom .accent { color: var(--accent); }
        .marquee-label .pulse {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--accent); box-shadow: 0 0 12px var(--accent-glow);
          animation: pulse-dot 2s ease-in-out infinite;
        }
        .marquee-label { margin-bottom: 30px; }
        .marquee-bottom { margin-top: 30px; }

        .marquee-track {
          position: relative;
          width: 100%;
          overflow: hidden;
          mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
        }
        .marquee-row {
          display: flex; gap: 20px; width: fit-content;
          animation: marquee-scroll 50s linear infinite;
          padding: 20px 0;
        }
        .marquee-row:hover { animation-play-state: paused; }
        @keyframes marquee-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }

        .marquee-frame {
          flex-shrink: 0;
          width: 220px; aspect-ratio: 9/16;
          border-radius: 6px; overflow: hidden;
          border: 1px solid var(--line-2);
          background: var(--bg-3);
          box-shadow:
            0 12px 30px -8px rgba(0,0,0,.6),
            0 4px 12px -4px rgba(0,0,0,.4);
          position: relative;
          transition:
            transform .3s cubic-bezier(.2,.8,.2,1),
            border-color .3s ease-out,
            box-shadow .3s ease-out;
          cursor: pointer;
        }
        .marquee-frame picture,
        .marquee-frame img {
          width: 100%; height: 100%;
          object-fit: cover; display: block;
        }
        .marquee-frame.tilt-1 { transform: rotate(-1.5deg); }
        .marquee-frame.tilt-2 { transform: rotate(1deg); }
        .marquee-frame.tilt-3 { transform: rotate(-0.5deg); }
        .marquee-frame.tilt-4 { transform: rotate(2deg); }
        .marquee-frame.tilt-5 { transform: rotate(-2deg); }
        .marquee-frame.tilt-6 { transform: rotate(1.5deg); }
        .marquee-frame:hover {
          transform: rotate(0deg) translateY(-8px) scale(1.08);
          border-color: var(--accent);
          box-shadow:
            0 20px 50px -10px rgba(255,0,128,.4),
            0 10px 20px -6px rgba(0,0,0,.5);
          z-index: 10;
        }

        .frame-badge {
          position: absolute; top: 12px; right: 12px;
          padding: 5px 10px; border-radius: 3px;
          font-family: var(--mono); font-size: 10px; font-weight: 700;
          letter-spacing: 0.12em; text-transform: uppercase;
          backdrop-filter: blur(10px); z-index: 2;
        }
        .badge-new { background: rgba(255,0,128,.9); color: var(--bg); }
        .badge-trending { background: rgba(30,144,255,.9); color: var(--bg); }
        .badge-hot { background: rgba(255,165,0,.95); color: var(--bg); }
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
        .editorial-frame .inner {
          position: absolute; inset: 12px; overflow: hidden;
          border-radius: 4px; border: 1px solid var(--line-2); background: var(--bg-2);
        }
        .editorial-frame video { width: 100%; height: 100%; object-fit: cover; display: block; }
        .editorial-frame .rec-corner {
          position: absolute; top: 22px; right: 22px;
          font-family: var(--mono); font-size: 10px; letter-spacing: .12em;
          color: var(--ink); background: rgba(0,0,0,.5);
          padding: 4px 9px; border-radius: 2px;
          display: flex; align-items: center; gap: 6px;
          backdrop-filter: blur(6px);
        }
        .editorial-frame .rec-corner .rec {
          width: 6px; height: 6px; border-radius: 50%;
          background: #ff3b3b; animation: rec-pulse 1.5s infinite;
        }
        @keyframes rec-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }

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

        .tabs { display: flex; gap: 12px; justify-content: center; margin-bottom: 60px; flex-wrap: wrap; }
        .tab {
          padding: 14px 28px; border: 1px solid var(--line-2);
          background: var(--bg-2); color: var(--ink-2);
          border-radius: 4px; font-family: var(--display);
          font-weight: 600; font-size: 15px; transition: all .25s;
          display: flex; align-items: center; gap: 10px; position: relative;
        }
        .tab .tab-num {
          font-family: var(--mono); font-size: 10px; color: var(--ink-3);
          font-weight: 500; letter-spacing: .12em;
        }
        .tab:hover:not(.active) { border-color: var(--ink-2); color: var(--ink); }
        .tab.active { background: var(--ink); color: var(--bg); border-color: var(--ink); }
        .tab.active .tab-num { color: var(--accent); }

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
        .final-cta-title .accent { color: var(--accent); }
        .final-cta-sub { font-size: 22px; color: var(--ink-2); margin-bottom: 40px; }

        .footer {
          padding: 40px; border-top: 1px solid var(--line);
          display: flex; justify-content: space-between; align-items: center;
          flex-wrap: wrap; gap: 20px;
          font-family: var(--mono); font-size: 11px; letter-spacing: .16em;
          text-transform: uppercase; color: var(--ink-3);
        }
        .footer .brand { font-family: var(--display); letter-spacing: -.02em; font-size: 14px; text-transform: none; }

        @media (max-width: 900px) {
          .nav { padding: 16px 20px; }
          .nav-links { display: none; }
          .hero { padding: 100px 20px 30px; }
          .hero-content { margin-top: 60px; }
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
        @media (max-width: 768px) {
          .marquee-frame { width: 160px; }
          .marquee-row { gap: 14px; animation-duration: 40s; }
          .marquee-label, .marquee-bottom {
            font-size: 9px; padding: 0 20px; gap: 10px;
          }
          .hero-marquee { padding: 30px 0 40px; }
        }
        @media (max-width: 480px) {
          .marquee-frame { width: 130px; }
          .marquee-label .sep:nth-of-type(n+2),
          .marquee-bottom .sep:nth-of-type(n+2) { display: none; }
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
      `}</style>
    </>
  )
}
