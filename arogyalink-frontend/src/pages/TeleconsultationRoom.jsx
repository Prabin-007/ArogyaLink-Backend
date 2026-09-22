import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Mic, MicOff, Camera, CameraOff, PhoneOff, Languages } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../context/SocketContext'
import { completeTeleconsult } from '../services/api'

function buildIceConfig() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
  const turnUrl = import.meta.env.VITE_TURN_SERVER_URL
  const turnUser = import.meta.env.VITE_TURN_USERNAME
  const turnPass = import.meta.env.VITE_TURN_PASSWORD
  if (turnUrl && turnUser && turnPass) {
    servers.push({ urls: turnUrl, username: turnUser, credential: turnPass })
  }
  return { iceServers: servers }
}
const ICE_SERVERS = buildIceConfig()
const CHUNK_MS = 3000

const LANGUAGES = {
  hi: 'Hindi', mr: 'Marathi', bn: 'Bengali',
  ta: 'Tamil', te: 'Telugu', en: 'English'
}

export default function TeleconsultationRoom() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const socket = useSocket()
  const navigate = useNavigate()

  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)
  const pcRef          = useRef(null)
  const localStreamRef = useRef(null)
  const recorderRef    = useRef(null)
  const statsTimerRef  = useRef(null)
  const remoteSocketId = useRef(null)

  const [micOn, setMicOn]           = useState(true)
  const [camOn, setCamOn]           = useState(true)
  const [quality, setQuality]       = useState('Good')
  const [callEnded, setCallEnded]   = useState(false)
  const [connError, setConnError]   = useState('')
  const [recording, setRecording]   = useState(false)
  const [entries, setEntries]       = useState([])
  const [srcLang, setSrcLang]       = useState('hi')
  const [tgtLang, setTgtLang]       = useState('en')
  const [remoteJoined, setRemoteJoined] = useState(false)
  const audioRef = useRef(null)

  // ── WebRTC Setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return
    let cancelled = false

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        localStreamRef.current = stream
        if (localVideoRef.current) localVideoRef.current.srcObject = stream
      } catch {
        setConnError('Camera/microphone permission denied. Allow access and reload.')
        return
      }

      const pc = new RTCPeerConnection(ICE_SERVERS)
      pcRef.current = pc
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current))
      pc.ontrack = e => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0] }
      pc.onicecandidate = e => { if (e.candidate) socket.emit('ice-candidate', { roomId, candidate: e.candidate }) }
      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected'].includes(pc.connectionState))
          setConnError('Connection lost. Try rejoining.')
      }

      socket.emit('join-room', { roomId, userId: user.id, role: user.role })

      const onJoined = async ({ socketId }) => {
        remoteSocketId.current = socketId
        setRemoteJoined(true)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        socket.emit('offer', { roomId, offer })
      }
      const onOffer = async ({ offer, from }) => {
        remoteSocketId.current = from
        setRemoteJoined(true)
        await pc.setRemoteDescription(new RTCSessionDescription(offer))
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        socket.emit('answer', { roomId, answer })
      }
      const onAnswer = async ({ answer }) => { await pc.setRemoteDescription(new RTCSessionDescription(answer)) }
      const onIce    = async ({ candidate }) => {
        try { await pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch {}
      }
      const onEnded  = () => { setCallEnded(true); teardown() }
      const onLeft   = () => { setRemoteJoined(false) }
      const onTranslated = data => {
        setEntries(prev => [...prev, { ...data, at: Date.now() }])
        if (data.audioContent && audioRef.current) {
          audioRef.current.src = `data:audio/wav;base64,${data.audioContent}`
          audioRef.current.play().catch(() => {})
        }
      }

      socket.on('user-joined', onJoined)
      socket.on('offer', onOffer)
      socket.on('answer', onAnswer)
      socket.on('ice-candidate', onIce)
      socket.on('call-ended', onEnded)
      socket.on('user-left', onLeft)
      socket.on('translated_audio_response', onTranslated)

      // Basic network quality monitor
      statsTimerRef.current = setInterval(async () => {
        try {
          const stats = await pcRef.current?.getStats()
          let lost = 0, recv = 0
          stats?.forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { lost += r.packetsLost || 0; recv += r.packetsReceived || 0 } })
          const ratio = (lost + recv) > 0 ? lost / (lost + recv) : 0
          setQuality(ratio > 0.1 ? 'Poor' : 'Good')
          // auto-disable video on poor link
          if (ratio > 0.1) {
            const vt = localStreamRef.current?.getVideoTracks()[0]
            if (vt?.enabled) { vt.enabled = false; setCamOn(false) }
          }
        } catch {}
      }, 3000)

      return () => {
        socket.off('user-joined', onJoined)
        socket.off('offer', onOffer)
        socket.off('answer', onAnswer)
        socket.off('ice-candidate', onIce)
        socket.off('call-ended', onEnded)
        socket.off('user-left', onLeft)
        socket.off('translated_audio_response', onTranslated)
      }
    }

    let cleanup
    setup().then(fn => { cleanup = fn })
    return () => { cancelled = true; cleanup?.(); teardown() }
  }, [socket, roomId])

  function teardown() {
    if (statsTimerRef.current) clearInterval(statsTimerRef.current)
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    pcRef.current?.close(); pcRef.current = null
    recorderRef.current?.stream?.getTracks().forEach(t => t.stop())
    recorderRef.current?.stop()
  }

  function toggleMic() {
    const t = localStreamRef.current?.getAudioTracks()[0]
    if (t) { t.enabled = !t.enabled; setMicOn(t.enabled) }
  }
  function toggleCam() {
    const t = localStreamRef.current?.getVideoTracks()[0]
    if (t) { t.enabled = !t.enabled; setCamOn(t.enabled) }
  }

  function endCall() {
    socket?.emit('end-call', { roomId })
    teardown()
    navigate('/dashboard')
  }

  // ── Bhashini speech translation ─────────────────────────────────────────────
  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      rec.ondataavailable = async e => {
        if (e.data.size === 0 || !socket) return
        const reader = new FileReader()
        reader.onloadend = () => {
          const b64 = reader.result.split(',')[1]
          socket.emit('patient_speech_chunk', { roomId, audioBase64: b64, sourceLanguage: srcLang, targetLanguage: tgtLang })
        }
        reader.readAsDataURL(e.data)
      }
      rec.start(CHUNK_MS)
      setRecording(true)
    } catch { setRecording(false) }
  }

  function stopRecording() {
    recorderRef.current?.stream?.getTracks().forEach(t => t.stop())
    recorderRef.current?.stop()
    setRecording(false)
  }

  if (callEnded) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0a0a0f' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '40px', textAlign: 'center', maxWidth: 380, width: '100%', margin: 16 }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>📞</div>
        <h2 style={{ marginBottom: 8 }}>Call Ended</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Room: {roomId}</p>
        <button className="btn btn-primary btn-block" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    </div>
  )

  return (
    <div className="video-room-page">
      {/* ── Video column ── */}
      <div className="video-main">
        {/* Top bar */}
        <div className="video-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>🏥</span>
            <span className="video-topbar-title">ArogyaLink · Room: {roomId}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className={`video-quality ${quality === 'Good' ? 'quality-good' : 'quality-poor'}`}>
              {quality === 'Good' ? '● Good' : '⚠ Poor'}
            </span>
            {!remoteJoined && (
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Waiting for other participant…</span>
            )}
          </div>
        </div>

        {connError && <div className="network-banner">{connError}</div>}
        {quality === 'Poor' && !connError && <div className="network-banner">⚠ Poor network — video disabled to save bandwidth</div>}

        {/* Video area */}
        <div className="video-grid">
          <div className="video-tile">
            <video ref={remoteVideoRef} autoPlay playsInline />
            {!remoteJoined && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: 12 }}>
                <span style={{ fontSize: 40 }}>👤</span>
                <span style={{ fontSize: 13 }}>Waiting for participant…</span>
                <span className="spinner" style={{ borderTopColor: '#3b82f6', borderColor: 'rgba(255,255,255,.1)' }} />
              </div>
            )}
            <div className="video-tile-label">Remote</div>
          </div>
        </div>

        {/* Local PiP */}
        <div className="video-tile-local">
          <video ref={localVideoRef} autoPlay playsInline muted />
        </div>

        {/* Controls */}
        <div className="video-controls">
          <button className={`ctrl-btn${micOn ? '' : ' muted'}`} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}>
            {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          </button>
          <button className={`ctrl-btn${camOn ? '' : ' cam-off'}`} onClick={toggleCam} title={camOn ? 'Camera Off' : 'Camera On'}>
            {camOn ? <Camera size={18} /> : <CameraOff size={18} />}
          </button>
          <button className="ctrl-btn danger" onClick={endCall} title="End Call">
            <PhoneOff size={18} />
          </button>
        </div>

        <audio ref={audioRef} style={{ display: 'none' }} />
      </div>

      {/* ── Translation Panel ── */}
      <div className="translation-panel-video">
        <div className="tp-header"><Languages size={13} /> Bhashini Translation</div>

        {/* Language selectors */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Patient speaks</div>
            <select
              style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 5, color: '#fff', fontSize: 12, padding: '4px 6px' }}
              value={srcLang} onChange={e => setSrcLang(e.target.value)}
            >
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.5px' }}>Doctor hears</div>
            <select
              style={{ width: '100%', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 5, color: '#fff', fontSize: 12, padding: '4px 6px' }}
              value={tgtLang} onChange={e => setTgtLang(e.target.value)}
            >
              {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* Transcript */}
        <div className="tp-entries">
          {entries.length === 0 && (
            <div style={{ color: '#475569', fontSize: 12, textAlign: 'center', padding: '20px 10px' }}>
              Start translation to see the transcript here
            </div>
          )}
          {entries.map((e, i) => (
            <div key={i} className="tp-entry">
              <div className="tp-original">🎤 {LANGUAGES[e.sourceLanguage] || e.sourceLanguage}: {e.recognizedText}</div>
              <div className="tp-translated">💬 {LANGUAGES[e.targetLanguage] || e.targetLanguage}: {e.translatedText}</div>
            </div>
          ))}
        </div>

        {/* Record button */}
        <div className="tp-controls">
          <button
            className={`btn btn-block ${recording ? 'btn-danger' : 'btn-primary'} btn-sm`}
            onClick={recording ? stopRecording : startRecording}
          >
            {recording ? '⏹ Stop Translation' : '🗣 Start Translation'}
          </button>
          {recording && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: '#4ade80' }}>
              <span className="live-dot" style={{ background: '#4ade80' }} /> Translating live…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
