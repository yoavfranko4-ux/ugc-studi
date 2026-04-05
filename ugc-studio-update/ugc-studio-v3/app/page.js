'use client';
import { useState, useRef, useEffect } from 'react';

const AVATARS = [
  { id: 1, url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=600&fit=crop&crop=face', name: 'Sophie' },
  { id: 2, url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=600&fit=crop&crop=face', name: 'Maya' },
  { id: 3, url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=600&fit=crop&crop=face', name: 'Ella' },
  { id: 4, url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=600&fit=crop&crop=face', name: 'Noa' },
  { id: 5, url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=600&fit=crop&crop=face', name: 'Dana' },
  { id: 6, url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop&crop=face', name: 'Adam' },
];

export default function Home() {
  const [screen, setScreen] = useState('form'); // form | loading | editor
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [customAvatar, setCustomAvatar] = useState(null);
  const [productImage, setProductImage] = useState(null);
  const [productName, setProductName] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [applicationArea, setApplicationArea] = useState('');
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [activeScene, setActiveScene] = useState(0);
  const audioRef = useRef(null);
  const logsEndRef = useRef(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const addLog = (msg, type = 'info') => {
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString('he-IL') }]);
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCustomAvatar(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleProductUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setProductImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  const runAgent = async () => {
    if (!productName.trim()) return alert('נא להכניס שם מוצר');
    const avatarUrl = customAvatar || selectedAvatar?.url || null;
    if (!avatarUrl) return alert('נא לבחור או להעלות אווטאר');

    setScreen('loading');
    setLogs([]);
    setProgress(0);
    setResult(null);
    addLog('🚀 מתחיל Agent...', 'start');

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
          productDesc,
          applicationArea,
          avatarUrl,
          productImageUrl: productImage || null
        })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.message) addLog(data.message, data.step?.includes('fail') ? 'error' : data.step === 'done' ? 'success' : 'info');

            if (data.step === 'done') {
              finalResult = data.result;
            }
          } catch {}
        }
      }

      if (finalResult) {
        setResult(finalResult);
        setScreen('editor');
      } else {
        addLog('❌ לא הצליח לקבל תוצאות', 'error');
      }
    } catch (e) {
      addLog(`❌ שגיאה: ${e.message}`, 'error');
    }
  };

  if (screen === 'form') return <FormScreen
    selectedAvatar={selectedAvatar} setSelectedAvatar={setSelectedAvatar}
    customAvatar={customAvatar} handleAvatarUpload={handleAvatarUpload}
    productImage={productImage} handleProductUpload={handleProductUpload}
    productName={productName} setProductName={setProductName}
    productDesc={productDesc} setProductDesc={setProductDesc}
    applicationArea={applicationArea} setApplicationArea={setApplicationArea}
    runAgent={runAgent}
  />;

  if (screen === 'loading') return <LoadingScreen logs={logs} progress={progress} />;

  if (screen === 'editor') return <EditorScreen
    result={result} activeScene={activeScene} setActiveScene={setActiveScene}
    audioRef={audioRef} onNew={() => setScreen('form')}
  />;
}

function FormScreen({ selectedAvatar, setSelectedAvatar, customAvatar, handleAvatarUpload, productImage, handleProductUpload, productName, setProductName, productDesc, setProductDesc, applicationArea, setApplicationArea, runAgent }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui', direction: 'rtl' }}>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, background: 'linear-gradient(135deg, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>🎬 UGC Studio</h1>
          <p style={{ color: '#888', marginTop: 8 }}>צור סרטוני UGC ויראליים עם AI</p>
        </div>

        {/* Avatar Selection */}
        <Section title="👤 בחר אווטאר">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10, marginBottom: 16 }}>
            {AVATARS.map(a => (
              <div key={a.id} onClick={() => setSelectedAvatar(a)} style={{
                cursor: 'pointer', borderRadius: 12, overflow: 'hidden',
                border: selectedAvatar?.id === a.id ? '3px solid #a855f7' : '3px solid transparent',
                transition: 'all 0.2s'
              }}>
                <img src={a.url} alt={a.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 16px', background: '#1a1a2e', borderRadius: 10, border: customAvatar ? '2px solid #a855f7' : '2px dashed #333' }}>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            {customAvatar ? <img src={customAvatar} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} /> : <span style={{ fontSize: 24 }}>📷</span>}
            <span style={{ color: '#aaa' }}>{customAvatar ? '✅ אווטאר אישי הועלה' : 'העלה אווטאר אישי'}</span>
          </label>
        </Section>

        {/* Product Image */}
        <Section title="📦 תמונת מוצר">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 16px', background: '#1a1a2e', borderRadius: 10, border: productImage ? '2px solid #a855f7' : '2px dashed #333' }}>
            <input type="file" accept="image/*" onChange={handleProductUpload} style={{ display: 'none' }} />
            {productImage ? <img src={productImage} style={{ width: 48, height: 48, borderRadius: 8, objectFit: 'cover' }} /> : <span style={{ fontSize: 24 }}>🛍️</span>}
            <span style={{ color: '#aaa' }}>{productImage ? '✅ תמונת מוצר הועלתה' : 'העלה תמונת מוצר'}</span>
          </label>
        </Section>

        {/* Product Info */}
        <Section title="✍️ פרטי המוצר">
          <Input label="שם המוצר *" value={productName} onChange={e => setProductName(e.target.value)} placeholder="מדבקות הלבנת שיניים FRAKO" />
          <Input label="מה המוצר פותר" value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder="מלבין שיניים תוך 7 ימים, ללא רגישות" />
          <Input label="איך משתמשים" value={applicationArea} onChange={e => setApplicationArea(e.target.value)} placeholder="מניחים על השיניים 30 דקות, מסירים ושוטפים" />
        </Section>

        <button onClick={runAgent} style={{
          width: '100%', padding: '18px', fontSize: 18, fontWeight: 700,
          background: 'linear-gradient(135deg, #a855f7, #ec4899)', color: '#fff',
          border: 'none', borderRadius: 14, cursor: 'pointer', marginTop: 20
        }}>
          🎬 צור 4 סצנות UGC עכשיו
        </button>
      </div>
    </div>
  );
}

function LoadingScreen({ logs, progress }) {
  const logsEndRef = useRef(null);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui', direction: 'rtl', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <h2 style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>🤖 Agent רץ...</h2>
      <p style={{ color: '#888', marginBottom: 30 }}>זה לוקח כמה דקות — Kling צריך זמן</p>

      {/* Progress Bar */}
      <div style={{ width: '100%', maxWidth: 600, marginBottom: 30 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#aaa', fontSize: 14 }}>התקדמות</span>
          <span style={{ color: '#a855f7', fontWeight: 700, fontSize: 18 }}>{progress}%</span>
        </div>
        <div style={{ height: 12, background: '#1a1a2e', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: 'linear-gradient(90deg, #a855f7, #ec4899)',
            borderRadius: 6, transition: 'width 0.5s ease'
          }} />
        </div>

        {/* Stage indicators */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11, color: '#555' }}>
          {[
            { label: '📤 העלאה', at: 5 },
            { label: '✍️ סקריפט', at: 15 },
            { label: '🎙️ קול', at: 22 },
            { label: '🎨 פריים 1', at: 30 },
            { label: '🎨 פריים 2', at: 43 },
            { label: '🎨 פריים 3', at: 56 },
            { label: '🎨 פריים 4', at: 69 },
            { label: '🎬 סרטון 1', at: 75 },
            { label: '🎬 סרטון 2', at: 83 },
            { label: '🎬 סרטון 3', at: 91 },
            { label: '🎬 סרטון 4', at: 98 },
          ].map(s => (
            <span key={s.label} style={{ color: progress >= s.at ? '#a855f7' : '#333', transition: 'color 0.3s' }}>
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {/* Logs */}
      <div style={{
        width: '100%', maxWidth: 600, height: 350,
        background: '#0d0d1a', border: '1px solid #1a1a2e',
        borderRadius: 12, overflow: 'auto', padding: 16
      }}>
        {logs.map((log, i) => (
          <div key={i} style={{
            padding: '6px 0', borderBottom: '1px solid #111',
            color: log.type === 'error' ? '#f87171' : log.type === 'success' ? '#34d399' : log.type === 'start' ? '#a855f7' : '#d1d5db',
            fontSize: 13, display: 'flex', gap: 10
          }}>
            <span style={{ color: '#444', minWidth: 70 }}>{log.time}</span>
            <span>{log.msg}</span>
          </div>
        ))}
        <div ref={logsEndRef} />
      </div>
    </div>
  );
}

function EditorScreen({ result, activeScene, setActiveScene, audioRef, onNew }) {
  const scenes = result?.scenes || [];
  const videoUrls = result?.videoUrls || [];
  const frameUrls = result?.frameUrls || [];
  const audioBase64 = result?.audioBase64;

  const audioSrc = audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null;

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui', direction: 'rtl' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '30px 20px' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
            🎉 הסרטון שלך מוכן!
          </h1>
          <button onClick={onNew} style={{ padding: '10px 20px', background: '#1a1a2e', border: '1px solid #333', borderRadius: 10, color: '#fff', cursor: 'pointer' }}>
            ← מודעה חדשה
          </button>
        </div>

        {/* Scene thumbnails */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {scenes.map((scene, i) => (
            <div key={i} onClick={() => setActiveScene(i)} style={{
              cursor: 'pointer', borderRadius: 12, overflow: 'hidden',
              border: activeScene === i ? '3px solid #a855f7' : '3px solid transparent',
              position: 'relative', background: '#111'
            }}>
              {frameUrls[i] ? (
                <img src={frameUrls[i]} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>❌</div>
              )}
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.8))', padding: '20px 8px 8px', fontSize: 11, textAlign: 'center' }}>
                <div style={{ color: '#a855f7', fontWeight: 700 }}>{scene.type}</div>
                <div style={{ color: '#ccc', marginTop: 2 }}>{scene.subtitle}</div>
              </div>
              {videoUrls[i] && <div style={{ position: 'absolute', top: 8, right: 8, background: '#22c55e', borderRadius: 6, padding: '2px 6px', fontSize: 10, fontWeight: 700 }}>🎬</div>}
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20 }}>
          {/* Left: Audio + Script */}
          <div>
            {/* Audio Player */}
            <div style={{ background: '#111', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #1a1a2e' }}>
              <div style={{ fontSize: 13, color: '#a855f7', fontWeight: 700, marginBottom: 12 }}>🎙️ קריינות עברית V3</div>
              {audioSrc ? (
                <audio ref={audioRef} controls src={audioSrc} style={{ width: '100%' }} />
              ) : (
                <div style={{ color: '#666', fontSize: 13, padding: '10px 0' }}>⚠️ קריינות לא נוצרה</div>
              )}
            </div>

            {/* Voiceover text */}
            <div style={{ background: '#111', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #1a1a2e' }}>
              <div style={{ fontSize: 13, color: '#a855f7', fontWeight: 700, marginBottom: 12 }}>📝 טקסט קריינות</div>
              <p style={{ color: '#ccc', lineHeight: 1.8, margin: 0, fontSize: 14 }}>{result?.voiceover}</p>
            </div>

            {/* Prompts breakdown */}
            <div style={{ background: '#111', borderRadius: 12, padding: 20, border: '1px solid #1a1a2e' }}>
              <div style={{ fontSize: 13, color: '#a855f7', fontWeight: 700, marginBottom: 16 }}>🎯 פירוט הסיפור — פרומפטים</div>
              {scenes.map((scene, i) => (
                <div key={i} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: i < 3 ? '1px solid #1a1a2e' : 'none' }}>
                  <div style={{ fontWeight: 700, color: '#ec4899', marginBottom: 6 }}>{scene.type} {['😤','💡','✨','🚀'][i]}</div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                    <span style={{ color: '#f97316' }}>NB: </span>{scene.nb_prompt}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
                    <span style={{ color: '#3b82f6' }}>Kling: </span>{scene.kling_prompt}
                  </div>
                  <div style={{ fontSize: 12, color: '#22c55e' }}>💬 {scene.subtitle}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Video Preview */}
          <div>
            <div style={{ background: '#111', borderRadius: 12, padding: 16, border: '1px solid #1a1a2e', position: 'sticky', top: 20 }}>
              <div style={{ fontSize: 13, color: '#a855f7', fontWeight: 700, marginBottom: 12, textAlign: 'center' }}>תצוגה מקדימה</div>
              {videoUrls[activeScene] ? (
                <>
                  <video key={videoUrls[activeScene]} controls style={{ width: '100%', borderRadius: 10 }} playsInline>
                    <source src={videoUrls[activeScene]} type="video/mp4" />
                  </video>
                  <a href={videoUrls[activeScene]} download target="_blank" style={{
                    display: 'block', textAlign: 'center', marginTop: 12, padding: '10px',
                    background: 'linear-gradient(135deg, #a855f7, #ec4899)', borderRadius: 10,
                    color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 14
                  }}>⬇️ הורד סצנה {activeScene + 1}</a>
                </>
              ) : frameUrls[activeScene] ? (
                <img src={frameUrls[activeScene]} style={{ width: '100%', borderRadius: 10 }} />
              ) : (
                <div style={{ aspectRatio: '9/16', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 40 }}>⏳</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: '#111', borderRadius: 14, padding: 20, marginBottom: 16, border: '1px solid #1a1a2e' }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14, color: '#e2e8f0' }}>{title}</div>
      {children}
    </div>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>{label}</label>
      <input value={value} onChange={onChange} placeholder={placeholder} style={{
        width: '100%', padding: '12px 14px', background: '#0a0a0f', border: '1px solid #2a2a3e',
        borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box'
      }} />
    </div>
  );
}
