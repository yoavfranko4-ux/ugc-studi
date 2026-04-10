import { Heebo } from 'next/font/google'
import './globals.css'

const heebo = Heebo({ subsets: ['hebrew', 'latin'], weight: ['300','400','500','700','900'] })

export const metadata = {
  title: 'UGC Studio AI',
  description: 'צור סרטוני UGC מקצועיים עם AI',
}

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body className={heebo.className}>{children}</body>
    </html>
  )
}
