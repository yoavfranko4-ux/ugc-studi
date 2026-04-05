export const metadata = { title: 'UGC Studio', description: 'AI UGC Video Generator' };
export default function RootLayout({ children }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0, padding: 0, background: '#0a0a0f' }}>{children}</body>
    </html>
  );
}
