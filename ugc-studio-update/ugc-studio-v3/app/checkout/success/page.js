'use client'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'

const PLAN_NAMES = {
  trial: 'ניסיון 3 ימים',
  basic: 'מנוי בייסיק',
  pro: 'מנוי פרו',
}

function SuccessContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const plan = searchParams.get('plan')
  const planName = PLAN_NAMES[plan] || ''

  return (
    <main className="checkout-shell" dir="rtl">
      <div className="card">
        <div className="emoji">🎉</div>
        <h1>ברוכים הבאים ל-Yotzr!</h1>
        <p className="lede">התשלום הושלם בהצלחה.</p>
        {planName && <p className="plan">{planName}</p>}
        <button
          type="button"
          className="cta"
          onClick={() => router.push('/studio')}
        >
          התחל ליצור
        </button>
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
          box-shadow: 0 0 60px rgba(255, 0, 128, .08);
        }
        .emoji { font-size: 64px; line-height: 1; margin-bottom: 16px; }
        .card h1 {
          font-size: 34px;
          font-weight: 900;
          letter-spacing: -.02em;
          margin: 0 0 12px;
          color: #F5F5F4;
        }
        .lede { font-size: 18px; color: rgba(245,245,244,.72); margin: 0 0 8px; }
        .plan {
          display: inline-block;
          margin: 12px 0 32px;
          padding: 8px 16px;
          border-radius: 999px;
          background: rgba(255, 0, 128, .12);
          color: #FF0080;
          font-weight: 700;
        }
        .cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #FF0080;
          color: #fff;
          border: none;
          border-radius: 10px;
          padding: 14px 28px;
          font-size: 17px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 0 24px rgba(255, 0, 128, .35);
          transition: transform .15s ease, box-shadow .15s ease;
        }
        .cta:hover { transform: translateY(-1px); box-shadow: 0 0 32px rgba(255, 0, 128, .55); }
      `}</style>
    </main>
  )
}

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={null}>
      <SuccessContent />
    </Suspense>
  )
}
