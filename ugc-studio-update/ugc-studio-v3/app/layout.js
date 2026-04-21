import './styles/theme.css';

export const metadata = {
  title: 'Yotzr · הפרסומת הבאה שלך. 3 דקות.',
  description: 'סרטוני UGC מקצועיים בעברית — בלי מצלמה, בלי שחקנים, בלי סטודיו. בחר אווטאר, העלה מוצר, קבל סרטון מוכן לפרסום.',
};

const HERO_IMAGES = [
  '/landing-assets/product-icecream.webp',
  '/landing-assets/product-kipa.webp',
  '/landing-assets/product-teeth.webp',
  '/landing-assets/avatar-noa.webp',
  '/landing-assets/avatar-daniel.webp',
  '/landing-assets/avatar-maya.webp',
  '/landing-assets/scene3-icecream.webp',
  '/landing-assets/scene3-kipa.webp',
  '/landing-assets/scene3-teeth.webp',
];

export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700;800;900&family=Assistant:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        {HERO_IMAGES.map(href => (
          <link key={href} rel="preload" as="image" href={href} type="image/webp" />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
