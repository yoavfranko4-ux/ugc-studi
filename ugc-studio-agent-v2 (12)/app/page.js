'use client'
import { useState, useRef, useEffect } from 'react'

const AVATARS = [
  { url: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&h=600&fit=crop&crop=face', name: 'Maya' },
  { url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=600&fit=crop&crop=face', name: 'Sarah' },
  { url: 'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?w=400&h=600&fit=crop&crop=face', name: 'Noa' },
  { url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&h=600&fit=crop&crop=face', name: 'Dana' },
  { url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=600&fit=crop&crop=face', name: 'Lior' },
  { url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=600&fit=crop&crop=face', name: 'Avi' },
]

const AGENT_STEPS = [
  { id: 'script', icon: '🧠', label: 'Claude כותב את הסיפור — פרומפט לכל סצנה' },
  { id: 'frames', icon: '🎨', label: 'Nano Banana יוצר 4 פריימים מחוברים' },
  { id: 'videos', icon: '🎬', label: 'Kling מחיה 4 סצנות × 5 שניות' },
  { id: 'voice',  icon: '🎙️', label: 'ElevenLabs קריינות עברית V3' },
]

export default function Home() {
  const [step, setStep] = useState('form')
  const [selectedAvatar, setSelectedAvatar] = useState(null)
  const [customAvatar, setCustomAvatar] = useState(null)
  const [productName, setProductName] = useState('')
  const [productDesc, setProductDesc] = useState('')
  const [applicationArea, setApplicationArea] = useState('')
  const [productImage, setProductImage] = useState(null)
  const [falKey, setFalKey] = useState('')
  const [elevenKey, setElevenKey] = useState('')
  const [keysOpen, setKeysOpen] = useState(false)
  // Keys loaded from server env vars on mount
  useEffect(() => {
    fetch('/api/keys').then(r => r.json()).then(d => {
      if (d.fal) setFalKey(d.fal)
      if (d.eleven) setElevenKey(d.eleven)
    }).catch(() => {})
  }, [])
  const [agentStatus, setAgentStatus] = useState({})
  const [result, setResult] = useState(null)
  const [currentScene, setCurrentScene] = useState(0)
  const [logs, setLogs] = useState([])
  const videoRef = useRef(null)
  const audioRef = useRef(null)

  const avatarUrl = customAvatar || selectedAvatar?.url
  const addLog = (msg, type='') => setLogs(p => [...p, {msg, type, t: new Date().toLocaleTimeString('he-IL')}])

  const handleAvatarUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { setCustomAvatar(ev.target.result); setSelectedAvatar(null) }
    reader.readAsDataURL(file)
  }

  const runAgent = async () => {
    const currentCheck = customAvatar || selectedAvatar?.url
    if (!currentCheck) return alert('בחר דמות')
    if (!productName || !productDesc) return alert('הכנס שם ותיאור מוצר')

    setStep('generating')
    setLogs([])
    setAgentStatus({ script: 'active' })
    addLog('🧠 Agent מתחיל לעבוד...')

    try {
      // Recalculate avatarUrl inside the function to get latest value
      const currentAvatarUrl = customAvatar || selectedAvatar?.url
      addLog('Avatar: ' + (currentAvatarUrl ? currentAvatarUrl.slice(0,40) : 'NONE'), currentAvatarUrl ? '' : 'err')
      
      let finalAvatarUrl = currentAvatarUrl
      if (currentAvatarUrl && currentAvatarUrl.startsWith('data:')) {
        addLog('☁️ מעלה אווטאר ל-fal.ai...')
        const [header, base64] = avatarUrl.split(',')
        const mime = header.match(/:(.*?);/)[1]
        const bc = atob(base64), ba = new Uint8Array(bc.length)
        for (let i = 0; i < bc.length; i++) ba[i] = bc.charCodeAt(i)
        const blob = new Blob([ba], { type: mime })
        const fd = new FormData()
        fd.append('file', blob, 'avatar.jpg')
        fd.append('falKey', falKey)
        const up = await fetch('/api/upload', { method: 'POST', body: fd })
        const upData = await up.json()
        finalAvatarUrl = upData.url || upData.access_url
        addLog('✅ אווטאר הועלה', 'ok')
      }

      addLog('🧠 Claude כותב סיפור מחובר ל-4 סצנות...')
      setAgentStatus({ script: 'active' })

      // Upload product image if provided
      let productImageUrl = null
      if (productImage && productImage.startsWith('data:')) {
        const [ph, pb] = productImage.split(',')
        const pm = ph.match(/:(.*?);/)[1]
        const pbc = atob(pb), pba = new Uint8Array(pbc.length)
        for (let i = 0; i < pbc.length; i++) pba[i] = pbc.charCodeAt(i)
        const pblob = new Blob([pba], { type: pm })
        const pfd = new FormData()
        pfd.append('file', pblob, 'product.jpg')
        pfd.append('falKey', falKey)
        addLog('☁️ מעלה תמונת מוצר...')
        const pup = await fetch('/api/upload', { method: 'POST', body: pfd })
        const pupData = await pup.json()
        productImageUrl = pupData.url || pupData.access_url
        addLog('✅ מוצר הועלה', 'ok')
      }

      const agentRes = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: productDesc, productName, applicationArea,
          avatarUrl: customAvatar || selectedAvatar?.url || null,
productImageUrl: productImageUrl || null,
          falKey, elevenKey, voiceId: 'Z3R5wn05IrDiVCyEkUrK'
        })
      })

      if (!agentRes.ok) throw new Error('Agent failed')

      addLog('📦 מקבל תוצאות מה-Agent...', '')
      const data = await agentRes.json()
      
      // Log each scene result
      if (data.frames) {
        data.frames.forEach((f, i) => addLog(f ? `✅ Frame ${i+1}: ${f.slice(0,40)}...` : `❌ Frame ${i+1}: נכשל`, f ? 'ok' : 'err'))
      }
      if (data.videos) {
        data.videos.forEach((v, i) => addLog(v ? `✅ סרטון ${i+1}: ${v.slice(0,40)}...` : `❌ סרטון ${i+1}: נכשל`, v ? 'ok' : 'err'))
      }
      
      setAgentStatus({ script: 'done', frames: 'done', videos: 'done', voice: data.audioBase64 ? 'done' : 'error' })
      addLog(data.audioBase64 ? '✅ קריינות מוכנה!' : '❌ קריינות נכשלה — בדוק ElevenLabs key', data.audioBase64 ? 'ok' : 'err')

      if (data.audioBase64) {
        const blob = new Blob([Uint8Array.from(atob(data.audioBase64), c => c.charCodeAt(0))], { type: 'audio/mpeg' })
        if (audioRef.current) audioRef.current.src = URL.createObjectURL(blob)
        addLog('✅ קריינות מוכנה', 'ok')
      }

      // Show full results in log before switching to editor
      addLog('━━━━━━━━━━━━━━━━━━━━━━━━', '')
      addLog('📊 תוצאות Agent:', '')
      
      if (data.frames?.length) {
        data.frames.forEach((f, i) => 
          addLog(f ? `✅ Frame ${i+1}: ${f.slice(0,50)}` : `❌ Frame ${i+1}: נכשל`, f ? 'ok' : 'err')
        )
      } else {
        addLog('❌ אין Frames — Nano Banana נכשל', 'err')
      }
      
      if (data.videos?.length) {
        data.videos.forEach((v, i) => 
          addLog(v ? `✅ סרטון ${i+1}: ${v.slice(0,50)}` : `❌ סרטון ${i+1}: נכשל`, v ? 'ok' : 'err')
        )
      } else {
        addLog('❌ אין סרטונים — Kling נכשל', 'err')
      }
      
      addLog(data.audioBase64 ? '✅ קריינות V3 מוכנה' : '❌ קריינות נכשלה', data.audioBase64 ? 'ok' : 'err')
      addLog('━━━━━━━━━━━━━━━━━━━━━━━━', '')

      setResult(data)
      
      // Only go to editor if we have at least some videos
      const hasVideos = data.videos?.some(v => v)
      if (hasVideos) {
        setStep('done')
        if (data.videos[0] && videoRef.current) {
          videoRef.current.src = data.videos[0]
          videoRef.current.load()
        }
      } else {
        addLog('⚠️ לא נוצרו סרטונים — נשאר בדף הלוגים', 'err')
        // Stay on generating page so user can see logs
      }
    } catch (e) {
      addLog('❌ ' + e.message, 'err')
      alert('שגיאה: ' + e.message)
      setStep('form')
    }
  }

  const loadScene = (idx) => {
    setCurrentScene(idx)
    const url = result?.videos?.[idx]
    if (url && videoRef.current) { videoRef.current.src = url; videoRef.current.load() }
  }

  if (step === 'form') return (
    <div style={pageStyle}>
      <div style={{textAlign:'center',marginBottom:50}}>
        <div style={{fontFamily:'monospace',fontSize:12,color:'#06b6d4',letterSpacing:4,textTransform:'uppercase',marginBottom:16,opacity:0.8}}>✦ AI UGC Agent ✦</div>
        <h1 style={{fontSize:'clamp(40px,7vw,68px)',fontWeight:900,lineHeight:1,background:'linear-gradient(135deg,#fff 0%,#7c3aed 50%,#06b6d4 100%)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent',marginBottom:14}}>UGC Studio</h1>
        <p style={{color:'#8888aa',fontSize:16}}>Agent AI יוצר 4 סצנות מחוברות — סיפור אחד שלם</p>
      </div>

      <div style={cardS}>
        <button onClick={()=>setKeysOpen(o=>!o)} style={ghostBtn}>🔑 API Keys</button>
        {keysOpen && (
          <div style={{marginTop:16,display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div><label style={lblS}>fal.ai Key</label><input type="password" value={falKey} onChange={e=>setFalKey(e.target.value)} placeholder="xxxxxxxx:xxxxxxxx" style={{...inpS,marginTop:4}}/></div>
            <div><label style={lblS}>ElevenLabs Key</label><input type="password" value={elevenKey} onChange={e=>setElevenKey(e.target.value)} placeholder="sk_xxxxxxxx" style={{...inpS,marginTop:4}}/></div>
            <div style={{gridColumn:'1/-1',background:'#7c3aed11',border:'1px solid #7c3aed33',borderRadius:10,padding:'10px 14px',fontSize:13,color:'#8888aa'}}>
              💡 <strong style={{color:'#06b6d4'}}>Claude API</strong> רץ בשרת — לא צריך מפתח!
            </div>
          </div>
        )}
      </div>

      <div style={cardS}>
        <div style={secTitle}>בחר דמות</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:12}}>
          {AVATARS.map(av => (
            <div key={av.name} onClick={()=>{setSelectedAvatar(av);setCustomAvatar(null)}}
              style={{position:'relative',border:`2px solid ${selectedAvatar?.name===av.name&&!customAvatar?'#7c3aed':'#ffffff12'}`,borderRadius:12,overflow:'hidden',cursor:'pointer',aspectRatio:'3/4',boxShadow:selectedAvatar?.name===av.name&&!customAvatar?'0 0 20px #7c3aed44':'none'}}>
              <img src={av.url} alt={av.name} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
              <div style={{position:'absolute',bottom:0,left:0,right:0,background:'linear-gradient(transparent,#000a)',padding:'4px 6px',fontSize:10,color:'rgba(255,255,255,0.7)',textAlign:'center'}}>{av.name}</div>
              {selectedAvatar?.name===av.name&&!customAvatar&&<div style={{position:'absolute',top:4,right:4,width:20,height:20,background:'#7c3aed',borderRadius:'50%',fontSize:11,color:'white',display:'flex',alignItems:'center',justifyContent:'center'}}>✓</div>}
            </div>
          ))}
          <div style={{position:'relative',border:`2px solid ${customAvatar?'#10b981':'#ffffff12'}`,borderRadius:12,overflow:'hidden',cursor:'pointer',aspectRatio:'3/4',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:4,background:customAvatar?'transparent':'#16162a',backgroundImage:customAvatar?`url(${customAvatar})`:'none',backgroundSize:'cover',backgroundPosition:'center'}}>
            <input type="file" accept="image/*" onChange={handleAvatarUpload} style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',width:'100%',height:'100%'}}/>
            {!customAvatar&&<><span style={{fontSize:22}}>➕</span><span style={{fontSize:10,color:'#8888aa'}}>העלה שלך</span></>}
            {customAvatar&&<div style={{position:'absolute',top:4,right:4,width:20,height:20,background:'#10b981',borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'white'}}>✓</div>}
          </div>
        </div>
      </div>

      <div style={cardS}>
        <div style={secTitle}>פרטי המוצר</div>
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          <div><label style={lblS}>שם המוצר הספציפי</label><input value={productName} onChange={e=>setProductName(e.target.value)} placeholder="HiSmile Whitening Strips" style={{...inpS,direction:'rtl',fontFamily:'Heebo,sans-serif',marginTop:4}}/></div>
          <div><label style={lblS}>מה הוא פותר?</label><textarea value={productDesc} onChange={e=>setProductDesc(e.target.value)} placeholder="רצועות הלבנת שיניים שמלבינות תוך 7 ימים, ללא רגישות..." style={{...inpS,height:80,direction:'rtl',fontFamily:'Heebo,sans-serif',resize:'none',marginTop:4}}/></div>
          <div><label style={lblS}>איך משתמשים?</label><input value={applicationArea} onChange={e=>setApplicationArea(e.target.value)} placeholder="מניחים על השיניים למשך 30 דקות" style={{...inpS,direction:'rtl',fontFamily:'Heebo,sans-serif',marginTop:4}}/></div>
          <div>
            <label style={lblS}>📦 תמונת מוצר (חשוב! Nano Banana ישים אותו בידיים)</label>
            <div style={{marginTop:4,border:`2px dashed ${productImage?'#10b981':'#ffffff22'}`,borderRadius:12,minHeight:90,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',position:'relative',overflow:'hidden',background:productImage?'transparent':'#16162a'}}>
              <input type="file" accept="image/*" onChange={e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>setProductImage(ev.target.result);r.readAsDataURL(f)}} style={{position:'absolute',inset:0,opacity:0,cursor:'pointer',width:'100%',height:'100%'}}/>
              {productImage
                ? <img src={productImage} alt="product" style={{maxHeight:80,borderRadius:8}}/>
                : <span style={{color:'#8888aa',fontSize:13}}>לחץ להעלאת תמונת מוצר</span>
              }
            </div>
          </div>
        </div>
      </div>

      <button onClick={runAgent} style={bigBtn}>✨ הפעל Agent — צור 4 סצנות מחוברות</button>
    </div>
  )

  if (step === 'generating') return (
    <div style={pageStyle}>
      <div style={{textAlign:'center',marginBottom:40}}>
        <h2 style={{fontSize:28,fontWeight:900,color:'#f0f0ff',marginBottom:8}}>⚙️ Agent עובד...</h2>
        <p style={{color:'#8888aa'}}>יוצר סיפור מחובר עם 4 סצנות — זה לוקח 8-12 דקות</p>
      </div>
      <div style={cardS}>
        {AGENT_STEPS.map(s => {
          const st = agentStatus[s.id]
          return (
            <div key={s.id} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 16px',background:'#16162a',borderRadius:12,border:`1px solid ${st==='active'?'#7c3aed':st==='done'?'#10b981':st==='error'?'#ef4444':'#ffffff12'}`,marginBottom:10,transition:'all 0.3s'}}>
              <div style={{width:38,height:38,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,background:st==='active'?'#7c3aed':st==='done'?'#10b981':st==='error'?'#ef4444':'#0f0f1a'}}>
                {st==='done'?'✅':st==='error'?'❌':st==='active'?'⏳':s.icon}
              </div>
              <div style={{flex:1,fontWeight:600,fontSize:14}}>{s.label}</div>
              <div style={{fontFamily:'monospace',fontSize:11,color:st==='active'?'#7c3aed':st==='done'?'#10b981':st==='error'?'#ef4444':'#8888aa'}}>
                {st==='active'?'בתהליך...':st==='done'?'✓':st==='error'?'✗':'ממתין'}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{...cardS,fontFamily:'monospace',fontSize:11,maxHeight:150,overflowY:'auto'}}>
        {logs.map((l,i)=><div key={i} style={{color:l.type==='ok'?'#10b981':l.type==='err'?'#ef4444':'#8888aa',lineHeight:2}}>[{l.t}] {l.msg}</div>)}
      </div>
    </div>
  )

  return (
    <div style={{...pageStyle,maxWidth:1100}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <h2 style={{fontSize:24,fontWeight:900,background:'linear-gradient(135deg,#fff,#7c3aed)',WebkitBackgroundClip:'text',WebkitTextFillColor:'transparent'}}>🎉 הסרטון שלך מוכן!</h2>
        <button onClick={()=>{setStep('form');setResult(null);setCurrentScene(0)}} style={ghostBtn}>← מודעה חדשה</button>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:20}}>
        {result?.story?.scenes?.map((scene,i)=>(
          <div key={i} onClick={()=>loadScene(i)} style={{background:'#0f0f1a',border:`2px solid ${currentScene===i?'#7c3aed':'#ffffff12'}`,borderRadius:14,overflow:'hidden',cursor:'pointer'}}>
            <div style={{aspectRatio:'9/16',maxHeight:160,background:'#0a0a14',position:'relative',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
              {result.videos[i]
                ? <video src={result.videos[i]} muted playsInline preload="metadata" style={{width:'100%',height:'100%',objectFit:'cover'}} onLoadedMetadata={e=>{e.target.currentTime=1}}/>
                : <span style={{fontSize:24,opacity:0.3}}>⏳</span>
              }
              <div style={{position:'absolute',bottom:6,left:4,right:4,textAlign:'center',color:'white',fontSize:9,fontWeight:700,textShadow:'0 1px 4px #000',fontFamily:'Heebo,sans-serif'}}>{scene.subtitle}</div>
            </div>
            <div style={{padding:'6px 10px',fontSize:11,fontWeight:600,color:currentScene===i?'#7c3aed':'#8888aa'}}>{scene.label}</div>
          </div>
        ))}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1.5fr',gap:20}}>
        <div>
          <div style={cardS}>
            <div style={secTitle}>תצוגה מקדימה</div>
            <div style={{background:'#000',borderRadius:12,overflow:'hidden',aspectRatio:'9/16',maxHeight:460}}>
              <video ref={videoRef} controls playsInline preload="auto" style={{width:'100%',height:'100%',objectFit:'contain',display:'block'}}/>
            </div>
          </div>
          <div style={cardS}>
            <div style={secTitle}>הורד סצנות</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              {result?.videos?.map((url,i)=>(
                <div key={i} style={{background:'#16162a',border:'1px solid #ffffff12',borderRadius:10,padding:10,textAlign:'center',fontSize:12}}>
                  {result.story.scenes[i].label}<br/>
                  {url?<a href={url} target="_blank" rel="noreferrer" style={{color:'#06b6d4',textDecoration:'none'}}>הורד ↗</a>:<span style={{color:'#ffffff22'}}>שגיאה</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{display:'flex',flexDirection:'column',gap:16}}>
          <div style={cardS}>
            <div style={secTitle}>קריינות עברית V3</div>
            <audio ref={audioRef} controls style={{width:'100%',borderRadius:8}}/>
            <div style={{marginTop:12,background:'#16162a',borderRadius:10,padding:'12px 14px',fontSize:13,color:'#f0f0ff',direction:'rtl',lineHeight:1.8,fontFamily:'Heebo,sans-serif'}}>{result?.hebrewVoice}</div>
          </div>
          <div style={cardS}>
            <div style={secTitle}>פירוט הסיפור — פרומפטים</div>
            {result?.story?.scenes?.map((scene,i)=>(
              <div key={i} style={{marginBottom:12,padding:'12px 14px',background:'#16162a',borderRadius:10,border:`1px solid ${currentScene===i?'#7c3aed33':'#ffffff08'}`}}>
                <div style={{fontWeight:700,fontSize:12,marginBottom:8,color:'#f59e0b'}}>{scene.label}</div>
                <div style={{fontSize:10,color:'#8888aa',marginBottom:4,lineHeight:1.6}}><strong style={{color:'#06b6d4'}}>🎨 NB:</strong> {scene.nb_prompt}</div>
                <div style={{fontSize:10,color:'#8888aa',marginBottom:4,lineHeight:1.6}}><strong style={{color:'#7c3aed'}}>🎬 Kling:</strong> {scene.kling_prompt}</div>
                <div style={{fontSize:10,color:'#10b981'}}><strong>💬</strong> {scene.subtitle}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const pageStyle = {position:'relative',zIndex:1,maxWidth:900,margin:'0 auto',padding:'40px 20px'}
const cardS = {background:'#0f0f1a',border:'1px solid #ffffff12',borderRadius:20,padding:24,marginBottom:16}
const secTitle = {fontFamily:'monospace',fontSize:11,letterSpacing:3,color:'#f59e0b',textTransform:'uppercase',marginBottom:16}
const lblS = {fontSize:13,color:'#8888aa',display:'block'}
const inpS = {background:'#16162a',border:'1px solid #ffffff12',borderRadius:12,padding:'12px 14px',color:'#f0f0ff',fontSize:14,outline:'none',width:'100%',direction:'ltr',fontFamily:'monospace'}
const ghostBtn = {background:'none',border:'1px solid #ffffff12',color:'#8888aa',padding:'8px 16px',borderRadius:8,cursor:'pointer',fontSize:13,fontFamily:'Heebo,sans-serif'}
const bigBtn = {width:'100%',padding:18,background:'linear-gradient(135deg,#7c3aed,#5b21b6)',border:'none',borderRadius:14,color:'white',fontFamily:'Heebo,sans-serif',fontSize:18,fontWeight:700,cursor:'pointer',marginTop:8}
