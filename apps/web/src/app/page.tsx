"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, AudioLines, Camera, Check, ChevronDown, CircleHelp, Copy, Cpu, Globe2, Menu, Mic, MicOff, MonitorUp, Play, Radio, Settings2, ShieldCheck, Sparkles, Video, VideoOff, Volume2, VolumeX, Wifi, X } from "lucide-react";
import { io, Socket } from "socket.io-client";
import type { ImageSegmenter } from "@mediapipe/tasks-vision";

const API = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000");
const SIGNAL = process.env.NEXT_PUBLIC_SIGNAL_URL || API;
type Chat = { role: "assistant" | "user"; text: string };

type PersonMask = { width: number; height: number; values: Float32Array; stream: MediaStream; timestamp: number };
let personSegmenterPromise: Promise<ImageSegmenter> | null = null;
let sharedPersonMask: PersonMask | null = null;

async function getPersonSegmenter() {
  if (!personSegmenterPromise) {
    const loading = (async () => {
      const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
      return ImageSegmenter.createFromOptions(vision, {
        baseOptions: { modelAssetPath: "/models/selfie_segmenter_landscape.tflite" },
        runningMode: "VIDEO",
        outputCategoryMask: true,
        outputConfidenceMasks: true,
      });
    })();
    personSegmenterPromise = loading.catch(error => {
      personSegmenterPromise = null;
      throw error;
    });
  }
  return personSegmenterPromise;
}

function segmentPerson(segmenter: ImageSegmenter, video: HTMLVideoElement, stream: MediaStream, timestamp: number): PersonMask {
  if (sharedPersonMask?.stream === stream && timestamp - sharedPersonMask.timestamp < 35) return sharedPersonMask;
  const result = segmenter.segmentForVideo(video, timestamp);
  const labels = segmenter.getLabels();
  const personIndex = labels.findIndex(label => /person/i.test(label));
  const person = result.confidenceMasks?.[personIndex >= 0 ? personIndex : 0];
  const category = result.categoryMask;
  const mask = person ?? category;
  if (!mask) {
    result.close();
    throw new Error("The person mask was not returned by the segmenter.");
  }
  const values = person
    ? mask.getAsFloat32Array().slice()
    : Float32Array.from(mask.getAsUint8Array(), value => personIndex >= 0 ? Number(value === personIndex) : Number(value > 0));
  const frame = { width: mask.width, height: mask.height, values, stream, timestamp };
  result.close();
  sharedPersonMask = frame;
  return frame;
}

function Hologram({ media, intensity = 70, scan = 52, effects = true, active = true }: { media: MediaStream | null; intensity?: number; scan?: number; effects?: boolean; active?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const [maskState, setMaskState] = useState("DEMO FIGURE");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = media;
    if (media) void video.play().catch(() => undefined);
  }, [media]);

  useEffect(() => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!media || !video || !canvas) {
      setMaskState("DEMO FIGURE");
      return;
    }

    let cancelled = false, raf = 0, segmenter: ImageSegmenter | null = null, lastFrameAt = 0;
    let lastMask: PersonMask | null = null;
    const source = document.createElement("canvas"), maskCanvas = document.createElement("canvas");
    const sourceCtx = source.getContext("2d", { willReadFrequently: true });
    const maskCtx = maskCanvas.getContext("2d");
    const outputCtx = canvas.getContext("2d");
    if (!sourceCtx || !maskCtx || !outputCtx) return;

    setMaskState(effects ? "LOADING PERSON MASK" : "BACKGROUND REMOVAL OFF");
    if (effects) {
      void getPersonSegmenter().then(loaded => {
        if (!cancelled) {
          segmenter = loaded;
          setMaskState("SEGMENTER READY · ON DEVICE");
        }
      }).catch(error => {
        if (!cancelled) {
          console.error("Background removal could not start", error);
          const detail = error instanceof Error ? error.message : String(error);
          setMaskState(`CUTOUT ERROR · ${detail.slice(0, 36)}`);
        }
      });
    }

    const draw = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(draw);
      const now = performance.now();
      if (now - lastFrameAt < 42 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      lastFrameAt = now;
      const videoWidth = video.videoWidth, videoHeight = video.videoHeight;
      if (!videoWidth || !videoHeight) return;

      const scale = Math.min(1, 640 / videoWidth), width = Math.max(1, Math.round(videoWidth * scale)), height = Math.max(1, Math.round(videoHeight * scale));
      if (source.width !== width || source.height !== height) { source.width = width; source.height = height; }
      sourceCtx.clearRect(0, 0, width, height);
      sourceCtx.drawImage(video, 0, 0, width, height);

      if (effects && segmenter) {
        try {
          const mask = segmentPerson(segmenter, video, media, now);
          setMaskState("BACKGROUND REMOVED · ON DEVICE");
          if (mask !== lastMask || maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
            maskCanvas.width = mask.width; maskCanvas.height = mask.height;
            const rgba = new Uint8ClampedArray(mask.width * mask.height * 4);
            for (let i = 0; i < mask.values.length; i++) {
              const confidence = Math.max(0, Math.min(1, (mask.values[i] - 0.12) / 0.76));
              rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = Math.round(confidence * 255);
            }
            maskCtx.putImageData(new ImageData(rgba, mask.width, mask.height), 0, 0);
            lastMask = mask;
          }
          sourceCtx.globalCompositeOperation = "destination-in";
          sourceCtx.drawImage(maskCanvas, 0, 0, width, height);
          sourceCtx.globalCompositeOperation = "source-atop";
          sourceCtx.fillStyle = "rgba(24, 175, 220, .24)";
          sourceCtx.fillRect(0, 0, width, height);
          sourceCtx.globalCompositeOperation = "source-over";
        } catch (error) {
          sourceCtx.globalCompositeOperation = "source-over";
          console.error("Person segmentation frame failed", error);
          const detail = error instanceof Error ? error.message : String(error);
          setMaskState(`CUTOUT ERROR · ${detail.slice(0, 36)}`);
          segmenter = null;
        }
      }

      const ratio = Math.min(2, window.devicePixelRatio || 1), stageWidth = canvas.clientWidth, stageHeight = canvas.clientHeight;
      if (canvas.width !== Math.round(stageWidth * ratio) || canvas.height !== Math.round(stageHeight * ratio)) {
        canvas.width = Math.round(stageWidth * ratio); canvas.height = Math.round(stageHeight * ratio);
      }
      outputCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
      outputCtx.clearRect(0, 0, stageWidth, stageHeight);
      const boxX = stageWidth * 0.08, boxY = stageHeight * 0.03, boxWidth = stageWidth * 0.84, boxHeight = stageHeight * 0.9;
      const fit = Math.min(boxWidth / width, boxHeight / height), drawWidth = width * fit, drawHeight = height * fit;
      outputCtx.save();
      outputCtx.globalAlpha = effects ? 0.96 : 0.86;
      outputCtx.filter = "saturate(1.18) contrast(1.08)";
      outputCtx.shadowColor = "rgba(63, 228, 255, .62)";
      outputCtx.shadowBlur = 14 * (intensity / 70);
      outputCtx.drawImage(source, boxX + (boxWidth - drawWidth) / 2, boxY + (boxHeight - drawHeight) / 2, drawWidth, drawHeight);
      outputCtx.restore();
    };

    draw();
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [media, effects, intensity]);

  return <div className={`holo-stage ${active ? "holo-active" : ""} ${effects ? "effects-on" : "effects-off"}`} style={{ "--intensity": intensity / 100, "--scan": scan / 100 } as React.CSSProperties}>
    <div className="holo-grid"/><div className="holo-orbit orbit-one"/><div className="holo-orbit orbit-two"/>
    <div className="holo-frame">
      <div className="frame-corner tl"/><div className="frame-corner tr"/><div className="frame-corner bl"/><div className="frame-corner br"/>
      <div className="holo-video-wrap">
        <video ref={videoRef} autoPlay muted playsInline className="holo-source-video"/>
        {media ? <canvas ref={canvasRef} className="holo-cutout-canvas" aria-label="Background removed holographic camera output"/> : <div className="holo-demo-person"><div className="demo-head"/><div className="demo-body"/><small>HOLOCONNECT · DEMO</small></div>}
        <div className="scanlines"/><div className="holo-shimmer"/>
        <div className="holo-caption"><span className="live-dot"/> {media ? maskState : "DEMO FIGURE"} <span className="caption-divider"/> 3D PROJECTION</div>
      </div>
      <div className="holo-side side-left"/><div className="holo-side side-right"/>
    </div>
    <div className="beam beam-left"/><div className="beam beam-right"/><div className="projection-base"><div/><div/><div/></div>
    <span className="holo-tag tag-left">DEPTH MAP <b>ACTIVE</b></span><span className="holo-tag tag-right">SIGNAL <b>STABLE</b></span>
  </div>;
}

function Brand() { return <a className="brand" href="#top"><span className="brand-mark"><span/><span/><span/></span><span>HOLO<span className="brand-light">CONNECT</span><sup>AI</sup></span></a>; }

export default function Home() {
  const localVideos = useRef<(HTMLVideoElement | null)[]>([]), socket = useRef<Socket | null>(null), peer = useRef<RTCPeerConnection | null>(null), stream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null), remoteAudioRef = useRef<HTMLAudioElement | null>(null), pendingIceCandidates = useRef<RTCIceCandidateInit[]>([]);
  const [localMedia, setLocalMedia] = useState<MediaStream | null>(null), [remoteMedia, setRemoteMedia] = useState<MediaStream | null>(null), [remoteAudioStream, setRemoteAudioStream] = useState<MediaStream | null>(null);
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(false), [remoteAudioBlocked, setRemoteAudioBlocked] = useState(false);
  const [cameraOn, setCameraOn] = useState(false), [micOn, setMicOn] = useState(true), [simOn, setSimOn] = useState(false), [intensity, setIntensity] = useState(72), [scan, setScan] = useState(52), [background, setBackground] = useState(true);
  const [room, setRoom] = useState(""), [roomCode, setRoomCode] = useState(""), [connected, setConnected] = useState(false), [status, setStatus] = useState("Ready to connect"), [mediaError, setMediaError] = useState(""), [latency, setLatency] = useState("Not measured"), [messages, setMessages] = useState<Chat[]>([{role:"assistant",text:"Hi! I’m the HoloConnect demo assistant. Ask me about this prototype or your session."}]), [draft, setDraft] = useState(""), [assistantOpen, setAssistantOpen] = useState(true), [copied, setCopied] = useState(false), [ending, setEnding] = useState(false), [health, setHealth] = useState("Checking system");
  const hasRemoteAudio = Boolean(remoteAudioStream?.getAudioTracks().some(track => track.readyState === "live"));

  useEffect(() => { fetch(`${API}/api/health`).then(r=>r.ok?r.json():Promise.reject()).then(()=>setHealth("API online")).catch(()=>setHealth("Demo mode"));const invited=new URLSearchParams(location.search).get("room");if(invited)setRoom(invited.toUpperCase()); return () => { peer.current?.close(); stream.current?.getTracks().forEach(t=>t.stop()); socket.current?.disconnect(); }; }, []);
  useEffect(() => {
    const player = remoteAudioRef.current;
    if (!player) return;
    player.srcObject = remoteAudioStream;
    player.muted = remoteAudioMuted;
    player.volume = 1;
    if (!remoteAudioStream?.getAudioTracks().some(track => track.readyState === "live")) {
      setRemoteAudioBlocked(false);
      return;
    }
    void player.play().then(() => setRemoteAudioBlocked(false)).catch(() => {
      setRemoteAudioBlocked(true);
      setStatus("Tap the speaker button to enable participant audio");
    });
  }, [remoteAudioStream, remoteAudioMuted]);
  useEffect(() => { if(!connected)return;let cancelled=false;const sample=async()=>{const stats=await peer.current?.getStats();if(!stats)return;for(const report of stats.values()){if(report.type==="candidate-pair"&&report.state==="succeeded"&&report.currentRoundTripTime!=null){if(!cancelled)setLatency(`${Math.round(report.currentRoundTripTime*1000)} ms`);return;}}};void sample();const timer=setInterval(()=>void sample(),2000);return()=>{cancelled=true;clearInterval(timer)};},[connected]);
  async function startCamera() { setMediaError(""); try { if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access needs HTTPS or localhost."); const s = await navigator.mediaDevices.getUserMedia({video:true,audio:true});s.getAudioTracks().forEach(t=>t.enabled=micOn); stream.current=s; setLocalMedia(s); setRemoteMedia(s); localVideos.current.forEach(v=>{if(v)v.srcObject=s}); setCameraOn(true); setStatus("Camera and microphone ready"); } catch(e) { const err=e as DOMException; const message=err.name==="NotReadableError"||err.name==="AbortError"?"Camera or microphone is busy in another app. Close the app using it, then retry.":err.name==="NotAllowedError"?"Camera or microphone access is blocked. Allow it in the browser site settings, then retry.":err.name==="NotFoundError"?"No camera or microphone was found on this device.":err.message||"Camera permission was not granted.";setMediaError(message);setStatus(message); } }
  function toggleMic() { const track=stream.current?.getAudioTracks()[0]; if(track){track.enabled=!track.enabled;setMicOn(track.enabled);} else setMicOn(v=>!v); }
  function toggleRemoteAudio() {
    const player = remoteAudioRef.current;
    if (!player || !remoteAudioStream) return;
    if (remoteAudioMuted) {
      setRemoteAudioMuted(false);
      player.muted = false;
      void player.play().then(() => setRemoteAudioBlocked(false)).catch(() => {
        setRemoteAudioBlocked(true);
        setStatus("Tap the speaker button to enable participant audio");
      });
      return;
    }
    if (remoteAudioBlocked) {
      player.muted = false;
      void player.play().then(() => setRemoteAudioBlocked(false)).catch(() => {
        setRemoteAudioBlocked(true);
        setStatus("Tap the speaker button to enable participant audio");
      });
      return;
    }
    setRemoteAudioMuted(true);
    player.muted = true;
  }
  function toggleVideo() { const track=stream.current?.getVideoTracks()[0]; if(track&&track.readyState!=="ended"){track.enabled=!track.enabled;setCameraOn(track.enabled);return;} stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setLocalMedia(null);setRemoteMedia(null);setCameraOn(false);void startCamera(); }
  async function connectRoom(code?:string) {
    const selected=(code||room).trim().toUpperCase(); if(!selected){setStatus("Enter a room code first");return;} if(!stream.current){await startCamera(); if(!stream.current)return;}
    pendingIceCandidates.current=[]; remoteStream.current=null; setRemoteAudioStream(null); setRemoteAudioBlocked(false);
    const client=io(SIGNAL,{transports:["websocket","polling"]}); socket.current=client; setStatus("Connecting to signaling server…");
    client.on("connect",()=>client.emit("room:join",{roomCode:selected,displayName:"Guest"}));
    client.on("room:joined",({roomCode:joined,participants,isInitiator}:{roomCode:string;participants:{id:string}[];isInitiator:boolean})=>{setRoomCode(joined);setConnected(true);setStatus("Signaling connected · waiting for participant"); if(isInitiator&&participants.length>1) void makeOffer(participants[0].id);});
    client.on("participant:joined",async(p:{id:string})=>{setStatus("Participant joined · establishing media");await makeOffer(p.id);});
    client.on("offer",async({from,description}:{from:string;description:RTCSessionDescriptionInit})=>{const pc=ensurePeer(); await pc.setRemoteDescription(description); await applyPendingIceCandidates(pc); const answer=await pc.createAnswer(); await pc.setLocalDescription(answer); client.emit("answer",{to:from,description:answer});});
    client.on("answer",async({description}:{description:RTCSessionDescriptionInit})=>{const pc=peer.current;if(!pc)return;await pc.setRemoteDescription(description);await applyPendingIceCandidates(pc);setStatus("Peer connection established");});
    client.on("ice-candidate",async({candidate}:{candidate:RTCIceCandidateInit})=>{if(!candidate)return;const pc=peer.current;if(!pc?.remoteDescription){pendingIceCandidates.current.push(candidate);return;}try{await pc.addIceCandidate(candidate);}catch{}});
    client.on("participant:left",()=>setStatus("Participant left the room"));
    client.on("room:error",({message}:{message:string})=>setStatus(message)); client.on("connect_error",()=>setStatus("Signaling server unavailable · start the API or use the simulator"));
  }
  function ensurePeer(){ if(peer.current)return peer.current; const stun=process.env.NEXT_PUBLIC_STUN_URL||"stun:stun.l.google.com:19302"; const iceServers:RTCIceServer[]=[{urls:stun}];if(process.env.NEXT_PUBLIC_TURN_URL)iceServers.push({urls:process.env.NEXT_PUBLIC_TURN_URL,username:process.env.NEXT_PUBLIC_TURN_USERNAME,credential:process.env.NEXT_PUBLIC_TURN_CREDENTIAL});const pc=new RTCPeerConnection({iceServers}); peer.current=pc; stream.current?.getTracks().forEach(t=>pc.addTrack(t,stream.current!)); pc.ontrack=e=>{const incoming=e.streams[0]??remoteStream.current??new MediaStream();if(!e.streams[0]&&!incoming.getTracks().some(track=>track.id===e.track.id))incoming.addTrack(e.track);remoteStream.current=incoming;const media=new MediaStream(incoming.getTracks());setRemoteMedia(media);setRemoteAudioStream(media);setStatus("Peer connection established")}; pc.onicecandidate=e=>{if(e.candidate)socket.current?.emit("ice-candidate",{to:(window as any).__peerId,candidate:e.candidate.toJSON()})}; pc.onconnectionstatechange=()=>{if(pc.connectionState==="connected")setStatus("Peer connection established"); if(pc.connectionState==="failed")setStatus("Connection failed · TURN relay may be required")}; return pc; }
  async function applyPendingIceCandidates(pc:RTCPeerConnection){if(!pc.remoteDescription)return;const candidates=pendingIceCandidates.current.splice(0);await Promise.all(candidates.map(candidate=>pc.addIceCandidate(candidate).catch(()=>undefined)));}
  async function makeOffer(to:string){ (window as any).__peerId=to;const pc=ensurePeer();const offer=await pc.createOffer();await pc.setLocalDescription(offer);socket.current?.emit("offer",{to,description:offer}); }
  async function createRoom(){if(!stream.current){await startCamera();if(!stream.current)return;}try{const r=await fetch(`${API}/api/sessions`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({displayName:"Guest"})});if(!r.ok)throw new Error();const d=await r.json();setRoomCode(d.roomCode);setRoom(d.roomCode);void connectRoom(d.roomCode);}catch{setStatus("Could not create a room · API server is offline");}}
  async function copyInvite(){const url=`${location.origin}/?room=${roomCode}`;try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setStatus("Copy the session link from your browser address bar");}}
  function leaveSession(){peer.current?.close();peer.current=null;remoteStream.current=null;pendingIceCandidates.current=[];socket.current?.disconnect();socket.current=null;setRemoteAudioStream(null);setRemoteAudioBlocked(false);setConnected(false);setRoomCode("");setEnding(false);setStatus("Session ended");setRemoteMedia(stream.current);}
  async function sendMessage(e:React.FormEvent){e.preventDefault();const prompt=draft.trim();if(!prompt)return;setDraft("");setMessages(m=>[...m,{role:"user",text:prompt}]);try{const r=await fetch(`${API}/api/ai/chat`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:prompt})});const d=await r.json();setMessages(m=>[...m,{role:"assistant",text:d.reply||"Demo assistant is unavailable."}]);}catch{setMessages(m=>[...m,{role:"assistant",text:"Demo mode: I can explain how to start a camera preview, create a room, or test the receiver view. The API service is currently offline."}]);}}

  return <main id="top">
    <header className="topbar"><Brand/><nav><a href="#technology">Technology</a><a href="#simulator">Simulator</a><a href="#workflow">How it works</a></nav><div className="top-actions"><span className="system-status"><i/> {health}</span><a className="button button-small button-outline" href="#studio">Open Studio <ArrowRight size={14}/></a><button className="menu-button" aria-label="Menu"><Menu/></button></div></header>
    <section className="hero"><div className="hero-stars"/><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> INTELLIGENT TELEPRESENCE <span className="eyebrow-pill">PROTOTYPE 01</span></div><h1>Experience presence<br/><em>beyond distance.</em></h1><p>Meet face-to-face from anywhere. HoloConnect turns your live camera into an immersive, holographic-style telepresence experience.</p><div className="hero-ctas"><a className="button button-primary" href="#studio"><span className="button-icon"><Play size={13} fill="currentColor"/></span> Start a Holo Session <ArrowRight size={17}/></a><a className="button button-ghost" href="#technology">Explore the technology <ArrowDownRight size={16}/></a></div><div className="hero-proof"><div className="proof-avatars"><span>JD</span><span>MK</span><span>+</span></div><span>Presence, reimagined.<br/><b>Built for the next dimension.</b></span></div></div>
      <div className="hero-art"><div className="hero-art-label"><span className="live-dot"/> HOLOGRAPHIC PREVIEW <span className="label-line"/> <span>01 / 04</span></div><div className="hero-person"><div className="person-halo"/><div className="person-head"/><div className="person-body"/><div className="person-lines"/><div className="person-scan"/><span className="person-label">FIG. 01 <b>SPATIAL PRESENCE</b></span></div><div className="hero-art-bottom"><span>01&nbsp; — &nbsp;LIVE VISUALIZATION</span><span>DEPTH&nbsp; <b>72%</b></span></div></div>
      <div className="hero-foot"><span>ENGINEERED FOR HUMAN CONNECTION</span><span className="hero-scroll">SCROLL TO EXPLORE <span>↓</span></span><span>EST. 2026&nbsp; · &nbsp;BUILT FOR TOMORROW</span></div>
    </section>

    <section className="metrics-strip"><div><span>01</span><b>REAL-TIME</b><small>WebRTC media transport</small></div><div><span>02</span><b>AI-READY</b><small>Modular assistant layer</small></div><div><span>03</span><b>SPATIAL</b><small>Depth-inspired display</small></div><div><span>04</span><b>5G-READY</b><small>Network-aware architecture</small></div></section>
    <section className="section tech-section" id="technology"><div className="section-head"><div><div className="eyebrow">THE TECHNOLOGY <span className="eyebrow-pill">FOUR PILLARS</span></div><h2>Presence, <em>engineered.</em></h2></div><p>A thoughtfully connected stack makes remote communication feel closer, clearer, and more human.</p></div><div className="tech-grid">{[{n:"01",icon:<Sparkles/>,title:"Intelligence layer",copy:"A modular AI foundation for captions, helpful session guidance, and future visual processing."},{n:"02",icon:<Radio/>,title:"Real-time media",copy:"Direct WebRTC audio and video with Socket.IO signaling and an extensible relay configuration."},{n:"03",icon:<Cpu/>,title:"Spatial display",copy:"Layered perspective, luminous edges, scan lines, and a projection base create a receiver-side illusion."},{n:"04",icon:<Globe2/>,title:"5G-ready network",copy:"Designed for low-latency networks, with honest connection state and room for TURN infrastructure."}].map(c=><article className="tech-card" key={c.n}><div className="card-top"><span>{c.n} / 04</span>{c.icon}</div><h3>{c.title}</h3><p>{c.copy}</p><span className="card-arrow"><ArrowRight size={17}/></span></article>)}</div></section>

    <section className="section simulator-section" id="simulator"><div className="section-head"><div><div className="eyebrow">OUTPUT LOOKS <span className="eyebrow-pill">RECEIVER VIEW</span></div><h2>From camera to <em>presence.</em></h2></div><p>The same live camera appears on both sides. The receiver view adds depth, edge light, and animated projection layers.</p></div>
      <div className="sim-card"><div className="sim-topline"><span><span className="live-dot"/> {simOn?"SIMULATION RUNNING":"HOLOGRAPHIC DISPLAY SIMULATOR"}</span><span>LOCAL PREVIEW <i>·</i> NO RECORDING</span></div><div className="sim-views"><div className="raw-view"><div className="view-label"><span>01</span> RAW CAMERA FEED <small>(ORIGINAL)</small></div><div className="camera-frame"><video ref={el=>{localVideos.current[0]=el;if(el&&stream.current)el.srcObject=stream.current}} autoPlay muted playsInline/><div className={`camera-placeholder ${cameraOn?"hidden":""}`}><Camera size={23}/><span>Camera preview</span><small>Enable camera to begin</small></div><div className="camera-corner c-tl"/><div className="camera-corner c-tr"/><div className="camera-corner c-bl"/><div className="camera-corner c-br"/></div><button className="view-action" onClick={cameraOn?()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setLocalMedia(null);setRemoteMedia(null);setCameraOn(false);setLocalMedia(null);setRemoteMedia(null);setStatus("Camera stopped");}:startCamera}><Camera size={15}/>{cameraOn?"Stop camera":"Enable camera"}</button></div><div className="direction-arrow"><ArrowRight/></div><div className="processed-view"><div className="view-label"><span>02</span> PROCESSED OUTPUT <small>(HOLOGRAPHIC DISPLAY)</small></div><div className="processed-box"><Hologram media={remoteMedia} intensity={intensity} scan={scan} effects={background} active={simOn}/></div><div className="sim-actions"><button className="button button-primary button-small" onClick={()=>{if(!cameraOn)void startCamera();setSimOn(v=>!v)}}>{simOn?<><span className="pause-icon">Ⅱ</span> Pause simulation</>:<><Play size={13} fill="currentColor"/> Start simulation</>}</button><button className="text-button" onClick={()=>{setIntensity(72);setScan(52);setBackground(true);setSimOn(false)}}>Reset effects</button></div></div></div>
        <div className="sim-controls"><div className="control-slider"><label>HOLOGRAM INTENSITY <b>{intensity}%</b></label><input type="range" min="0" max="100" value={intensity} onChange={e=>setIntensity(+e.target.value)} style={{"--fill":`${intensity}%`} as React.CSSProperties}/></div><div className="control-slider"><label>SCAN-LINE INTENSITY <b>{scan}%</b></label><input type="range" min="0" max="100" value={scan} onChange={e=>setScan(+e.target.value)} style={{"--fill":`${scan}%`} as React.CSSProperties}/></div><button className={`toggle-option ${background?"selected":""}`} onClick={()=>setBackground(v=>!v)}><span className="toggle-switch"/><span>Remove background</span></button><button className="toggle-option" onClick={()=>document.querySelector(".holo-frame")?.classList.toggle("rotated")}><span className="rotation-icon">↻</span><span>Rotate display</span></button></div>
        <div className="sim-note"><ShieldCheck size={15}/> Camera media stays in your browser until you join a session. No audio or video is stored.</div></div>
    </section>

    <section className="section workflow-section" id="workflow"><div className="section-head"><div><div className="eyebrow">A CLEAR PATH TO PRESENCE</div><h2>Simple by design.<br/><em>Powerful by nature.</em></h2></div><p>Capture locally, connect peers directly, then let the receiver view add a new sense of depth.</p></div><div className="workflow-line">{[{n:"01",title:"Capture",copy:"Allow your camera and microphone. Your preview starts locally."},{n:"02",title:"Connect",copy:"Create a private room and invite another participant with its link."},{n:"03",title:"Be there",copy:"WebRTC carries media. The holographic display shapes the receiver view."}].map((v,i)=><div className="workflow-step" key={v.n}><div className="step-marker">{i===0?<Video/>:i===1?<Wifi/>:<Sparkles/>}<span>{v.n}</span></div><h3>{v.title}</h3><p>{v.copy}</p></div>)}</div></section>

    <section className="section studio-section" id="studio"><div className="section-head"><div><div className="eyebrow">HOLOCONNECT STUDIO <span className="eyebrow-pill">BETA</span></div><h2>Make the <em>connection.</em></h2></div><p>Create a room to invite a second browser, or join with a room code. Session media is never recorded.</p></div><div className="studio-shell"><aside className="studio-side"><div className="studio-brand"><Brand/><button aria-label="Settings"><Settings2 size={17}/></button></div><div className="studio-profile"><span className="profile-avatar">G</span><div><b>Guest session</b><small>Local prototype</small></div><ChevronDown size={14}/></div><div className="studio-nav"><small>WORKSPACE</small><a className="current" href="#studio"><Video size={16}/> Studio <span>●</span></a><a href="#simulator"><Sparkles size={16}/> Simulator</a><a href="#technology"><AudioLines size={16}/> AI assistant <i>DEMO</i></a><small>YOUR ACCOUNT</small><a href="#studio"><Radio size={16}/> Session history</a><a href="#studio"><Settings2 size={16}/> Settings</a></div><div className="side-bottom"><span className="status-badge"><i/> {health}</span><small>HOLOCONNECT AI <b>v0.1.0</b></small></div></aside><div className="studio-main"><div className="studio-heading"><div><span className="breadcrumb">WORKSPACE&nbsp; / &nbsp;STUDIO</span><h3>Holographic Studio</h3><p>{status}</p></div><div className="connection-chip"><i className={connected?"connected":""}/>{connected?"SIGNAL CONNECTED":"AWAITING CONNECTION"}</div></div><div className="studio-grid"><div className="studio-video-col"><div className="local-feed"><div className="feed-heading"><span><i className={cameraOn?"green":""}/> YOUR CAMERA</span><button onClick={cameraOn?()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setLocalMedia(null);setRemoteMedia(null);setCameraOn(false)}:startCamera}>{cameraOn?<VideoOff size={15}/>:<Video size={15}/>}</button></div><div className="local-preview"><video autoPlay muted playsInline ref={el=>{localVideos.current[1]=el;if(el&&stream.current)el.srcObject=stream.current}}/><div className={`camera-placeholder ${cameraOn||mediaError?"hidden":""}`}><Camera/><span>Camera preview</span><small>Enable camera to see yourself</small></div>{mediaError&&!cameraOn&&<div className="media-error"><b>Camera could not start</b><span>{mediaError}</span><button onClick={()=>void startCamera()}>Retry camera</button></div>}</div><div className="feed-foot"><span>{cameraOn?"Camera ready":"Camera off"}</span><span>HD <ChevronDown size={12}/></span></div></div>
            <div className="receiver-panel"><div className="receiver-heading"><div><span className="receiver-eyebrow">HOLOGRAPHIC RECEIVER VIEW</span><b>{roomCode?`ROOM ${roomCode}`:"WAITING FOR PARTICIPANT"}</b></div><span className="receiver-live"><i/> {connected?"LIVE":"PREVIEW"}</span></div><div className="receiver-content"><Hologram media={remoteMedia} intensity={intensity} scan={scan} effects={background} active={simOn||connected}/></div><div className="session-bar"><div><span className="signal-mark"><Wifi size={13}/></span><span><b>CONNECTION</b><small>{connected?status:"No peer connected"}</small></span></div><div><span className="signal-mark"><AudioLines size={13}/></span><span><b>LATENCY</b><small>{connected?latency:"Not measured"}</small></span></div><div><span className="signal-mark"><Sparkles size={13}/></span><span><b>AI FEATURES</b><small>Demo assistant ready</small></span></div></div><div className="session-controls"><audio ref={remoteAudioRef} className="remote-audio" autoPlay playsInline aria-label="Audio from the other participant"/><button onClick={toggleMic} title="Toggle microphone">{micOn?<Mic/>:<MicOff/>}</button><button onClick={toggleVideo} title="Toggle camera">{cameraOn?<Video/>:<VideoOff/>}</button><button className={`${remoteAudioMuted||remoteAudioBlocked?"":"control-on"} ${hasRemoteAudio?"":"control-disabled"}`} onClick={toggleRemoteAudio} disabled={!hasRemoteAudio} aria-label={remoteAudioBlocked?"Tap to enable participant audio":remoteAudioMuted?"Unmute participant audio":"Mute participant audio"} title={remoteAudioBlocked?"Tap to enable participant audio":remoteAudioMuted?"Unmute participant audio":"Mute participant audio"}>{remoteAudioMuted||remoteAudioBlocked?<VolumeX/>:<Volume2/>}</button><button onClick={()=>setStatus("Screen sharing is available in a connected secure browser context")} title="Share screen"><MonitorUp/></button><button className={simOn?"control-on":""} onClick={()=>setSimOn(v=>!v)} title="Toggle holographic mode"><Sparkles/></button><button className="end-call" onClick={()=>connected?setEnding(true):setStatus("No active session to end")} title="End session"><X/></button></div></div></div>
          <aside className="assistant-column"><div className="assistant-card"><div className="assistant-header"><span className="assistant-orb"><Sparkles size={16}/></span><div><b>AI Assistant</b><small><i/> DEMO MODE</small></div><button onClick={()=>setAssistantOpen(v=>!v)}>{assistantOpen?<ChevronDown/>:<ArrowRight/>}</button></div>{assistantOpen&&<><div className="assistant-context"><Sparkles size={13}/> Demo adapter · no external model configured</div><div className="chat-messages">{messages.map((m,i)=><div key={i} className={`chat-msg ${m.role}`}><span>{m.role==="assistant"?<Sparkles size={12}/>:"YOU"}</span><p>{m.text}</p></div>)}</div><div className="suggestions"><small>TRY ASKING</small><button onClick={()=>setDraft("How does the hologram work?")}>How does the hologram work? <ArrowRight size={12}/></button><button onClick={()=>setDraft("How can I connect a participant?")}>How can I connect someone? <ArrowRight size={12}/></button></div><form className="chat-input" onSubmit={sendMessage}><input value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Ask about your session…"/><button aria-label="Send message"><ArrowRight size={16}/></button></form></>}</div><div className="session-info"><div className="info-head">SESSION DETAILS <CircleHelp size={14}/></div><div><span>ROOM STATUS</span><b>{connected?"Active":"Not connected"}</b></div><div><span>PARTICIPANTS</span><b>{connected?"You + peer":"1 / 2"}</b></div><div><span>SESSION ID</span><b>{roomCode||"Not created"}</b></div><div className="privacy-note"><ShieldCheck size={15}/> End-to-end media transport. Nothing recorded.</div></div></aside></div><div className="room-actions"><button className="button button-primary" onClick={createRoom}><Radio size={15}/> Create new session <ArrowRight size={15}/></button><div className="join-control"><input value={room} onChange={e=>setRoom(e.target.value)} onKeyDown={e=>e.key==="Enter"&&connectRoom()} placeholder="Enter room code" aria-label="Room code"/><button className="button button-outline button-small" onClick={()=>connectRoom()}>Join session</button></div>{roomCode&&<button className="copy-link" onClick={copyInvite}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?"Copied":"Copy invite link"}</button>}</div></div></div></section>
    <section className="usecases"><div className="section usecase-inner"><div><div className="eyebrow">A MORE HUMAN WAY TO CONNECT</div><h2>Where presence<br/><em>makes a difference.</em></h2></div><div className="usecase-list"><div><span>01</span><b>Education</b><small>Bring ideas closer across classrooms.</small></div><div><span>02</span><b>Healthcare</b><small>Make remote conversations feel personal.</small></div><div><span>03</span><b>Business</b><small>Meet with presence from anywhere.</small></div><div><span>04</span><b>Technical support</b><small>Guide hands-on work from a distance.</small></div></div></div></section>
    <footer><Brand/><span>© 2026 HOLOCONNECT AI <i>·</i> A software prototype for future-facing communication.</span><div><a href="#technology">Technology</a><a href="#studio">Open Studio</a><span>BUILT FOR HUMAN CONNECTION</span></div></footer>
    {ending&&<div className="modal-backdrop" role="dialog" aria-modal="true"><div className="confirm-modal"><button className="modal-close" onClick={()=>setEnding(false)}><X/></button><span className="modal-icon"><Radio/></span><h3>End this session?</h3><p>Your peer connection will close. You can create a new room any time.</p><div><button className="button button-outline" onClick={()=>setEnding(false)}>Stay connected</button><button className="button button-danger" onClick={leaveSession}>End session</button></div></div></div>}
  </main>;
}
