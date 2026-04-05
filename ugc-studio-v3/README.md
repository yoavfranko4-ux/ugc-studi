# UGC Studio AI 🎬

אפליקציה ליצירת סרטוני UGC מקצועיים עם AI.

## הפלו
1. בחר דמות (אווטאר)
2. הכנס שם מוצר + תיאור + איך משתמשים
3. Claude כותב 4 פרומפטים + קריינות עברית (מהשרת - לא CORS!)
4. Nano Banana יוצר 4 start frames עם אותה דמות
5. ElevenLabs יוצר קריינות V3
6. Kling יוצר 4 סרטוני 5 שניות
7. עמוד עריכה עם כל הסצנות + קריינות + כתוביות

## Deploy ל-Vercel (חינמי)

### שלב 1 - GitHub
```bash
git init
git add .
git commit -m "UGC Studio"
git remote add origin YOUR_GITHUB_REPO
git push -u origin main
```

### שלב 2 - Vercel
1. כנס ל-vercel.com
2. Import your GitHub repo
3. Add environment variable:
   - `ANTHROPIC_API_KEY` = המפתח שלך מ-console.anthropic.com
4. Deploy!

### שלב 3 - שימוש
- פתח את ה-URL שVercel נותן לך
- הכנס fal.ai key + ElevenLabs key בממשק
- התחל ליצור סרטונים!

## Tech Stack
- **Next.js 14** - Frontend + API Routes
- **Claude** (Anthropic) - כתיבת סקריפטים ופרומפטים
- **Nano Banana 2** (fal.ai) - יצירת start frames
- **Kling v1.6** (fal.ai) - יצירת סרטונים
- **ElevenLabs V3** - קריינות עברית

## API Keys הנדרשים
| שירות | איפה לקחת | עלות |
|-------|-----------|------|
| fal.ai | fal.ai/dashboard | Pay per use ~$0.50/סרטון |
| ElevenLabs | elevenlabs.io | 10K chars/חודש חינם |
| Anthropic | console.anthropic.com | הוסף ל-.env.local |
