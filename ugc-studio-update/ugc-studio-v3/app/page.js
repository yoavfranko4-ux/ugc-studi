'use client';
import { useState, useRef, useEffect, useCallback } from 'react';

const AVATARS = [
  { id: 1, url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=600&fit=crop&crop=face', name: 'Sophie' },
  { id: 2, url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=600&fit=crop&crop=face', name: 'Maya' },
  { id: 3, url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=600&fit=crop&crop=face', name: 'Ella' },
  { id: 4, url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=400&h=600&fit=crop&crop=face', name: 'Noa' },
  { id: 5, url: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&h=600&fit=crop&crop=face', name: 'Dana' },
  { id: 6, url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop&crop=face', name: 'Adam' },
];

export default function Home() {
  const [screen, setScreen] = useState('form');
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [customAvatar, setCustomAvatar] = useState(null);
  const [productImage, setProductImage] = useState(null);
  const [productName, setProductName] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [applicationArea, setApplicationArea] = useState('');
  
  // Progress state
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  
  // Editor state — updates live as data streams in
  const [scenes, setScenes] = useState([]);
  const [voiceover, setVoiceover] = useState('');
  const [audioBase64, setAudioBase64] = useState(null);
  const [frameUrls, setFrameUrls] = useState([null, null, null, null]);
  const [videoUrls, setVideoUrls] = useState([null, null, null, null]);
  const [activeScene, setActiveScene] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [editSubtitles, setEditSubtitles] = useState([]);

  const addLog = (msg, type = 'info') => {
    setLogs(prev => [...prev.slice(-50), { msg, type, time: new Date().toLocaleTimeString('he-IL') }]);
  };

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCustomAvatar(ev.target.result); setSelectedAvatar(null); };
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

    setLogs([]);
    setProgress(0);
    setScenes([]);
    setVoiceover('');
    setAudioBase64(null);
    setFrameUrls([null, null, null, null]);
    setVideoUrls([null, null, null, null]);
    setIsGenerating(true);
    setScreen('editor');
    addLog('🚀 מתחיל Agent...', 'start');

    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, productDesc, applicationArea, avatarUrl, productImageUrl: productImage || null })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            if (data.scenes) { setScenes(data.scenes); setEditSubtitles(data.scenes.map(s => s.subtitle)); }
            if (data.voiceover) setVoiceover(data.voiceover);
            if (data.audioBase64) setAudioBase64(data.audioBase64);
            if (data.frameUrl !== undefined && data.frameIndex !== undefined) {
              setFrameUrls(prev => { const n = [...prev]; n[data.frameIndex] = data.frameUrl; return n; });
            }
            if (data.videoUrl !== undefined && data.videoIndex !== undefined) {
              setVideoUrls(prev => { const n = [...prev]; n[data.videoIndex] = data.videoUrl; return n; });
            }
            if (data.step === 'done') setIsGenerating(false);
          } catch {}
        }
      }
    } catch (e) {
      addLog(`❌ שגיאה: ${e.message}`, 'error');
    }
    setIsGenerating(false);
  };

  if (screen === 'form') return (
    <FormScreen
      selectedAvatar={selectedAvatar} setSelectedAvatar={setSelectedAvatar}
      customAvatar={customAvatar} handleAvatarUpload={handleAvatarUpload}
      productImage={productImage} handleProductUpload={handleProductUpload}
      productName={productName} setProductName={setProductName}
      productDesc={productDesc} setProductDesc={setProductDesc}
      applicationArea={applicationArea} setApplicationArea={setApplicationArea}
      runAgent={runAgent}
    />
  );

  return (
    <EditorScreen
      isGenerating={isGenerating} logs={logs} progress={progress}
      scenes={scenes} voiceover={voiceover} audioBase64={audioBase64}
      frameUrls={frameUrls} videoUrls={videoUrls}
      activeScene={activeScene} setActiveScene={setActiveScene}
      editSubtitles={editSubtitles} setEditSubtitles={setEditSubtitles}
      onNew={() => setScreen('form')}
    />
  );
}

// ===== EDITOR SCREEN (CapCut style) =====
function EditorScreen({ isGenerating, logs, progress, scenes, voiceover, audioBase64, frameUrls, videoUrls, activeScene, setActiveScene, editSubtitles, setEditSubtitles, onNew }) {
  const audioRef = useRef(null);
  const logsEndRef = useRef(null);
  const [showLogs, setShowLogs] = useState(false);
  const [playingAll, setPlayingAll] = useState(false);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const audioSrc = audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null;
  const sceneTypes = ['כאב 😤', 'גילוי 💡', 'שימוש ✨', 'CTA 🚀'];

  return (
    <div style={{ height: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui', direction: 'rtl', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      {/* Top Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#111', borderBottom: '1px solid #1a1a2e', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={onNew} style={{ padding: '6px 14px', background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#aaa', cursor: 'pointer', fontSize: 13 }}>← חדש</button>
          <span style={{ fontSize: 16, fontWeight: 700, background: 'linear-gradient(135deg, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>🎬 UGC Studio</span>
          {isGenerating && <span style={{ fontSize: 12, color: '#a855f7', animation: 'pulse 1s infinite' }}>● מייצר...</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isGenerating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 120, height: 6, background: '#1a1a2e', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg, #a855f7, #ec4899)', transition: 'width 0.5s' }} />
              </div>
              <span style={{ fontSize: 12, color: '#a855f7', fontWeight: 700 }}>{progress}%</span>
            </div>
          )}
          <button onClick={() => setShowLogs(!showLogs)} style={{ padding: '6px 12px', background: showLogs ? '#a855f7' : '#1a1a2e', border: '1px solid #333', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 12 }}>
            📋 לוג
          </button>
          {videoUrls.some(Boolean) && (
            <button style={{ padding: '6px 14px', background: 'linear-gradient(135deg, #a855f7, #ec4899)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              ⬇️ ייצא
            </button>
          )}
        </div>
      </div>

      {/* Log Panel */}
      {showLogs && (
        <div style={{ height: 160, background: '#0d0d1a', borderBottom: '1px solid #1a1a2e', overflow: 'auto', padding: '8px 16px', flexShrink: 0 }}>
          {logs.map((log, i) => (
            <div key={i} style={{ fontSize: 12, color: log.type === 'error' ? '#f87171' : log.type === 'success' ? '#34d399' : log.type === 'start' ? '#a855f7' : '#9ca3af', padding: '2px 0', display: 'flex', gap: 10 }}>
              <span style={{ color: '#444', minWidth: 65 }}>{log.time}</span>
              <span>{log.msg}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {/* Main Editor Area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Scene List */}
        <div style={{ width: 220, background: '#0d0d1a', borderLeft: '1px solid #1a1a2e', overflow: 'auto', padding: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#555', fontWeight: 700, marginBottom: 10, textTransform: 'uppercase' }}>סצנות</div>
          {[0,1,2,3].map(i => (
            <div key={i} onClick={() => setActiveScene(i)} style={{
              borderRadius: 10, overflow: 'hidden', marginBottom: 12, cursor: 'pointer',
              border: activeScene === i ? '2px solid #a855f7' : '2px solid transparent',
              background: '#111', position: 'relative'
            }}>
              {frameUrls[i] ? (
                <img src={frameUrls[i]} style={{ width: '100%', aspectRatio: '9/16', objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '9/16', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#111', gap: 6 }}>
                  {isGenerating ? (
                    <>
                      <div style={{ width: 28, height: 28, border: '3px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      <span style={{ fontSize: 10, color: '#555' }}>מייצר...</span>
                    </>
                  ) : <span style={{ fontSize: 24 }}>⬜</span>}
                </div>
              )}
              {videoUrls[i] && <div style={{ position: 'absolute', top: 6, left: 6, background: '#22c55e', borderRadius: 4, padding: '2px 5px', fontSize: 9, fontWeight: 700 }}>🎬</div>}
              <div style={{ padding: '6px 8px', fontSize: 11 }}>
                <div style={{ color: '#a855f7', fontWeight: 700 }}>{scenes[i]?.type || sceneTypes[i]}</div>
                {editSubtitles[i] && <div style={{ color: '#888', marginTop: 2, fontSize: 10 }}>{editSubtitles[i]}</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Center: Preview */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#0a0a0f', position: 'relative' }}>
          <div style={{ position: 'relative', height: '100%', maxHeight: 520, aspectRatio: '9/16', background: '#111', borderRadius: 16, overflow: 'hidden', boxShadow: '0 0 40px rgba(168,85,247,0.2)' }}>
            {videoUrls[activeScene] ? (
              <video key={videoUrls[activeScene]} controls autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover' }} playsInline>
                <source src={videoUrls[activeScene]} type="video/mp4" />
              </video>
            ) : frameUrls[activeScene] ? (
              <img src={frameUrls[activeScene]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                {isGenerating ? (
                  <>
                    <div style={{ width: 48, height: 48, border: '4px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                    <span style={{ color: '#555', fontSize: 14 }}>מייצר סצנה {activeScene + 1}...</span>
                  </>
                ) : <span style={{ fontSize: 48 }}>🎬</span>}
              </div>
            )}

            {/* Subtitle overlay */}
            {editSubtitles[activeScene] && (
              <div style={{
                position: 'absolute', bottom: 40, left: 0, right: 0,
                textAlign: 'center', padding: '0 16px'
              }}>
                <span style={{
                  background: 'rgba(0,0,0,0.75)', color: '#fff',
                  padding: '6px 14px', borderRadius: 8, fontSize: 15, fontWeight: 700
                }}>
                  {editSubtitles[activeScene]}
                </span>
              </div>
            )}

            {/* Loading indicator on top when still generating */}
            {isGenerating && videoUrls[activeScene] === null && (
              <div style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(168,85,247,0.9)', borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700 }}>
                {frameUrls[activeScene] ? '🎬 Kling...' : '🎨 NB...'}
              </div>
            )}
          </div>

          {/* Scene nav buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {[0,1,2,3].map(i => (
              <button key={i} onClick={() => setActiveScene(i)} style={{
                width: 32, height: 32, borderRadius: '50%',
                background: activeScene === i ? '#a855f7' : '#1a1a2e',
                border: videoUrls[i] ? '2px solid #22c55e' : frameUrls[i] ? '2px solid #a855f7' : '2px solid #333',
                color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 700
              }}>{i+1}</button>
            ))}
          </div>
        </div>

        {/* Right: Controls Panel */}
        <div style={{ width: 280, background: '#0d0d1a', borderRight: '1px solid #1a1a2e', overflow: 'auto', padding: 16, flexShrink: 0 }}>
          
          {/* Audio */}
          <PanelSection title="🎙️ קריינות">
            {audioSrc ? (
              <audio ref={audioRef} controls src={audioSrc} style={{ width: '100%', height: 36 }} />
            ) : isGenerating ? (
              <div style={{ fontSize: 12, color: '#555', padding: '8px 0' }}>⏳ מייצר קריינות...</div>
            ) : (
              <div style={{ fontSize: 12, color: '#555', padding: '8px 0' }}>⚠️ קריינות לא נוצרה</div>
            )}
          </PanelSection>

          {/* Subtitle editor */}
          <PanelSection title="💬 כתוביות">
            {[0,1,2,3].map(i => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#555', marginBottom: 4 }}>{scenes[i]?.type || sceneTypes[i]}</div>
                <input
                  value={editSubtitles[i] || ''}
                  onChange={e => { const n = [...editSubtitles]; n[i] = e.target.value; setEditSubtitles(n); }}
                  style={{ width: '100%', padding: '7px 10px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 8, color: '#fff', fontSize: 13, boxSizing: 'border-box', outline: 'none' }}
                  placeholder="ערוך כתובית..."
                />
              </div>
            ))}
          </PanelSection>

          {/* Voiceover text */}
          {voiceover && (
            <PanelSection title="📝 טקסט קריינות">
              <p style={{ fontSize: 12, color: '#aaa', lineHeight: 1.7, margin: 0 }}>{voiceover}</p>
            </PanelSection>
          )}

          {/* Download buttons */}
          <PanelSection title="⬇️ הורדות">
            {[0,1,2,3].map(i => (
              videoUrls[i] ? (
                <a key={i} href={videoUrls[i]} download target="_blank" style={{
                  display: 'block', padding: '8px 12px', marginBottom: 8,
                  background: '#1a2e1a', border: '1px solid #22c55e', borderRadius: 8,
                  color: '#22c55e', textDecoration: 'none', fontSize: 13, textAlign: 'center'
                }}>⬇️ סצנה {i+1} — {scenes[i]?.type || ''}</a>
              ) : (
                <div key={i} style={{ padding: '8px 12px', marginBottom: 8, background: '#111', border: '1px solid #222', borderRadius: 8, color: '#333', fontSize: 13, textAlign: 'center' }}>
                  {isGenerating ? `⏳ סצנה ${i+1}...` : `❌ סצנה ${i+1}`}
                </div>
              )
            ))}
          </PanelSection>
        </div>
      </div>

      {/* Bottom Timeline */}
      <div style={{ height: 80, background: '#111', borderTop: '1px solid #1a1a2e', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 8, flexShrink: 0, overflowX: 'auto' }}>
        <span style={{ fontSize: 11, color: '#555', minWidth: 40 }}>ציר</span>
        {[0,1,2,3].map(i => (
          <div key={i} onClick={() => setActiveScene(i)} style={{
            height: 56, flex: 1, minWidth: 100, borderRadius: 8, overflow: 'hidden',
            cursor: 'pointer', position: 'relative',
            border: activeScene === i ? '2px solid #a855f7' : '2px solid #1a1a2e',
            background: '#0a0a0f'
          }}>
            {frameUrls[i] ? (
              <img src={frameUrls[i]} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {isGenerating ? <div style={{ width: 16, height: 16, border: '2px solid #a855f7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> : <span style={{ color: '#333', fontSize: 18 }}>□</span>}
              </div>
            )}
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.7)', padding: '2px 6px', fontSize: 10, color: videoUrls[i] ? '#22c55e' : frameUrls[i] ? '#a855f7' : '#555' }}>
              {videoUrls[i] ? '🎬 מוכן' : frameUrls[i] ? '🎨 פריים' : isGenerating ? '⏳' : '—'}
            </div>
          </div>
        ))}

        {/* Audio track */}
        <div style={{ height: 56, flex: 2, minWidth: 150, borderRadius: 8, background: audioBase64 ? '#1a2e1a' : '#0d0d1a', border: '2px solid', borderColor: audioBase64 ? '#22c55e' : '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: audioBase64 ? '#22c55e' : '#333' }}>
          {audioBase64 ? '🎙️ קריינות ✅' : isGenerating ? '🎙️ ⏳...' : '🎙️ —'}
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      `}</style>
    </div>
  );
}

function PanelSection({ title, children }) {
  return (
    <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #1a1a2e' }}>
      <div style={{ fontSize: 12, color: '#a855f7', fontWeight: 700, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

// ===== FORM SCREEN =====
function FormScreen({ selectedAvatar, setSelectedAvatar, customAvatar, handleAvatarUpload, productImage, handleProductUpload, productName, setProductName, productDesc, setProductDesc, applicationArea, setApplicationArea, runAgent }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui', direction: 'rtl' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 20px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, background: 'linear-gradient(135deg, #a855f7, #ec4899)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>🎬 UGC Studio</h1>
          <p style={{ color: '#888', marginTop: 8 }}>צור סרטוני UGC ויראליים עם AI</p>
        </div>

        <Section title="👤 בחר אווטאר">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 12 }}>
            {AVATARS.map(a => (
              <div key={a.id} onClick={() => { setSelectedAvatar(a); }} style={{ cursor: 'pointer', borderRadius: 10, overflow: 'hidden', border: selectedAvatar?.id === a.id ? '3px solid #a855f7' : '3px solid transparent' }}>
                <img src={a.url} alt={a.name} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 16px', background: '#1a1a2e', borderRadius: 10, border: customAvatar ? '2px solid #a855f7' : '2px dashed #333' }}>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display: 'none' }} />
            {customAvatar ? <img src={customAvatar} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} /> : <span style={{ fontSize: 22 }}>📷</span>}
            <span style={{ color: '#aaa', fontSize: 14 }}>{customAvatar ? '✅ אווטאר אישי הועלה' : 'העלה אווטאר אישי'}</span>
          </label>
        </Section>

        <Section title="📦 תמונת מוצר">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '12px 16px', background: '#1a1a2e', borderRadius: 10, border: productImage ? '2px solid #a855f7' : '2px dashed #333' }}>
            <input type="file" accept="image/*" onChange={handleProductUpload} style={{ display: 'none' }} />
            {productImage ? <img src={productImage} style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} /> : <span style={{ fontSize: 22 }}>🛍️</span>}
            <span style={{ color: '#aaa', fontSize: 14 }}>{productImage ? '✅ תמונת מוצר הועלתה' : 'העלה תמונת מוצר'}</span>
          </label>
        </Section>

        <Section title="✍️ פרטי המוצר">
          <Input label="שם המוצר *" value={productName} onChange={e => setProductName(e.target.value)} placeholder="מדבקות הלבנת שיניים FRAKO" />
          <Input label="מה המוצר פותר" value={productDesc} onChange={e => setProductDesc(e.target.value)} placeholder="מלבין שיניים תוך 7 ימים, ללא רגישות" />
          <Input label="איך משתמשים" value={applicationArea} onChange={e => setApplicationArea(e.target.value)} placeholder="מניחים על השיניים 30 דקות, מסירים ושוטפים" />
        </Section>

        <button onClick={runAgent} style={{ width: '100%', padding: '18px', fontSize: 18, fontWeight: 700, background: 'linear-gradient(135deg, #a855f7, #ec4899)', color: '#fff', border: 'none', borderRadius: 14, cursor: 'pointer', marginTop: 8 }}>
          🎬 צור 4 סצנות UGC עכשיו
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background: '#111', borderRadius: 14, padding: 20, marginBottom: 16, border: '1px solid #1a1a2e' }}>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>{label}</label>
      <input value={value} onChange={onChange} placeholder={placeholder} style={{ width: '100%', padding: '12px 14px', background: '#0a0a0f', border: '1px solid #2a2a3e', borderRadius: 10, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
    </div>
  );
}
