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

const SCENE_DURATIONS = [5, 5, 5, 5];
const TOTAL_DURATION = 20;
const SCENE_STARTS = [0, 5, 10, 15];

const MUSIC_TRACKS = [
  { id: 0, name: 'ללא מוזיקה', url: null, emoji: '🔇' },
  { id: 1, name: 'Happy Pop', url: 'https://raw.githubusercontent.com/effacestudios/Royalty-Free-Music-Pack/master/Happy%20Life.mp3', emoji: '🎵' },
  { id: 2, name: 'Energetic', url: 'https://raw.githubusercontent.com/effacestudios/Royalty-Free-Music-Pack/master/Sports%20Spirit.mp3', emoji: '⚡' },
  { id: 3, name: 'Commercial', url: 'https://raw.githubusercontent.com/effacestudios/Royalty-Free-Music-Pack/master/commercial.mp3', emoji: '🔥' },
  { id: 4, name: 'Party Vibes', url: 'https://raw.githubusercontent.com/effacestudios/Royalty-Free-Music-Pack/master/Party%20Time.mp3', emoji: '🎶' },
  { id: 5, name: 'Starter', url: 'https://raw.githubusercontent.com/effacestudios/Royalty-Free-Music-Pack/master/Starter.mp3', emoji: '🎧' },
];

const proxyUrl = (url) => url ? `/api/proxy?url=${encodeURIComponent(url)}` : null;

// ─── Client-side helpers ──────────────────────────────────────────────────────

// Full client-side export: plays all scenes sequentially on a Canvas,
// burns subtitles via drawImage, mixes audio via Web Audio API → MediaRecorder → Blob.
// Zero server calls — no FFmpeg, no fal.ai merge.
async function exportVideoClientSide(videoUrls, subtitles, durations, audioBase64, musicUrl, onProgress, voiceoverDuration) {
  return new Promise(async (resolve, reject) => {
    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    // ── Audio setup ─────────────────────────────────────────────────────────
    const AC = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AC();
    const dest = audioCtx.createMediaStreamDestination();
    let voiceBuf = null, musicBuf = null;

    if (audioBase64) {
      try {
        const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        voiceBuf = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
      } catch(e) { console.warn('Voice decode:', e.message); }
    }
    if (musicUrl) {
      try {
        const buf = await (await fetch(musicUrl)).arrayBuffer();
        musicBuf = await audioCtx.decodeAudioData(buf);
      } catch(e) { console.warn('Music decode:', e.message); }
    }

    // ── MediaRecorder on canvas + audio stream ───────────────────────────────
    const canvasStream = canvas.captureStream(30);
    dest.stream.getAudioTracks().forEach(t => canvasStream.addTrack(t));

    const mimeType = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']
      .find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';

    const chunks = [];
    const recorder = new MediaRecorder(canvasStream, { mimeType, videoBitsPerSecond: 6_000_000 });
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => { audioCtx.close(); resolve(new Blob(chunks, { type: mimeType })); };

    // ── Subtitle drawing ─────────────────────────────────────────────────────
    const drawSubtitle = (text) => {
      if (!text) return;
      const fontSize = Math.round(H * 0.028);
      ctx.save();
      ctx.direction = 'rtl';
      ctx.font = `bold ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const textX = W / 2, textY = H - 100;
      const m = ctx.measureText(text), pad = 20;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      const bx = textX - m.width/2 - pad, by = textY - fontSize - 8;
      const bw = m.width + pad*2, bh = fontSize + 24;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,8); ctx.fill(); }
      else ctx.fillRect(bx,by,bw,bh);
      ctx.fillStyle = '#fff'; ctx.fillText(text, textX, textY);
      ctx.restore();
    };

    // ── Scene queue ──────────────────────────────────────────────────────────
    // Build voice-synced timings for export if we have real voiceover duration
    const voiceTimingsExport = voiceoverDuration ? buildVoiceTimings(subtitles, voiceoverDuration) : null;

    const scenes = videoUrls
      .map((url, i) => ({ url, sub: subtitles[i]||'', dur: durations[i]||5, idx: i }))
      .filter(s => s.url);

    let absoluteTimeOffset = 0; // track absolute time across scenes for voice sync

    const playScene = (si) => {
      if (si >= scenes.length) { recorder.stop(); return; }
      const sc = scenes[si];
      onProgress && onProgress(`🎬 מייצא סצנה ${sc.idx+1}/${scenes.length}...`);

      // Calculate absolute time offset for this scene
      absoluteTimeOffset = 0;
      for (let j = 0; j < sc.idx; j++) absoluteTimeOffset += (durations[j] || 5);

      const fallbackTimings = getWordTimings(sc.sub);
      const sceneVoiceTimings = voiceTimingsExport ? voiceTimingsExport[sc.idx] : null;

      const vid = document.createElement('video');
      vid.muted = true; vid.crossOrigin = 'anonymous'; vid.playsInline = true;
      let ivId = null;

      const next = () => { if (ivId) clearInterval(ivId); playScene(si+1); };
      vid.addEventListener('ended', next);
      vid.onerror = () => next();

      vid.onloadedmetadata = () => {
        vid.currentTime = 0;
        vid.play().catch(() => next());
        ivId = setInterval(() => {
          if (vid.readyState < 2) return;
          if (vid.ended || vid.currentTime >= sc.dur + 0.15) { next(); return; }
          ctx.drawImage(vid, 0, 0, W, H);
          let visibleWords;
          if (sceneVoiceTimings && sceneVoiceTimings.length > 0) {
            const absTime = absoluteTimeOffset + vid.currentTime;
            visibleWords = sceneVoiceTimings.filter(t => absTime >= t.startTime).map(t => t.word).join(' ');
          } else {
            const frac = Math.min(vid.currentTime / sc.dur, 1);
            visibleWords = fallbackTimings.filter(t => frac >= t.startFrac).map(t => t.word).join(' ');
          }
          drawSubtitle(visibleWords || '');
        }, 33);
      };
      vid.src = `/api/proxy?url=${encodeURIComponent(sc.url)}`;
    };

    try {
      // Start audio sources just before recording begins
      recorder.start(100);
      if (voiceBuf) {
        const src = audioCtx.createBufferSource(); src.buffer = voiceBuf;
        const g = audioCtx.createGain(); g.gain.value = 1.0;
        src.connect(g); g.connect(dest); src.start(0);
      }
      if (musicBuf) {
        const src = audioCtx.createBufferSource(); src.buffer = musicBuf; src.loop = true;
        const g = audioCtx.createGain(); g.gain.value = voiceBuf ? 0.15 : 1.0;
        src.connect(g); g.connect(dest); src.start(0);
      }
      playScene(0);
    } catch(e) { reject(e); }
  });
}

// Encode an AudioBuffer as a WAV Blob
function audioBufferToWav(buffer) {
  const ch = Math.min(buffer.numberOfChannels, 2);
  const sr = buffer.sampleRate;
  const len = buffer.length;
  const ab = new ArrayBuffer(44 + len * ch * 2);
  const v = new DataView(ab);
  const w4 = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w4(0, 'RIFF'); v.setUint32(4, 36 + len * ch * 2, true);
  w4(8, 'WAVE'); w4(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w4(36, 'data'); v.setUint32(40, len * ch * 2, true);
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      v.setInt16(off, s < 0 ? s * 32768 : s * 32767, true); off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

// Mix voiceover (base64 mp3) + background music (URL) into a single WAV Blob
// using the Web Audio OfflineAudioContext — no server RAM required.
async function mixAudioTracks(audioBase64, musicUrl) {
  const AC = window.AudioContext || window.webkitAudioContext;
  let voiceBuf = null, musicBuf = null;

  if (audioBase64) {
    try {
      const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
      const tmp = new AC(); voiceBuf = await tmp.decodeAudioData(bytes.buffer.slice(0)); tmp.close();
    } catch (e) { console.warn('Voice decode failed:', e.message); }
  }
  if (musicUrl) {
    try {
      const buf = await (await fetch(musicUrl)).arrayBuffer();
      const tmp = new AC(); musicBuf = await tmp.decodeAudioData(buf); tmp.close();
    } catch (e) { console.warn('Music decode failed:', e.message); }
  }

  if (!voiceBuf && !musicBuf) return null;

  // Only voiceover — skip mixing, return original bytes
  if (voiceBuf && !musicBuf) {
    const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
    return new Blob([bytes], { type: 'audio/mpeg' });
  }

  const sampleRate = 44100;
  const totalSamples = sampleRate * 25; // 25s video
  const offCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

  if (voiceBuf) {
    const src = offCtx.createBufferSource(); src.buffer = voiceBuf;
    const gain = offCtx.createGain(); gain.gain.value = 1.0;
    src.connect(gain); gain.connect(offCtx.destination); src.start(0);
  }
  if (musicBuf) {
    const src = offCtx.createBufferSource(); src.buffer = musicBuf; src.loop = true;
    const gain = offCtx.createGain(); gain.gain.value = voiceBuf ? 0.15 : 1.0;
    src.connect(gain); gain.connect(offCtx.destination); src.start(0);
  }

  const mixed = await offCtx.startRendering();
  return audioBufferToWav(mixed);
}

// ─────────────────────────────────────────────────────────────────────────────

function getSceneFromTime(t) {
  for (let i = SCENE_STARTS.length - 1; i >= 0; i--) {
    if (t >= SCENE_STARTS[i]) return i;
  }
  return 0;
}

function splitSubtitle(text) {
  if (!text) return ['', ''];
  const words = text.trim().split(' ').filter(Boolean);
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

// Word-level timing: returns array of { word, startFrac, endFrac } where fractions are 0..1 of scene duration
function getWordTimings(text) {
  if (!text) return [];
  const words = text.trim().split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const perWord = 1 / words.length;
  return words.map((word, i) => ({
    word,
    startFrac: i * perWord,
    endFrac: (i + 1) * perWord,
  }));
}

// Build word timings based on actual voiceover audio duration.
// allSubtitles = array of 4 subtitle strings, voiceDuration = real audio seconds.
// Returns per-scene arrays of { word, startTime, endTime } in absolute seconds.
function buildVoiceTimings(allSubtitles, voiceDuration) {
  const allWords = [];
  allSubtitles.forEach((sub, sceneIdx) => {
    const words = (sub || '').trim().split(' ').filter(Boolean);
    words.forEach(w => allWords.push({ word: w, sceneIdx }));
  });
  if (allWords.length === 0 || !voiceDuration) return [[], [], [], []];
  const perWord = voiceDuration / allWords.length;
  const result = [[], [], [], []];
  allWords.forEach((w, i) => {
    result[w.sceneIdx].push({ word: w.word, startTime: i * perWord, endTime: (i + 1) * perWord });
  });
  return result;
}

// Get subtitle text for a scene at absolute time (seconds) using voice-synced timings
function getSubtitleAtTime(timings, absoluteTime) {
  if (!timings || timings.length === 0) return '';
  const visible = timings.filter(t => absoluteTime >= t.startTime);
  return visible.map(t => t.word).join(' ');
}

// Get the subtitle text to display at a given fraction (0..1) of the scene — shows words progressively
function getSubtitleAtFraction(text, fraction) {
  const timings = getWordTimings(text);
  if (timings.length === 0) return '';
  const visible = timings.filter(t => fraction >= t.startFrac);
  return visible.map(t => t.word).join(' ');
}

const PROJECTS_KEY = 'ugc_saved_projects';
function loadProjectsFromStorage() {
  try { return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]'); } catch { return []; }
}

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
  const [selectedMusic, setSelectedMusic] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);
  const [voiceoverDuration, setVoiceoverDuration] = useState(null);

  useEffect(() => { setSavedProjects(loadProjectsFromStorage()); }, []);

  // Decode audio to get real voiceover duration
  useEffect(() => {
    if (!audioBase64) { setVoiceoverDuration(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const bytes = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0));
        const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
        if (!cancelled) setVoiceoverDuration(buf.duration);
        ctx.close();
      } catch (e) { console.warn('Audio duration decode error:', e.message); }
    })();
    return () => { cancelled = true; };
  }, [audioBase64]);

  const saveProject = () => {
    if (!videoUrls.some(Boolean)) return alert('אין סרטונים לשמירה');
    const project = {
      id: Date.now(),
      productName: productName || 'פרויקט ללא שם',
      timestamp: new Date().toISOString(),
      videoUrls,
      audioBase64,
      editSubtitles,
      scenes,
      voiceover,
      selectedMusic,
      frameUrls,
      thumbnail: frameUrls.find(Boolean) || null,
    };
    const existing = loadProjectsFromStorage();
    const updated = [project, ...existing].slice(0, 10); // max 10
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(updated));
    setSavedProjects(updated);
    alert(`✅ הפרויקט "${project.productName}" נשמר!`);
  };

  const loadProject = (project) => {
    setProductName(project.productName || '');
    setVideoUrls(project.videoUrls || [null,null,null,null]);
    setAudioBase64(project.audioBase64 || null);
    setEditSubtitles(project.editSubtitles || ['','','','']);
    setScenes(project.scenes || []);
    setVoiceover(project.voiceover || '');
    setSelectedMusic(project.selectedMusic || 0);
    setFrameUrls(project.frameUrls || [null,null,null,null]);
    setKlingStatus(project.videoUrls.map(u => u ? 'done' : 'idle'));
    setLogs([{ msg: `📂 פרויקט "${project.productName}" נטען`, type: 'success', time: new Date().toLocaleTimeString('he-IL') }]);
    setProgress(100);
    setScreen('editor');
  };

  const deleteProject = (id) => {
    const updated = loadProjectsFromStorage().filter(p => p.id !== id);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(updated));
    setSavedProjects(updated);
  };

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
    addLog(`🎬 Kling — סצנה ${index+1} (${SCENE_DURATIONS[index]}s)...`);
    try {
      const res = await fetch('/api/kling', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: frameUrl, prompt: klingPrompt, sceneIndex: index, duration: String(SCENE_DURATIONS[index]) })
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
      addLog(`❌ שגיאה: ${e.message}`, 'error');
    }
  }, []);

  const exportFinal = async () => {
    if (!videoUrls.some(Boolean)) return alert('אין סרטונים לייצוא');
    setIsExporting(true);
    addLog('📦 מייצא סרטון — עובד בדפדפן, אין צורך בשרת...', 'start');
    try {
      const musicTrack = MUSIC_TRACKS[selectedMusic];
      const blob = await exportVideoClientSide(
        videoUrls,
        editSubtitles,
        SCENE_DURATIONS,
        audioBase64,
        musicTrack?.url || null,
        (msg) => addLog(msg),
        voiceoverDuration
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'ugc_final.webm'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      addLog('✅ סרטון הורד בהצלחה!', 'success');
    } catch (e) {
      addLog(`❌ ייצוא נכשל: ${e.message}`, 'error');
    }
    setIsExporting(false);
  };

  const runAgent = async () => {
    if (!productName.trim()) return alert('נא להכניס שם מוצר');
    const avatarUrl = customAvatar || selectedAvatar?.url || null;
    if (!avatarUrl) return alert('נא לבחור אווטאר');
    setLogs([]); setProgress(0); setScenes([]); setVoiceover('');
    setAudioBase64(null); setFrameUrls([null,null,null,null]);
    setVideoUrls([null,null,null,null]); setKlingStatus(['idle','idle','idle','idle']);
    setEditSubtitles(['','','','']); setIsGenerating(true); setScreen('editor');
    addLog('🚀 מתחיל...', 'start');
    try {
      const res = await fetch('/api/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productName, productDesc, applicationArea, storyDescription, avatarUrl, productImageUrl: productImage||null, sceneDurations: SCENE_DURATIONS })
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer='', finalFrameUrls=[null,null,null,null], finalKlingPrompts=[], finalScenes=[];
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
            if (data.message) addLog(data.message, data.step?.includes('fail')?'error':'info');
            if (data.scenes) { setScenes(data.scenes); finalScenes=data.scenes; setEditSubtitles(data.scenes.map(s=>s.subtitle||'')); }
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
    } catch (e) { addLog(`❌ ${e.message}`, 'error'); }
    setIsGenerating(false);
  };

  if (screen === 'form') return <FormScreen {...{selectedAvatar,setSelectedAvatar,customAvatar,handleAvatarUpload,productImage,handleProductUpload,productName,setProductName,productDesc,setProductDesc,applicationArea,setApplicationArea,storyDescription,setStoryDescription,runAgent,savedProjects,loadProject,deleteProject}} />;

  const totalDone = videoUrls.filter(Boolean).length;
  const allDone = !isGenerating && klingStatus.every(s => s==='done'||s==='error');

  return <EditorScreen {...{isGenerating,logs,progress,scenes,voiceover,audioBase64,frameUrls,videoUrls,klingStatus,activeScene,setActiveScene,editSubtitles,setEditSubtitles,allDone,totalDone,selectedMusic,setSelectedMusic,isExporting,exportFinal,saveProject,voiceoverDuration,onNew:()=>setScreen('form')}} />;
}

function EditorScreen({ isGenerating, logs, progress, scenes, voiceover, audioBase64, frameUrls, videoUrls, klingStatus, activeScene, setActiveScene, editSubtitles, setEditSubtitles, allDone, totalDone, selectedMusic, setSelectedMusic, isExporting, exportFinal, saveProject, voiceoverDuration, onNew }) {
  const audioRef = useRef(null);
  const musicRef = useRef(null);
  const videoRefs = useRef([null,null,null,null]);
  const [showLogs, setShowLogs] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [subtitleHalf, setSubtitleHalf] = useState(0);
  const logsEndRef = useRef(null);
  const animFrameRef = useRef(null);
  const playStartRef = useRef(null);
  const proxiedUrls = useRef([null,null,null,null]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [logs]);
  useEffect(() => { proxiedUrls.current = videoUrls.map(u => proxyUrl(u)); }, [videoUrls]);

  // Update which subtitle half to show based on time within scene
  useEffect(() => {
    const sceneStart = SCENE_STARTS[activeScene];
    const sceneDur = SCENE_DURATIONS[activeScene];
    const t = currentTime - sceneStart;
    setSubtitleHalf(t < sceneDur / 2 ? 0 : 1);
  }, [currentTime, activeScene]);

  // Word-level fraction within current scene
  const sceneFraction = (() => {
    const sceneStart = SCENE_STARTS[activeScene];
    const sceneDur = SCENE_DURATIONS[activeScene];
    const t = Math.max(0, currentTime - sceneStart);
    return Math.min(t / sceneDur, 1);
  })();

  const stopAll = useCallback(() => {
    setIsPlaying(false);
    cancelAnimationFrame(animFrameRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    if (musicRef.current) { musicRef.current.pause(); musicRef.current.currentTime = 0; }
    videoRefs.current.forEach(v => { if (v) { v.pause(); v.currentTime = 0; } });
    setCurrentTime(0); setActiveScene(0); setSubtitleHalf(0);
  }, [setActiveScene]);

  const playAll = useCallback(() => {
    if (!videoUrls.some(Boolean)) return;
    stopAll();
    setTimeout(() => {
      setIsPlaying(true);
      playStartRef.current = performance.now();
      if (audioRef.current && audioBase64) { audioRef.current.currentTime=0; audioRef.current.volume=1.0; audioRef.current.play().catch(()=>{}); }
      const mt = MUSIC_TRACKS[selectedMusic];
      if (musicRef.current && mt?.url) { musicRef.current.currentTime=0; musicRef.current.volume=0.15; musicRef.current.play().catch(()=>{}); }
      let curScene = 0;
      const first = videoUrls.findIndex(Boolean);
      if (first >= 0 && videoRefs.current[first]) { setActiveScene(first); videoRefs.current[first].currentTime=0; videoRefs.current[first].play().catch(()=>{}); }
      const tick = () => {
        const elapsed = (performance.now() - playStartRef.current) / 1000;
        setCurrentTime(elapsed);
        const si = getSceneFromTime(elapsed);
        if (si !== curScene) {
          if (videoRefs.current[curScene]) { videoRefs.current[curScene].pause(); videoRefs.current[curScene].currentTime=0; }
          if (videoUrls[si] && videoRefs.current[si]) { videoRefs.current[si].currentTime=0; videoRefs.current[si].play().catch(()=>{}); }
          curScene = si; setActiveScene(si);
        }
        if (elapsed >= TOTAL_DURATION) { stopAll(); return; }
        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    }, 50);
  }, [videoUrls, audioBase64, selectedMusic, stopAll, setActiveScene]);

  useEffect(() => () => cancelAnimationFrame(animFrameRef.current), []);

  const audioSrc = audioBase64 ? `data:audio/mpeg;base64,${audioBase64}` : null;
  const musicSrc = MUSIC_TRACKS[selectedMusic]?.url || null;
  const timePercent = Math.min((currentTime / TOTAL_DURATION) * 100, 100);
  const sceneTypes = ['כאב 😤','גילוי 💡','שימוש ✨','CTA 🚀'];
  const klingIcon = (s) => s==='loading'?'⏳':s==='done'?'🎬':s==='error'?'❌':'—';

  // Build voice-synced timings when we have real audio duration
  const voiceTimings = voiceoverDuration ? buildVoiceTimings(editSubtitles, voiceoverDuration) : null;

  const subParts = splitSubtitle(editSubtitles[activeScene]);
  const currentSub = isPlaying
    ? (voiceTimings
        ? getSubtitleAtTime(voiceTimings[activeScene], currentTime)
        : getSubtitleAtFraction(editSubtitles[activeScene], sceneFraction))
    : (subParts[subtitleHalf] || subParts[0] || '');

  return (
    <div style={{ height:'100vh', background:'#0d0e14', color:'#fff', fontFamily:'system-ui', direction:'rtl', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      {/* Top Bar */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 16px', background:'#111318', borderBottom:'1px solid #1e2030', flexShrink:0, height:46 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <button onClick={onNew} style={{ padding:'5px 12px', background:'#1e2030', border:'1px solid #2a2d40', borderRadius:7, color:'#aaa', cursor:'pointer', fontSize:12 }}>← חדש</button>
          <span style={{ fontSize:15, fontWeight:700, background:'linear-gradient(135deg,#a855f7,#ec4899)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent' }}>🎬 UGC Studio</span>
          {isGenerating && <span style={{ fontSize:11, color:'#a855f7' }}>● מעבד...</span>}
          {!isGenerating && klingStatus.some(s=>s==='loading') && <span style={{ fontSize:11, color:'#f59e0b' }}>🎬 Kling... ({totalDone}/4)</span>}
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
          {videoUrls.some(Boolean) && (
            <>
              <button onClick={saveProject}
                style={{ padding:'5px 12px', background:'#0f2a1a', border:'1px solid #22c55e', borderRadius:7, color:'#22c55e', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                💾 שמור
              </button>
              <button onClick={exportFinal} disabled={isExporting}
                style={{ padding:'5px 14px', background:isExporting?'#4a1a5e':'linear-gradient(135deg,#a855f7,#ec4899)', border:'none', borderRadius:7, color:'#fff', cursor:isExporting?'wait':'pointer', fontSize:12, fontWeight:700, opacity:isExporting?0.7:1 }}>
                {isExporting?'⏳ מייצר...':'⬇️ ייצא הכל'}
              </button>
            </>
          )}
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
        {/* Left */}
        <div style={{ width:155, background:'#111318', borderLeft:'1px solid #1e2030', overflow:'auto', padding:10, flexShrink:0 }}>
          <div style={{ fontSize:10, color:'#374151', fontWeight:700, marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>מדיה</div>
          {[0,1,2,3].map(i => (
            <div key={i} onClick={()=>setActiveScene(i)} style={{ borderRadius:8, overflow:'hidden', marginBottom:10, cursor:'pointer', border:activeScene===i?'2px solid #a855f7':'2px solid transparent', background:'#0d0e14', position:'relative' }}>
              {frameUrls[i] ? <img src={frameUrls[i]} style={{ width:'100%', aspectRatio:'9/16', objectFit:'cover', display:'block' }} />
                : <div style={{ width:'100%', aspectRatio:'9/16', display:'flex', alignItems:'center', justifyContent:'center', background:'#111318' }}>{isGenerating?<Spinner size={20}/>:<span style={{ color:'#374151', fontSize:20 }}>□</span>}</div>}
              <div style={{ position:'absolute', top:4, left:4, fontSize:12 }}>{klingIcon(klingStatus[i])}</div>
              <div style={{ padding:'4px 6px', fontSize:10, color:'#9ca3af', display:'flex', justifyContent:'space-between' }}>
                <span>{scenes[i]?.type||sceneTypes[i]}</span>
                <span style={{ color:'#4b5563' }}>{SCENE_DURATIONS[i]}s</span>
              </div>
            </div>
          ))}
        </div>

        {/* Center */}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0b10', padding:16 }}>
          <div style={{ position:'relative', height:'100%', maxHeight:500, aspectRatio:'9/16', background:'#000', borderRadius:12, overflow:'hidden', boxShadow:'0 0 60px rgba(168,85,247,0.15)' }}>
            {[0,1,2,3].map(i => (
              <video key={i} ref={el=>videoRefs.current[i]=el} src={proxiedUrls.current[i]||undefined}
                style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:activeScene===i&&videoUrls[i]?'block':'none' }}
                playsInline crossOrigin="anonymous" />
            ))}
            {!videoUrls[activeScene] && (
              frameUrls[activeScene] ? <img src={frameUrls[activeScene]} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                : <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
                    {isGenerating?<><Spinner size={40}/><span style={{ color:'#374151', fontSize:13 }}>מייצר...</span></>:<span style={{ fontSize:48 }}>🎬</span>}
                  </div>
            )}
            {/* Alternating subtitle - one box at a time */}
            {currentSub && (
              <div style={{ position:'absolute', bottom:40, left:0, right:0, display:'flex', justifyContent:'center', padding:'0 16px' }}>
                <div key={`${activeScene}-${subtitleHalf}`}
                  style={{ background:'rgba(0,0,0,0.82)', color:'#fff', padding:'8px 18px', borderRadius:8, fontSize:17, fontWeight:800, textAlign:'center', textShadow:'0 1px 4px rgba(0,0,0,0.9)', maxWidth:'88%', animation:'fadeIn 0.25s ease' }}>
                  {currentSub}
                </div>
              </div>
            )}
            <div style={{ position:'absolute', top:8, right:8, background:'rgba(0,0,0,0.7)', borderRadius:5, padding:'2px 8px', fontSize:10, color:'#a855f7' }}>
              {klingStatus[activeScene]==='loading'?'🎬 Kling...':klingStatus[activeScene]==='done'?'✅':frameUrls[activeScene]?'🎨':'⏳'}
            </div>
          </div>
        </div>

        {/* Right */}
        <div style={{ width:255, background:'#111318', borderRight:'1px solid #1e2030', overflow:'auto', padding:14, flexShrink:0 }}>
          <div style={{ fontSize:10, color:'#374151', fontWeight:700, marginBottom:12, textTransform:'uppercase', letterSpacing:1 }}>עריכה</div>
          <RightSection title="🎵 מוזיקת רקע">
            {MUSIC_TRACKS.map(t => (
              <div key={t.id} onClick={()=>setSelectedMusic(t.id)} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 10px', marginBottom:5, borderRadius:7, cursor:'pointer', background:selectedMusic===t.id?'#1a0a2e':'#0d0e14', border:`1px solid ${selectedMusic===t.id?'#a855f7':'#1e2030'}` }}>
                <span style={{ fontSize:14 }}>{t.emoji}</span>
                <span style={{ fontSize:12, color:selectedMusic===t.id?'#c4b5fd':'#9ca3af' }}>{t.name}</span>
                {selectedMusic===t.id && <span style={{ marginRight:'auto', fontSize:10, color:'#a855f7' }}>✓</span>}
              </div>
            ))}
          </RightSection>
          <RightSection title="💬 כתוביות">
            {[0,1,2,3].map(i => {
              const parts = splitSubtitle(editSubtitles[i]);
              return (
                <div key={i} style={{ marginBottom:10 }}>
                  <div style={{ fontSize:10, color:'#4b5563', marginBottom:3 }}>{scenes[i]?.type||sceneTypes[i]} <span style={{ color:'#374151' }}>({SCENE_DURATIONS[i]}s)</span></div>
                  <input value={editSubtitles[i]||''} onChange={e=>{const n=[...editSubtitles];n[i]=e.target.value;setEditSubtitles(n);}}
                    style={{ width:'100%', padding:'6px 9px', background:'#0d0e14', border:'1px solid #1e2030', borderRadius:7, color:'#e5e7eb', fontSize:12, boxSizing:'border-box', outline:'none', marginBottom:4 }}
                    placeholder="ערוך כתובית..." />
                  <div style={{ display:'flex', gap:4, fontSize:10 }}>
                    <span style={{ flex:1, background:'#1a0f2e', padding:'2px 5px', borderRadius:4, color:'#a78bfa', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>1: {parts[0]||'—'}</span>
                    <span style={{ flex:1, background:'#130f2e', padding:'2px 5px', borderRadius:4, color:'#7c3aed', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>2: {parts[1]||'—'}</span>
                  </div>
                </div>
              );
            })}
          </RightSection>
          {voiceover && <RightSection title="📝 סקריפט"><p style={{ fontSize:11, color:'#9ca3af', lineHeight:1.7, margin:0 }}>{voiceover}</p></RightSection>}
          <RightSection title="⬇️ סצנות בנפרד">
            {[0,1,2,3].map(i => videoUrls[i]
              ? <a key={i} href={proxyUrl(videoUrls[i])} download={`scene_${i+1}.mp4`} style={{ display:'block', padding:'7px 10px', marginBottom:6, background:'#0f1f0f', border:'1px solid #22c55e', borderRadius:7, color:'#22c55e', textDecoration:'none', fontSize:12, textAlign:'center' }}>⬇️ סצנה {i+1} ({SCENE_DURATIONS[i]}s)</a>
              : <div key={i} style={{ padding:'7px 10px', marginBottom:6, background:'#111318', border:'1px solid #1e2030', borderRadius:7, color:'#374151', fontSize:12, textAlign:'center' }}>{klingStatus[i]==='loading'?`⏳ סצנה ${i+1}...`:`— סצנה ${i+1}`}</div>
            )}
          </RightSection>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ height:170, background:'#0a0b0f', borderTop:'2px solid #1e2030', flexShrink:0, display:'flex', flexDirection:'column' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', borderBottom:'1px solid #1e2030' }}>
          <button onClick={isPlaying?stopAll:playAll} style={{ width:32, height:32, borderRadius:'50%', background:'linear-gradient(135deg,#a855f7,#ec4899)', border:'none', color:'#fff', cursor:'pointer', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>{isPlaying?'⏸':'▶'}</button>
          <button onClick={stopAll} style={{ width:28, height:28, borderRadius:'50%', background:'#1e2030', border:'1px solid #2a2d40', color:'#aaa', cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center' }}>⏹</button>
          <span style={{ fontSize:12, color:'#6b7280', minWidth:90 }}>{formatTime(currentTime)} / {formatTime(TOTAL_DURATION)}</span>
          {audioSrc && <audio ref={audioRef} src={audioSrc} style={{ display:'none' }} />}
          {musicSrc && <audio ref={musicRef} src={musicSrc} loop style={{ display:'none' }} />}
          <div style={{ flex:1, height:4, background:'#1e2030', borderRadius:2, position:'relative', cursor:'pointer' }}
            onClick={e => { const rect=e.currentTarget.getBoundingClientRect(); const t=((e.clientX-rect.left)/rect.width)*TOTAL_DURATION; setCurrentTime(t); setActiveScene(getSceneFromTime(t)); }}>
            <div style={{ height:'100%', width:`${timePercent}%`, background:'linear-gradient(90deg,#a855f7,#ec4899)', borderRadius:2 }} />
            <div style={{ position:'absolute', top:-4, left:`${timePercent}%`, width:12, height:12, background:'#a855f7', borderRadius:'50%', transform:'translateX(-50%)', border:'2px solid #0a0b0f' }} />
          </div>
          {selectedMusic > 0 && <span style={{ fontSize:11, color:'#a855f7' }}>{MUSIC_TRACKS[selectedMusic].emoji}</span>}
        </div>

        <div style={{ flex:1, padding:'8px 16px', display:'flex', flexDirection:'column', gap:4, overflow:'hidden' }}>
          {/* Ruler */}
          <div style={{ display:'flex', height:14 }}>
            <div style={{ width:70, flexShrink:0 }} />
            <div style={{ flex:1, position:'relative' }}>
              {SCENE_STARTS.map((s,i) => (
                <div key={i} style={{ position:'absolute', left:`${(s/TOTAL_DURATION)*100}%`, fontSize:9, color:'#4b5563' }}>{s}s</div>
              ))}
              <div style={{ position:'absolute', right:0, fontSize:9, color:'#374151' }}>{TOTAL_DURATION}s</div>
              <div style={{ position:'absolute', top:0, left:`${timePercent}%`, width:1, height:200, background:'#a855f7', zIndex:10, opacity:0.8, pointerEvents:'none' }} />
            </div>
          </div>

          {/* Video track — proportional */}
          <div style={{ display:'flex', alignItems:'stretch', height:32, gap:6 }}>
            <div style={{ width:70, flexShrink:0, display:'flex', alignItems:'center', fontSize:10, color:'#4b5563', fontWeight:600 }}>🎬 וידאו</div>
            <div style={{ flex:1, display:'flex', gap:2 }}>
              {[0,1,2,3].map(i => (
                <div key={i} onClick={()=>setActiveScene(i)}
                  style={{ flex:SCENE_DURATIONS[i], height:'100%', borderRadius:5, overflow:'hidden', cursor:'pointer', border:activeScene===i?'2px solid #a855f7':'2px solid transparent', background:'#150e2a', position:'relative', display:'flex', alignItems:'center', gap:3, padding:'0 4px' }}>
                  {frameUrls[i] && <img src={frameUrls[i]} style={{ height:'80%', aspectRatio:'9/16', objectFit:'cover', borderRadius:3, flexShrink:0 }} />}
                  <span style={{ fontSize:8, color:videoUrls[i]?'#c4b5fd':klingStatus[i]==='loading'?'#f59e0b':'#4b3080', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                    {videoUrls[i]?(scenes[i]?.type||`${i+1}`):klingStatus[i]==='loading'?'⏳':frameUrls[i]?'📷':'—'}
                  </span>
                  <span style={{ position:'absolute', bottom:1, right:2, fontSize:8, color:'#4b3080' }}>{SCENE_DURATIONS[i]}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Audio */}
          <div style={{ display:'flex', alignItems:'stretch', height:26, gap:6 }}>
            <div style={{ width:70, flexShrink:0, display:'flex', alignItems:'center', fontSize:10, color:'#4b5563', fontWeight:600 }}>🎙️ קול</div>
            <div style={{ flex:1, borderRadius:5, background:audioBase64?'#0a1f0f':'#0a100c', border:`1px solid ${audioBase64?'#22c55e':'#1e2030'}`, display:'flex', alignItems:'center', padding:'0 10px', gap:6, overflow:'hidden' }}>
              {audioBase64 ? (
                <>
                  <div style={{ display:'flex', alignItems:'center', gap:1, height:'70%' }}>
                    {Array.from({length:60}).map((_,j) => { const h=20+Math.sin(j*0.6)*18+Math.sin(j*1.4)*10; const active=(j/60)<(currentTime/TOTAL_DURATION); return <div key={j} style={{ width:2, height:`${h}%`, background:active?'#22c55e':'#14532d', borderRadius:1 }} />; })}
                  </div>
                  <span style={{ fontSize:10, color:'#22c55e', fontWeight:600, whiteSpace:'nowrap' }}>קריינות V3 — {TOTAL_DURATION}s</span>
                </>
              ) : <span style={{ fontSize:11, color:'#374151' }}>{isGenerating?'⏳...':'—'}</span>}
            </div>
          </div>

          {/* Music */}
          {selectedMusic > 0 && (
            <div style={{ display:'flex', alignItems:'stretch', height:22, gap:6 }}>
              <div style={{ width:70, flexShrink:0, display:'flex', alignItems:'center', fontSize:10, color:'#4b5563', fontWeight:600 }}>🎵 מוזיקה</div>
              <div style={{ flex:1, borderRadius:5, background:'#0a0a1f', border:'1px solid #312e81', display:'flex', alignItems:'center', padding:'0 10px' }}>
                <span style={{ fontSize:10, color:'#818cf8' }}>{MUSIC_TRACKS[selectedMusic].name} (15%)</span>
              </div>
            </div>
          )}

          {/* Subtitles — 2 halves per scene */}
          <div style={{ display:'flex', alignItems:'stretch', height:22, gap:6 }}>
            <div style={{ width:70, flexShrink:0, display:'flex', alignItems:'center', fontSize:10, color:'#4b5563', fontWeight:600 }}>💬 כתובית</div>
            <div style={{ flex:1, display:'flex', gap:2 }}>
              {[0,1,2,3].map(i => {
                const parts = splitSubtitle(editSubtitles[i]);
                return (
                  <div key={i} style={{ flex:SCENE_DURATIONS[i], display:'flex', gap:1 }}>
                    <div style={{ flex:1, borderRadius:'4px 0 0 4px', background: activeScene===i&&subtitleHalf===0?'#2a1a4e':'#110e00', border:'1px solid #78350f', display:'flex', alignItems:'center', padding:'0 3px', overflow:'hidden' }}>
                      <span style={{ fontSize:8, color:'#f59e0b', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{parts[0]||'—'}</span>
                    </div>
                    <div style={{ flex:1, borderRadius:'0 4px 4px 0', background: activeScene===i&&subtitleHalf===1?'#2a1a4e':'#0f0b00', border:'1px solid #78350f', borderLeft:'none', display:'flex', alignItems:'center', padding:'0 3px', overflow:'hidden' }}>
                      <span style={{ fontSize:8, color:'#d97706', overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{parts[1]||'—'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}`}</style>
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
  const m=Math.floor(s/60), sec=Math.floor(s%60);
  return `${m}:${sec.toString().padStart(2,'0')}`;
}

function FormScreen({ selectedAvatar, setSelectedAvatar, customAvatar, handleAvatarUpload, productImage, handleProductUpload, productName, setProductName, productDesc, setProductDesc, applicationArea, setApplicationArea, storyDescription, setStoryDescription, runAgent, savedProjects, loadProject, deleteProject }) {
  return (
    <div style={{ minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:'system-ui', direction:'rtl' }}>
      <div style={{ maxWidth:680, margin:'0 auto', padding:'40px 20px' }}>
        <div style={{ textAlign:'center', marginBottom:40 }}>
          <h1 style={{ fontSize:36, fontWeight:800, background:'linear-gradient(135deg,#a855f7,#ec4899)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', margin:0 }}>🎬 UGC Studio</h1>
          <p style={{ color:'#888', marginTop:8 }}>צור סרטוני UGC ויראליים עם AI</p>
        </div>

        {savedProjects.length > 0 && (
          <div style={{ marginBottom:28 }}>
            <div style={{ fontWeight:700, fontSize:15, marginBottom:12, color:'#fff' }}>📂 פרויקטים שמורים</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:10 }}>
              {savedProjects.map(p => (
                <div key={p.id} style={{ background:'#111', border:'1px solid #1e2030', borderRadius:12, overflow:'hidden', position:'relative' }}>
                  {p.thumbnail
                    ? <img src={p.thumbnail} style={{ width:'100%', aspectRatio:'9/16', objectFit:'cover', display:'block' }} />
                    : <div style={{ width:'100%', aspectRatio:'9/16', background:'#1a1a2e', display:'flex', alignItems:'center', justifyContent:'center', fontSize:28 }}>🎬</div>}
                  <div style={{ padding:'8px 10px' }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#e5e7eb', marginBottom:2, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>{p.productName}</div>
                    <div style={{ fontSize:10, color:'#6b7280', marginBottom:8 }}>
                      {new Date(p.timestamp).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'2-digit'})}
                    </div>
                    <div style={{ display:'flex', gap:5 }}>
                      <button onClick={() => loadProject(p)}
                        style={{ flex:1, padding:'5px 0', background:'linear-gradient(135deg,#a855f7,#ec4899)', border:'none', borderRadius:6, color:'#fff', cursor:'pointer', fontSize:11, fontWeight:700 }}>
                        ▶ המשך
                      </button>
                      <button onClick={() => deleteProject(p.id)}
                        style={{ padding:'5px 8px', background:'#1a0a0a', border:'1px solid #7f1d1d', borderRadius:6, color:'#f87171', cursor:'pointer', fontSize:11 }}>
                        🗑
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
          <div style={{ fontSize:12, color:'#666', marginBottom:10 }}>תאר אירועים, סגנון — למשל: "מותג בגדים, אישה בחנות מנסה שמלה"</div>
          <textarea value={storyDescription} onChange={e=>setStoryDescription(e.target.value)} placeholder="כתוב כאן את הסיפור..." rows={3}
            style={{ width:'100%', padding:'12px 14px', background:'#0a0a0f', border:'1px solid #2a2a3e', borderRadius:10, color:'#fff', fontSize:14, outline:'none', boxSizing:'border-box', resize:'vertical', fontFamily:'system-ui' }} />
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
