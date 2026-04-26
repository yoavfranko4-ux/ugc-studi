export const metadata = {
  title: 'מידע משפטי · Yotzr',
  description: 'יצירת קשר, תקנון שימוש, מדיניות פרטיות ומדיניות החזרה של Yotzr.',
};

const ACCENT = '#d946ef';
const BG = '#000000';
const INK = '#ffffff';
const INK_2 = '#d4d4d4';
const INK_3 = '#a3a3a3';
const LINE = 'rgba(255,255,255,0.10)';

const pageStyle = {
  background: BG,
  color: INK_2,
  minHeight: '100vh',
  fontFamily: '"Assistant", "Heebo", system-ui, sans-serif',
  fontSize: 16,
  lineHeight: 1.8,
  padding: '40px 20px 80px',
};

const innerStyle = {
  maxWidth: 800,
  margin: '0 auto',
};

const navStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 12,
  justifyContent: 'center',
  padding: '20px 0 40px',
  borderBottom: `1px solid ${LINE}`,
  marginBottom: 60,
};

const navLinkStyle = {
  color: ACCENT,
  textDecoration: 'none',
  border: `1px solid ${ACCENT}`,
  borderRadius: 4,
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 600,
  transition: 'all 0.2s',
};

const sectionStyle = {
  paddingTop: 40,
  paddingBottom: 40,
  borderBottom: `1px solid ${LINE}`,
  scrollMarginTop: 80,
};

const h1Style = {
  color: ACCENT,
  fontSize: 42,
  fontWeight: 900,
  letterSpacing: '-0.02em',
  margin: '0 0 8px',
  fontFamily: '"Heebo", "Assistant", system-ui, sans-serif',
};

const h2Style = {
  color: INK,
  fontSize: 22,
  fontWeight: 700,
  margin: '32px 0 12px',
  fontFamily: '"Heebo", "Assistant", system-ui, sans-serif',
};

const pStyle = {
  color: INK_2,
  margin: '8px 0',
};

const ulStyle = {
  color: INK_2,
  margin: '8px 0',
  paddingInlineStart: 24,
};

const liStyle = {
  margin: '6px 0',
};

const linkStyle = {
  color: ACCENT,
  textDecoration: 'underline',
};

const dlStyle = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  gap: '12px 16px',
  margin: '16px 0',
};

const dtStyle = {
  color: INK_3,
  fontWeight: 600,
};

const ddStyle = {
  color: INK,
  margin: 0,
};

const footerStyle = {
  textAlign: 'center',
  color: INK_3,
  fontSize: 13,
  paddingTop: 40,
  marginTop: 40,
  borderTop: `1px solid ${LINE}`,
};

export default function LegalPage() {
  return (
    <div dir="rtl" lang="he" style={pageStyle}>
      <div style={innerStyle}>
        <nav style={navStyle} aria-label="ניווט בעמוד">
          <a href="#contact" style={navLinkStyle}>צור קשר</a>
          <a href="#terms" style={navLinkStyle}>תקנון</a>
          <a href="#privacy" style={navLinkStyle}>פרטיות</a>
          <a href="#refund" style={navLinkStyle}>החזרה</a>
        </nav>

        {/* ============ צור קשר ============ */}
        <section id="contact" style={sectionStyle}>
          <h1 style={h1Style}>צור קשר</h1>
          <p style={pStyle}>
            נשמח לעמוד לרשותך בכל שאלה, פנייה או שיתוף פעולה. צוות Yotzr זמין באמצעי
            ההתקשרות הבאים:
          </p>

          <dl style={dlStyle}>
            <dt style={dtStyle}>שם העסק</dt>
            <dd style={ddStyle}>Yotzr</dd>

            <dt style={dtStyle}>אתר</dt>
            <dd style={ddStyle}>
              <a href="http://yotzr.com" style={linkStyle}>yotzr.com</a>
            </dd>

            <dt style={dtStyle}>שירות לקוחות</dt>
            <dd style={ddStyle}>
              <a href="mailto:support@yotzr.com" style={linkStyle}>support@yotzr.com</a>
            </dd>

            <dt style={dtStyle}>עסקים ושיתופי פעולה</dt>
            <dd style={ddStyle}>
              <a href="mailto:business@yotzr.com" style={linkStyle}>business@yotzr.com</a>
            </dd>

            <dt style={dtStyle}>טלפון</dt>
            <dd style={ddStyle}>053-8322318</dd>

            <dt style={dtStyle}>כתובת</dt>
            <dd style={ddStyle}>ברוש 3, נתניה, ישראל</dd>

            <dt style={dtStyle}>שעות פעילות</dt>
            <dd style={ddStyle}>ימים א'–ה' · 09:00–18:00</dd>
          </dl>
        </section>

        {/* ============ תקנון שירות ============ */}
        <section id="terms" style={sectionStyle}>
          <h1 style={h1Style}>תקנון שימוש בשירות</h1>
          <p style={{ ...pStyle, color: INK_3, fontSize: 14 }}>
            תאריך עדכון אחרון: 26 באפריל 2026
          </p>

          <h2 style={h2Style}>1. כללי</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>
              Yotzr (״השירות״) היא פלטפורמה ליצירת סרטוני שיווק בעזרת בינה מלאכותית.
            </li>
            <li style={liStyle}>השימוש בשירות כפוף לתנאי שימוש אלה.</li>
            <li style={liStyle}>תאריך עדכון אחרון: 26 באפריל 2026.</li>
          </ul>

          <h2 style={h2Style}>2. רישום וחשבון</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>על מנת להשתמש בשירות, יש להירשם וליצור חשבון.</li>
            <li style={liStyle}>המשתמש מתחייב לספק פרטים נכונים ומדויקים.</li>
            <li style={liStyle}>המשתמש אחראי לשמירה על סודיות פרטי החשבון.</li>
          </ul>

          <h2 style={h2Style}>3. השימוש בשירות</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>השירות מאפשר יצירת סרטוני שיווק באורך של עד 30 שניות.</li>
            <li style={liStyle}>כל סרטון מורכב מ-4 סצנות עם קריינות בעברית.</li>
            <li style={liStyle}>איכות הסרטון תלויה בקלט שהמשתמש מספק (תמונת מוצר, תיאור).</li>
          </ul>

          <h2 style={h2Style}>4. תוכן המשתמש</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>המשתמש מצהיר שיש לו זכויות מלאות על תמונות המוצרים שמעלה.</li>
            <li style={liStyle}>המשתמש לא יעלה תוכן פוגעני, לא חוקי, או המפר זכויות יוצרים.</li>
            <li style={liStyle}>Yotzr רשאית להסיר תוכן שמפר את התקנון ללא הודעה מראש.</li>
          </ul>

          <h2 style={h2Style}>5. תשלומים</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>השירות בתשלום, על פי החבילות המופיעות באתר.</li>
            <li style={liStyle}>התשלומים מעובדים באמצעות PayPlus, ספק תשלומים מוסמך.</li>
            <li style={liStyle}>המחירים כוללים מע״מ אלא אם צוין אחרת.</li>
          </ul>

          <h2 style={h2Style}>6. שימוש לרעה</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>אסור להשתמש בשירות לתוכן הונאה, פורנוגרפיה, או הסתה.</li>
            <li style={liStyle}>אסור לנסות לעקוף מגבלות טכניות של השירות.</li>
            <li style={liStyle}>הפרת תנאים אלה תוביל להפסקת השירות וייתכן לתביעה משפטית.</li>
          </ul>

          <h2 style={h2Style}>7. הגבלת אחריות</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>
              השירות ניתן ״AS IS״. איננו אחראים לתוצאות עסקיות מהשימוש בסרטונים.
            </li>
            <li style={liStyle}>
              האחריות הכספית שלנו מוגבלת לסכום ששולם עבור השירות.
            </li>
          </ul>

          <h2 style={h2Style}>8. שינויים בתקנון</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>Yotzr רשאית לעדכן תקנון זה מעת לעת.</li>
            <li style={liStyle}>שינויים יפורסמו באתר ויחולו 14 ימים לאחר הפרסום.</li>
          </ul>

          <h2 style={h2Style}>9. דין וסמכות שיפוט</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>על תקנון זה יחולו דיני מדינת ישראל.</li>
            <li style={liStyle}>סמכות השיפוט הבלעדית מוקנית לבתי המשפט בתל אביב.</li>
          </ul>
        </section>

        {/* ============ מדיניות פרטיות ============ */}
        <section id="privacy" style={sectionStyle}>
          <h1 style={h1Style}>מדיניות פרטיות</h1>
          <p style={{ ...pStyle, color: INK_3, fontSize: 14 }}>
            תאריך עדכון אחרון: 26 באפריל 2026
          </p>

          <h2 style={h2Style}>1. איסוף מידע</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>אנו אוספים מידע שאתה מספק במהלך הרישום: שם, מייל, טלפון.</li>
            <li style={liStyle}>אנו אוספים תמונות מוצרים שאתה מעלה ליצירת סרטונים.</li>
            <li style={liStyle}>אנו אוספים מידע טכני: כתובת IP, סוג דפדפן, זמני שימוש.</li>
          </ul>

          <h2 style={h2Style}>2. שימוש במידע</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>לספק את השירות (יצירת סרטונים).</li>
            <li style={liStyle}>לשלוח עדכונים והודעות שירות חיוניות.</li>
            <li style={liStyle}>לשפר את השירות ולפתח תכונות חדשות.</li>
            <li style={liStyle}>לעמוד בדרישות חוקיות.</li>
          </ul>

          <h2 style={h2Style}>3. שיתוף מידע עם צד שלישי</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>איננו מוכרים את המידע שלך.</li>
            <li style={liStyle}>
              אנו עובדים עם ספקי שירות מוסמכים:
              <ul style={{ ...ulStyle, marginTop: 6 }}>
                <li style={liStyle}>Anthropic – יצירת תוכן.</li>
                <li style={liStyle}>
                  <a href="http://fal.ai" style={linkStyle}>fal.ai</a> – יצירת סרטונים.
                </li>
                <li style={liStyle}>ElevenLabs – קריינות.</li>
                <li style={liStyle}>Supabase – אחסון נתונים.</li>
                <li style={liStyle}>PayPlus – עיבוד תשלומים.</li>
              </ul>
            </li>
            <li style={liStyle}>הספקים מתחייבים לשמור על פרטיות המידע.</li>
          </ul>

          <h2 style={h2Style}>4. עוגיות (Cookies)</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>האתר משתמש בעוגיות חיוניות לתפקוד הבסיסי.</li>
            <li style={liStyle}>
              אינך יכול לבטל עוגיות חיוניות, אך תוכל למחוק אותן מהדפדפן שלך.
            </li>
          </ul>

          <h2 style={h2Style}>5. אבטחת מידע</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>המידע מאוחסן בשרתים מאובטחים עם הצפנה.</li>
            <li style={liStyle}>
              אנו נוקטים אמצעי הגנה סבירים, אך לא ניתן להבטיח אבטחה מוחלטת.
            </li>
          </ul>

          <h2 style={h2Style}>6. זכויות המשתמש</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>יש לך זכות לעיין במידע שלך, לתקן אותו, או למחוק אותו.</li>
            <li style={liStyle}>
              לבקשה שלח מייל ל־
              <a href="mailto:support@yotzr.com" style={linkStyle}>support@yotzr.com</a>.
            </li>
          </ul>

          <h2 style={h2Style}>7. שמירת מידע</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>נשמור את המידע כל עוד יש לך חשבון פעיל.</li>
            <li style={liStyle}>לאחר ביטול חשבון – נמחק את המידע תוך 90 ימים.</li>
          </ul>

          <h2 style={h2Style}>8. שינויים במדיניות</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>אנו עשויים לעדכן מדיניות זו מעת לעת.</li>
            <li style={liStyle}>שינויים מהותיים יישלחו במייל.</li>
          </ul>
        </section>

        {/* ============ מדיניות החזרה ============ */}
        <section id="refund" style={sectionStyle}>
          <h1 style={h1Style}>מדיניות ביטול והחזר כספי</h1>
          <p style={{ ...pStyle, color: INK_3, fontSize: 14 }}>
            תאריך עדכון אחרון: 26 באפריל 2026
          </p>

          <h2 style={h2Style}>1. זכות ביטול עסקה (לפי חוק הגנת הצרכן)</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>
              לקוח רשאי לבטל עסקה תוך 14 ימים מיום ביצועה, בכפוף לתנאים הבאים:
            </li>
            <li style={liStyle}>לפני שהסרטון נוצר – ביטול מלא והחזר כספי 100%.</li>
            <li style={liStyle}>
              לאחר שהסרטון נוצר – לא ניתן לבטל, מכיוון שזהו ״מוצר דיגיטלי שיוצר במיוחד
              עבור הלקוח״ (סעיף 14ג(ד)(2) לחוק הגנת הצרכן).
            </li>
          </ul>

          <h2 style={h2Style}>2. החזר במקרה של תקלה טכנית</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>
              אם הסרטון לא נוצר עקב תקלה טכנית במערכת, יינתן החזר כספי מלא או יצירה
              מחדש לפי בחירת הלקוח.
            </li>
            <li style={liStyle}>יש לפנות לתמיכה תוך 7 ימים מיום הקנייה.</li>
          </ul>

          <h2 style={h2Style}>3. החזר במקרה של איכות לקויה</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>
              אם הסרטון יוצר אך אינו עומד בסטנדרט הסביר (לדוגמה: קריינות לא ברורה,
              סצנות שבורות), נציע יצירה מחדש ללא עלות.
            </li>
            <li style={liStyle}>
              אם המשתמש עדיין לא מרוצה לאחר הפעם השנייה, יינתן החזר כספי של 50%
              מסכום הקנייה.
            </li>
          </ul>

          <h2 style={h2Style}>4. תהליך הבקשה</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>
              שלח מייל ל־
              <a href="mailto:support@yotzr.com" style={linkStyle}>support@yotzr.com</a>.
            </li>
            <li style={liStyle}>כותרת: ״בקשת החזר – [מספר הזמנה]״.</li>
            <li style={liStyle}>גוף ההודעה: סיבת הבקשה + פרטי קשר.</li>
            <li style={liStyle}>נחזיר תשובה תוך 3 ימי עסקים.</li>
            <li style={liStyle}>החזר כספי שאושר יבוצע תוך 14 ימים לחשבון/כרטיס המקורי.</li>
          </ul>

          <h2 style={h2Style}>5. חריגים</h2>
          <ul style={ulStyle}>
            <li style={liStyle}>לא יינתן החזר על שימוש לרעה בשירות.</li>
            <li style={liStyle}>
              לא יינתן החזר אם הלקוח כבר השתמש בסרטונים בקמפיין שלו.
            </li>
          </ul>
        </section>

        <footer style={footerStyle}>
          © 2026 Yotzr. כל הזכויות שמורות. ברוש 3, נתניה.
        </footer>
      </div>
    </div>
  );
}
