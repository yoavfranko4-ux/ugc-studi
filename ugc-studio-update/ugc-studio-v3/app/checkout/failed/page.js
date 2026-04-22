'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

const PLAN_NAMES = {
  trial: 'ניסיון 3 ימים',
  basic: 'מנוי בייסיק',
  pro: 'מנוי פרו',
}

function FailedContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const plan = searchParams.get('plan')
  const planName = PLAN_NAMES[plan] || ''

  return (
    <main className="checkout-shell" dir="rtl">
      <div className="card">
        <div className="emoji">❌</div>
        <h1>התשלום נכשל</h1>
        <p className="lede">לא הצלחנו לעבד את התשלום שלך.</p>
        {planName && <p className="plan">{planName}</p>}
        <p className="retry">תוכל לנסות שוב</p>
        <div className="actions">
          <button
            type="button"
            className="cta"
            onClick={() => router.push('/#pricing')}
          >
            נסה שוב
          </button>
          <a href="mailto:support@yotzr.com" className="cta cta-ghost">
            צור קשר
          </a>
        </div>
      </div>
      <style jsx global>{`
        html, body { background: #0A0908; color: #F5F5F4; }
        body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
        .checkout-shell {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 40px 20px;
        }
        .card {
          max-width: 520px;
          width: 100%;
          text-align: center;
          background: #111010;
          border: 1px solid rgba(245,245,244,.1);
          border-radius: 16px;
          padding: 56px 32px;
        }
        .emoji { font-size: 64px; line-height: 1; margin-bottom: 16px; }
        .card h1 {
          font-size: 32px;
          font-weight: 900;
          letter-spacing: -.02em;
          margin: 0 0 12px;
          color: #F5F5F4;
        }
        .lede { font-size: 17px; color: rgba(245,245,244,.72); margin: 0 0 8px; }
        .retry { font-size: 15px; color: rgba(245,245,244,.5); margin: 12px 0 32px; }
        .plan {
          display: inline-block;
          margin: 12px 0 8px;
          padding: 8px 16px;
          border-radius: 999px;
          background: rgba(245, 245, 244, .06);
          color: rgba(245,245,244,.72);
          font-weight: 700;
        }
        .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        .cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          border-radius: 10px;
          padding: 14px 24px;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          border: none;
          text-decoration: none;
          background: #FF0080;
          color: #fff;
          box-shadow: 0 0 20px rgba(255, 0, 128, .3);
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .cta:hover { transform: translateY(-1px); }
        .cta-ghost {
          background: transparent;
          color: #F5F5F4;
          border: 1px solid rgba(245,245,244,.2);
          box-shadow: none;
        }
      `}</style>
    </main>
  )
}

export default function CheckoutFailedPage() {
  return (
    <Suspense fallback={null}>
      <FailedContent />
    </Suspense>
  )
}
