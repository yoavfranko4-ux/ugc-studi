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

const SCENE_DURATION = 5;
const TOTAL_DURATION = 20;

export default function Home() {
  const [screen, setScreen] = useState('form');
  const [selectedAvatar, setSelectedAvatar] = useState(null);
  const [customAvatar, setCustomAvatar] = useState(null);
  const [productImage, setProductImage] = useState(null);
  const [productName, setProductName] = useState('');
  const [productDesc, setProductDesc] = useState('');
  const [applicationArea, setApplicationArea] = useState('');
  const [storyDescription, setStoryDescription] = useState('');
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [scenes, setScenes] = useState([]);
  const [voiceover, setVoiceover] = useState('');
  const [audioBase64, setAudioBase64] = useState(null);
  const [frameUrls, setFrameUrls] = useState([null,null,null,null]);
  const [videoUrls, setVideoUrls] = useState([null,null,null,null]);
  const [activeScene, setActiveScene] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [klingStatus, setKlingStatus] = useState(['idle','idle','idle','idle']);
  const [editSubtitles, setEditSubtitles] = useState(['','','','']);

  const addLog = (msg, type='info') => setLogs(prev => [...prev.slice(-60), { msg, type, time: new Date().toLocaleTimeString('he-IL') }]);

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { setCustomAvatar(ev.target.result); setSelectedAvatar(null); };
    reader.readAsDataURL(file);
  };

  const handleProductUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setProductImage(ev.target.result);
    reader.readAsDataURL(file);
  };

  const runKling = useCallback(async (frameUrl, klingPrompt, index) => {
    if (!frameUrl) return;
    setKlingStatus(prev => { const n=[...prev]; n[index]='loading'; return n; });
    addLog(`🎬 Kling — מייצר סרטון ${index+1}/4...`);
    try {
      const res = await fetch('/api/kling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: frameUrl, prompt: klingPrompt, sceneIndex: index })
      });
      const data = await res.json();
      if (data.videoUrl) {
        setVideoUrls(prev => { const n=[...prev]; n[index]=data.videoUrl; return n; });
        setKlingStatus(prev => { const n=[...prev]; n[index]='done'; return n; });
        setProgress(prev => Math.min(100, prev + 7));
        addLog(`✅ סרטון ${index+1} מוכן!`, 'success');
      } else {
        setKlingStatus(prev => { const n=[...prev]; n[index]='error'; return n; });
        addLog(`❌ סרטון ${index+1} נכשל: ${data.error||''}`, 'error');
      }
    } catch (e) {
      setKlingStatus(prev => { const n=[...prev]; n[index]='error'; return n; });
      addLog(`❌ סרטון ${index+1} שגיאה: ${e.message}`, 'error');
    }
  }, []);

  const runAgent = async () => {
    if (!productName.trim()) return alert('נא להכניס שם מוצר');
    const avatarUrl = customAvatar || selectedAvatar?.url || null;
    if (!avatarUrl) return alert('נא לבחור או להעלות אווטאר');

    setLogs([]); setProgress(0); setScenes([]); setVoiceover('');
    setAudioBase64(null); setFrameUrls([null,null,null,null]);
    setVideoUrls([null,null,null,null]); setKlingStatus(['idle','idle','idle','idle']);
    setEditSubtitles(['','','','']); setIsGenerating(true); setScreen('editor');
    addLog('🚀 מתחיל Agent...', 'start');

    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, productDesc, applicationArea, storyDescription, avatarUrl, productImageUrl: productImage || null })
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalFrameUrls = [null,null,null,null];
      let finalKlingPrompts = [];
      let finalScenes = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.progress !== undefined) setProgress(data.progress);
            if (data.message) addLog(data.message, data.step?.includes('fail')?'error':data.step==='done'?'success':'info');
            if (data.scenes) { setScenes(data.scenes); finalScenes=data.scenes; setEditSubtitles(data.scenes.map(s=>s.subtitle)); }
            if (data.voiceover) setVoiceover(data.voiceover);
            if (data.audioBase64) setAudioBase64(data.audioBase64);
            if (data.frameUrl !== undefined && data.frameIndex !== undefined) {
              setFrameUrls(prev => { const n=[...prev]; n[data.frameIndex]=data.frameUrl; return n; });
              finalFrameUrls[data.frameIndex] = data.frameUrl;
            }
            if (data.step === 'frames_done') {
              finalFrameUrls = data.frameUrls || finalFrameUrls;
              finalKlingPrompts = data.klingPrompts || finalScenes.map(s=>s.kling_prompt);
              finalFrameUrls.forEach((frameUrl, i) => {
                if (frameUrl && finalKlingPrompts[i]) runKling(frameUrl, finalKlingPrompts[i], i);
              });
            }
          } catch {}
        }
      }
    } catch (e) { addLog(`❌ שגיאה: ${e.message}`, 'error'); }
    setIsGenerating(false);
  };

  if (screen === 'form') return <FormScreen
    selectedAvatar={selectedAvatar} setSelectedAvatar={setSelectedAvatar}
    customAvatar={customAvatar} handleAvatarUpload={handleAvatarUpload}
    productImage={productImage} handleProductUpload={handleProductUpload}
    productName={productName} setProductName={setProductName}
    productDesc={productDesc} setProductDesc={setProductDesc}
    applicationArea={applicationArea} setApplicationArea={setApplicationArea}
    storyDescription={storyDescription} setStoryDescription={setStoryDescription}
    runAgent={runAgent}
  />;

  const totalDone = videoUrls.filter(Boolean).length;
  const allDone = !isGenerating && klingStatus.every(s => s==='done'||s==='error');

  return <EditorScreen
    isGenerating={isGenerating} logs={logs} progress={progress}
    scenes={scenes} voiceover={voiceover} audioBase64={audioBase64}
    frameUrls={frameUrls} videoUrls={videoUrls} klingStatus={klingStatus}
    activeScene={activeScene} setActiveScene={setActiveScene}
    editSubtitles={editSubtitles} setEditSubtitles={setEditSubtitles}
    allDone={allDone} totalDone={totalDone}
    onNew={() => setScreen('form')}
  />;
}

function EditorScreen({ isGenerating, logs, progress, scenes, voiceover, audioBase64, frameUrls, videoUrls, klingStatus, activeScene, setActiveScene, editSubtitles, setEditSubtitles, allDone, totalDone, onNew }) {
  const audioRef = useRef(null);
  const videoRefs = useRef([null,null,null,null]);
  const [showLogs, setShowLogs] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const logsEndRef = useRef(null);
  const animFrameRef = useRef(null);
  const playStartRef = useRef(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const stopAll = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    videoRefs.current.forEach(v => { if (v) { v.pause(); v.currentTime = 0; } });
    setCurrentTime(0); setActiveScene(0);
  }, [setActiveScene]);

  const playAll = useCallback(() => {
    if (!videoUrls.some(Boolean)) return;
    stopAll();
    setTimeout(() => {
      setIsPlaying(true);
      playStartRef.current = performance.now();
      if (audioRef.current && audioBase64) { audioRef.current.currentTime = 0; audioRef.current.play().catch(()=>{}); }
      const firstScene = videoUrls.findIndex(Boolean);
      if (firstScene >= 0 && videoRefs.current[firstScene]) {
        setActiveScene(firstScene);
        videoRefs.current[firstScene].currentTime = 0;
        videoRefs.current[firstScene].play().catch(()=>{});
      }
      const tick = () => {
        const elapsed = (performance.now() - playStartRef.current) / 1000;
        setCurrentTime(elapsed);
        const sceneIdx = Math.min(Math.floor(elapsed / SCENE_DURATION), 3);
        const prevIdx = Math.min(Math.floor((elapsed - 0.05) / SCENE_DURATION), 3);
        setActiveScene(sceneIdx);
        if (sceneIdx !== prevIdx) {
          if (videoRefs.current[prevIdx]) { videoRefs.current[prevIdx].pause(); videoRefs.current[prevIdx].currentTime = 0; }
          if (videoUrls[sceneIdx] && videoRefs.current[sceneIdx]) { videoRefs.current[sceneIdx].currentTime = 0; videoRefs.current[sceneIdx].play().catch(()=>{}); }
        }
        if (elapsed >= TOTAL_DURATION) { stopAll(); return; }
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    }, 50);
  }, [videoUrls, audioBase64, stopAll, setActiveScene]);

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);

  const audioSrc = audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null;
  const timePercent = Math.min((currentTime / TOTAL_DURATION) * 100, 100);
  const sceneTypes = ['כאב 😤','גילוי 💡','שימוש ✨','CTA 🚀'];
  const klingIcon = (s) => s==='loading'?'⏳':s==='done'?'🎬':s==='error'?'❌':'—';

  return (
    <div style={{ height:'100vh', background:'#0d0e14', color:'#fff', fontFamily:'system-ui', direction:'rtl', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 16px', background:'#111318', borderBottom:'1px solid #1e2030', flexShrink:0, height:46 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onNew} style={{ padding:'5px 12px', background:'#1e2030', border:'1px solid #2a2d40', borderRadius:7, color:'#aaa', cursor:'pointer', fontSize:12 }}>← חדש</button>
          <span style={{ fontSize:15, fontWeight:700, background:'linear-gradient(135deg,#a855f7,#ec4899)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>🎬 UGC Studio</span>
          {isGenerating && <span style={{ fontSize:11, color:'#a855f7' }}>● מעבד...</span>}
          {!isGenerating && klingStatus.some(s=>s==='loading') && <span style={{ fontSize:11, color:'#f59e0b' }}>🎬 Kling רץ... ({totalDone}/4)</span>}
          {allDone && <span style={{ fontSize:11, color:'#22c55e' }}>✅ הכל מוכן!</span>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {(isGenerating || klingStatus.some(s=>s==='loading')) && (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div style={{ width:140, height:5, background:'#1e2030', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${progress}%`, background:'linear-gradient(90deg,#a855f7,#ec4899)', transition:'width 0.5s' }} />
              </div>
              <span style={{ fontSize:12, color:'#a855f7', fontWeight:700, minWidth:32 }}>{progress}%</span>
            </div>
          )}
          <button onClick={()=>setShowLogs(!showLogs)} style={{ padding:'5px 10px', background:showLogs?'#a855f720':'#1e2030', border:`1px solid ${showLogs?'#a855f7':'#2a2d40'}`, borderRadius:7, color:showLogs?'#a855f7':'#aaa', cursor:'pointer', fontSize:11 }}>📋 לוג</button>
          {videoUrls.some(Boolean) && <button style={{ padding:'5px 14px', background:'linear-gradient(135deg,#a855f7,#ec4899)', border:'none', borderRadius:7, color:'#fff', cursor:'pointer', fontSize:12, fontWeight:700 }}>ייצא ⬇️</button>}
        </div>
      </div>

      {showLogs && (
        <div style={{ height:140, background:'#090a0f', borderBottom:'1px solid #1e2030', overflow:'auto', padding:'8px 16px', flexShrink:0 }}>
          {logs.map((log,i) => (
            <div key={i} style={{ fontSize:11, color:log.type==='error'?'#f87171':log.type==='success'?'#34d399':log.type==='start'?'#a855f7':'#6b7280', padding:'2px 0', display:'flex', gap:10 }}>
              <span style={{ color:'#374151', minWidth:65 }}>{log.time}</span><span>{log.msg}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      <div style={{ flex:1, display:'flex', overflow:'hidden', minHeight:0 }}>
        <div style={{ width:155, background:'#111318', borderLeft:'1px solid #1e2030', overflow:'auto', padding:10, flexShrink:0 }}>
          <div style={{ fontSize:10, color:'#374151', fontWeight:700, marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>מדיה</div>
          {[0,1,2,3].map(i => (
            <div key={i} onClick={()=>setActiveScene(i)} style={{ borderRadius:8, overflow:'hidden', marginBottom:10, cursor:'pointer', border:activeScene===i?'2px solid #a855f7':'2px solid transparent', background:'#0d0e14', position:'relative' }}>
              {frameUrls[i] ? <img src={frameUrls[i]} style={{ width:'100%', aspectRatio:'9/16', objectFit:'cover', display:'block' }} />
                : <div style={{ width:'100%', aspectRatio:'9/16', display:'flex', alignItems:'center', justifyContent:'center', background:'#111318' }}>{isGenerating?<Spinner size={20}/>:<span style={{ color:'#374151', fontSize:20 }}>□</span>}</div>}
              <div style={{ position:'absolute', top:4, left:4, fontSize:12 }}>{klingIcon(klingStatus[i])}</div>
              <div style={{ padding:'4px 6px', fontSize:10, color:'#9ca3af' }}>{scenes[i]?.type||sceneTypes[i]}</div>
            </div>
          ))}
        </div>

        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0b10', padding:16 }}>
          <div style={{ position:'relative', height:'100%', maxHeight:500, aspectRatio:'9/16', background:'#000', borderRadius:12, overflow:'hidden', boxShadow:'0 0 60px rgba(168,85,247,0.15)' }}>
            {[0,1,2,3].map(i => (
              <video key={i} ref={el=>videoRefs.current[i]=el} src={videoUrls[i]||undefined}
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:activeScene===i&&videoUrls[i]?'block':'none' }}
                playsInline />
            ))}
            {!videoUrls[activeScene] && (
              frameUrls[activeScene]
                ? <img src={frameUrls[activeScene]} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
                    {isGenerating?<><Spinner size={40}/><span style={{ color:'#374151', fontSize:13 }}>מייצר...</span></>:<span style={{ fontSize:48 }}>🎬</span>}
                  </div>
            )}
            {editSubtitles[activeScene] && (
              <div style={{ position:'absolute', bottom:32, left:0, right:0, textAlign:'center', padding:'0 12px' }}>
                <span style={{ background:'rgba(0,0,0,0.8)', color:'#fff', padding:'5px 12px', borderRadius:6, fontSize:14, fontWeight:700 }}>{editSubtitles[activeScene]}</span>
              </div>
            )}
            <div style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,0.7)', borderRadius:5, padding:'2px 8px', fontSize:10, color:'#a855f7' }}>
              {klingStatus[activeScene]==='loading'?'🎬 Kling...':klingStatus[activeScene]==='done'?'✅':frameUrls[activeScene]?'🎨 פריים':'⏳'}
            </div>
          </div>
        </div>

        <div style={{ width:255, background:'#111318', borderRight:'1px solid #1e2030', overflow:'auto', padding:14, flexShrink:0 }}>
          <div style={{ fontSize:10, color:'#374151', fontWeight:700, marginBottom:12, textTransform:'uppercase', letterSpacing:1 }}>עריכה</div>
          <RightSection title="💬 כתוביות">
            {[0,1,2,3].map(i => (
              <div key={i} style={{ marginBottom:8 }}>
                <div style={{ fontSize:10, color:'#4b5563', marginBottom:3 }}>{scenes[i]?.type||sceneTypes[i]}</div>
                <input value={editSubtitles[i]||''} onChange={e=>{const n=[...editSubtitles];n[i]=e.target.value;setEditSubtitles(n);}}
                  style={{ width:'100%', padding:'6px 9px', background:'#0d0e14', border:'1px solid #1e2030', borderRadius:7, color:'#e5e7eb', fontSize:12, boxSizing:'border-box', outline:'none' }}
                  placeholder="ערוך כתובית..." />
              </div>
            ))}
          </RightSection>
          {voiceover && <RightSection title="📝 סקריפט"><p style={{ fontSize:11, color:'#9ca3af', lineHeight:1.7, margin:0 }}>{voiceover}</p></RightSection>}
          <RightSection title="⬇️ הורדות">
            {[0,1,2,3].map(i => videoUrls[i]
              ? <a key={i} href={videoUrls[i]} download target="_blank" style={{ display:'block', padding:'7px 10px', marginBottom:6, background:'#0f1f0f', border:'1px solid #22c55e', borderRadius:7, color:'#22c55e', textDecoration:'none', fontSize:12, textAlign:'center' }}>⬇️ סצנה {i+1}</a>
              : <div key={i} style={{ padding:'7px 10px', marginBottom:6, background:'#111318', border:'1px solid #1e2030', borderRadius:7, color:'#374151', fontSize:12, textAlign:'center' }}>{klingStatus[i]==='loading'?`⏳ סצנה ${i+1} Kling...`:isGenerating?`⏳ סצנה ${i+1}...`:`— סצנה ${i+1}`}</div>
            )}
          </RightSection>
        </div>
      </div>

      <div style={{ height:165, background:'#0a0b0f', borderTop:'2px solid #1e2030', flexShrink:0, display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', borderBottom:'1px solid #1e2030' }}>
          <button onClick={isPlaying?stopAll:playAll} style={{ width:32, height:32, borderRadius:'50%', background:'linear-gradient(135deg,#a855f7,#ec4899)', border:'none', color:'#fff', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>
            {isPlaying?'⏸':'▶'}
          </button>
          <button onClick={stopAll} style={{ width:28, height:28, borderRadius:'50%', background:'#1e2030', border:'1px solid #2a2d40', color:'#aaa', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>⏹</button>
          <span style={{ fontSize:12, color:'#6b7280', minWidth:80 }}>{formatTime(currentTime)} / {formatTime(TOTAL_DURATION)}</span>
          {audioSrc && <audio ref={audioRef} src={audioSrc} style={{ display:'none' }} />}
          <div style={{ flex:1, height:4, background:'#1e2030', borderRadius:2, position:'relative', cursor:'pointer' }}
            onClick={e => {
              const rect = e.currentTarget.getBoundingClientRect();
              const t = ((e.clientX-rect.left)/rect.width)*TOTAL_DURATION;
              setCurrentTime(t); setActiveScene(Math.min(Math.floor(t/SCENE_DURATION),3));
            }}>
            <div style={{ height:'100%', width:`${timePercent}%`, background:'linear-gradient(90deg,#a855f7,#ec4899)', borderRadius:2 }} />
            <div style={{ position:'absolute', top:-4, left:`${timePercent}%`, width:12, height:12, background:'#a855f7', borderRadius:'50%', transform:'translateX(-50%)', border:'2px solid #0a0b0f' }} />
          </div>
        </div>
        <div style={{ flex:1, padding:'8px 16px', display:'flex', flexDirection:'column', gap:5, overflow:'hidden' }}>
          <div style={{ display:'flex', height:14 }}>
            <div style={{ width:70, flexShrink:0 }} />
            <div style={{ flex:1, position:'relative' }}>
              {[0,5,10,15,20].map(t => (
                <div key={t} style={{ position:'absolute', left:`${(t/TOTAL_DURATION)*100}%`, fontSize:9, color:'#374151', transform:'translateX(-50%)' }}>{t}s</div>
              ))}
              <div style={{ position:'absolute', top:0, left:`${timePercent}%`, width:1, height:300, background:'#a855f7', zIndex:10, opacity:0.8, pointerEvents:'none' }} />
            </div>
          </div>
          <Track label="🎬 וידאו">
            {[0,1,2,3].map(i => (
              <div key={i} onClick={()=>setActiveScene(i)} style={{ flex:1, height:'100%', borderRadius:5, overflow:'hidden', cursor:'pointer', border:activeScene===i?'2px solid #a855f7':'2px solid transparent', marginLeft:i>0?2:0, background:'#150e2a', position:'relative', display:'flex', alignItems:'center', gap:4, padding:'0 5px' }}>
                {frameUrls[i] && <img src={frameUrls[i]} style={{ height:'80%', aspectRatio:'9/16', objectFit:'cover', borderRadius:3, flexShrink:0 }} />}
                <span style={{ fontSize:9, color:videoUrls[i]?'#c4b5fd':klingStatus[i]==='loading'?'#f59e0b':'#4b3080', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                  {videoUrls[i]?(scenes[i]?.type||`סצנה ${i+1}`):klingStatus[i]==='loading'?'Kling...':frameUrls[i]?'פריים':'—'}
                </span>
                <div style={{ position:'absolute', bottom:2, right:3, fontSize:8, color:'#4b3080' }}>{SCENE_DURATION}s</div>
              </div>
            ))}
          </Track>
          <Track label="🎙️ קול">
            <div style={{ flex:1, height:'100%', borderRadius:5, background:audioBase64?'#0a1f0f':'#0a100c', border:`1px solid ${audioBase64?'#22c55e':'#1e2030'}`, display:'flex', alignItems:'center', padding:'0 10px', gap:6, overflow:'hidden' }}>
              {audioBase64 ? (
                <>
                  <div style={{ display:'flex', alignItems:'center', gap:1, height:'65%' }}>
                    {Array.from({length:50}).map((_,j) => {
                      const h = 20+Math.sin(j*0.6)*18+Math.sin(j*1.4)*10;
                      const active = (j/50) < (currentTime/TOTAL_DURATION);
                      return <div key={j} style={{ width:2, height:`${h}%`, background:active?'#22c55e':'#14532d', borderRadius:1 }} />;
                    })}
                  </div>
                  <span style={{ fontSize:10, color:'#22c55e', fontWeight:600, whiteSpace:'nowrap' }}>קריינות V3 — 20s</span>
                </>
              ) : <span style={{ fontSize:11, color:'#374151' }}>{isGenerating?'⏳ מייצר קריינות...':'— אין קריינות'}</span>}
            </div>
          </Track>
          <Track label="💬 כתובית">
            {[0,1,2,3].map(i => (
              <div key={i} style={{ flex:1, height:'100%', borderRadius:5, background:'#110e00', border:'1px solid #78350f', marginLeft:i>0?2:0, display:'flex', alignItems:'center', padding:'0 5px', overflow:'hidden' }}>
                <span style={{ fontSize:9, color:'#f59e0b', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{editSubtitles[i]||'—'}</span>
              </div>
            ))}
          </Track>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Track({ label, children }) {
  return (
    <div style={{ display:'flex', alignItems:'stretch', height:32, gap:6 }}>
      <div style={{ width:70, flexShrink:0, display:'flex', alignItems:'center', fontSize:10, color:'#4b5563', fontWeight:600, whiteSpace:'nowrap' }}>{label}</div>
      <div style={{ flex:1, display:'flex', borderRadius:5, overflow:'hidden' }}>{children}</div>
    </div>
  );
}

function RightSection({ title, children }) {
  return (
    <div style={{ marginBottom:16, paddingBottom:16, borderBottom:'1px solid #1e2030' }}>
      <div style={{ fontSize:11, color:'#a855f7', fontWeight:700, marginBottom:8 }}>{title}</div>
      {children}
    </div>
  );
}

function Spinner({ size=24 }) {
  return <div style={{ width:size, height:size, border:`${Math.max(2,size/8)}px solid #a855f7`, borderTopColor:'transparent', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />;
}

function formatTime(s) {
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function FormScreen({ selectedAvatar, setSelectedAvatar, customAvatar, handleAvatarUpload, productImage, handleProductUpload, productName, setProductName, productDesc, setProductDesc, applicationArea, setApplicationArea, storyDescription, setStoryDescription, runAgent }) {
  return (
    <div style={{ minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:'system-ui', direction:'rtl' }}>
      <div style={{ maxWidth:680, margin:'0 auto', padding:'40px 20px' }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <h1 style={{ fontSize:36, fontWeight:800, background:'linear-gradient(135deg,#a855f7,#ec4899)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', margin:0 }}>🎬 UGC Studio</h1>
          <p style={{ color:'#888', marginTop:8 }}>צור סרטוני UGC ויראליים עם AI</p>
        </div>

        <Section title="👤 בחר אווטאר">
          <div style={{ display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:8, marginBottom:12 }}>
            {AVATARS.map(a => (
              <div key={a.id} onClick={()=>setSelectedAvatar(a)} style={{ cursor:'pointer', borderRadius:10, overflow:'hidden', border:selectedAvatar?.id===a.id?'3px solid #a855f7':'3px solid transparent' }}>
                <img src={a.url} alt={a.name} style={{ width:'100%', aspectRatio:'3/4', objectFit:'cover', display:'block' }} />
              </div>
            ))}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'12px 16px', background:'#1a1a2e', borderRadius:10, border:customAvatar?'2px solid #a855f7':'2px dashed #333' }}>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{ display:'none' }} />
            {customAvatar?<img src={customAvatar} style={{ width:44, height:44, borderRadius:8, objectFit:'cover' }} />:<span style={{ fontSize:22 }}>📷</span>}
            <span style={{ color:'#aaa', fontSize:14 }}>{customAvatar?'✅ אווטאר אישי הועלה':'העלה אווטאר אישי'}</span>
          </label>
        </Section>

        <Section title="📦 תמונת מוצר">
          <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'12px 16px', background:'#1a1a2e', borderRadius:10, border:productImage?'2px solid #a855f7':'2px dashed #333' }}>
            <input type="file" accept="image/*" onChange={handleProductUpload} style={{ display:'none' }} />
            {productImage?<img src={productImage} style={{ width:44, height:44, borderRadius:8, objectFit:'cover' }} />:<span style={{ fontSize:22 }}>🛍️</span>}
            <span style={{ color:'#aaa', fontSize:14 }}>{productImage?'✅ תמונת מוצר הועלתה':'העלה תמונת מוצר'}</span>
          </label>
        </Section>

        <Section title="✍️ פרטי המוצר">
          <Input label="שם המוצר *" value={productName} onChange={e=>setProductName(e.target.value)} placeholder="מדבקות הלבנת שיניים FRAKO" />
          <Input label="מה המוצר פותר" value={productDesc} onChange={e=>setProductDesc(e.target.value)} placeholder="מלבין שיניים תוך 7 ימים, ללא רגישות" />
          <Input label="איך משתמשים" value={applicationArea} onChange={e=>setApplicationArea(e.target.value)} placeholder="מניחים על השיניים 30 דקות, מסירים ושוטפים" />
        </Section>

        <Section title="🎭 תאר את הסיפור (אופציונלי)">
          <div style={{ fontSize:12, color:'#666', marginBottom:10 }}>
            תאר אירועים, סגנון, או רעיון ספציפי שאתה רוצה — למשל: "מותג בגדים, אישה בחנות מנסה שמלה ומתאהבת בה" או "גבר בחדר כושר מגלה כמסי כוח חדש לאחר נטילת התוסף"
          </div>
          <textarea
            value={storyDescription}
            onChange={e=>setStoryDescription(e.target.value)}
            placeholder="כתוב כאן את הסיפור שאתה רוצה..."
            rows={3}
            style={{ width:'100%', padding:'12px 14px', background:'#0a0a0f', border:'1px solid #2a2a3e', borderRadius:10, color:'#fff', fontSize:14, outline:'none', boxSizing:'border-box', resize:'vertical', fontFamily:'system-ui' }}
          />
        </Section>

        <button onClick={runAgent} style={{ width:'100%', padding:'18px', fontSize:18, fontWeight:700, background:'linear-gradient(135deg,#a855f7,#ec4899)', color:'#fff', border:'none', borderRadius:14, cursor:'pointer', marginTop:8 }}>
          🎬 צור 4 סצנות UGC עכשיו
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ background:'#111', borderRadius:14, padding:20, marginBottom:16, border:'1px solid #1a1a2e' }}>
      <div style={{ fontWeight:700, fontSize:15, marginBottom:14 }}>{title}</div>
      {children}
    </div>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block', fontSize:13, color:'#888', marginBottom:6 }}>{label}</label>
      <input value={value} onChange={onChange} placeholder={placeholder} style={{ width:'100%', padding:'12px 14px', background:'#0a0a0f', border:'1px solid #2a2a3e', borderRadius:10, color:'#fff', fontSize:14, outline:'none', boxSizing:'border-box' }} />
    </div>
  );
}
