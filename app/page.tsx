"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import { 
  Smartphone, Activity, Link as LinkIcon, Compass, Gauge, 
  Play, RotateCcw, Plus, Trash2, Award, Volume2, Star, 
  CheckCircle, Gamepad2, Info 
} from "lucide-react";

// Types
type GameState = "select" | "countdown" | "playing" | "results";
type AppTab = "game" | "telemetry";

interface SensorData {
  alpha: number;
  beta: number;
  gamma: number;
  accelX: number;
  accelY: number;
  accelZ: number;
}

interface DancePoint extends SensorData {
  t: number; // relative time in ms
}

interface Song {
  id: string;
  name: string;
  duration: number; // in ms
  points: DancePoint[];
}

export default function Home() {
  // Connection state
  const [roomCode, setRoomCode] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [connected, setConnected] = useState(false);
  const [sensorData, setSensorData] = useState<SensorData>({
    alpha: 0, beta: 0, gamma: 0,
    accelX: 0, accelY: 0, accelZ: 0
  });
  const socketRef = useRef<Socket | null>(null);

  // App layout state
  const [activeTab, setActiveTab] = useState<AppTab>("game");

  // Game/Recording state
  const [gameState, setGameState] = useState<GameState>("select");
  const [songs, setSongs] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  
  // Game Play variables
  const [gameTime, setGameTime] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(1);
  const [lastRating, setLastRating] = useState<"PERFECT" | "GOOD" | "OK" | "MISS" | "">("");
  const [ratingKey, setRatingKey] = useState(0); // To force re-mounting and re-triggering animations
  const [gameCountdown, setGameCountdown] = useState(3);
  const [stats, setStats] = useState({ perfect: 0, good: 0, ok: 0, miss: 0 });
  const [isRecordMode, setIsRecordMode] = useState(false);

  // Recorder variables
  const [songNameInput, setSongNameInput] = useState("");
  const [recordDurationInput, setRecordDurationInput] = useState(10); // seconds

  // Refs for tracking real-time data in loops
  const sensorDataRef = useRef<SensorData>({ alpha: 0, beta: 0, gamma: 0, accelX: 0, accelY: 0, accelZ: 0 });
  const livePlayBuffer = useRef<DancePoint[]>([]);
  const recordedPointsRef = useRef<DancePoint[]>([]);
  const recordStartTimeRef = useRef<number>(0);
  const isRecordingRef = useRef(false);
  const lastScoredSecondRef = useRef<number>(-1);

  // Audio trigger
  const playSound = (type: "perfect" | "good" | "ok" | "miss" | "countdown" | "go") => {
    if (typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      
      if (type === "perfect") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.08); // A5
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.start(now);
        osc.stop(now + 0.35);
      } else if (type === "good") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, now); // C5
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc.start(now);
        osc.stop(now + 0.25);
      } else if (type === "ok") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(392.00, now); // G4
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
      } else if (type === "miss") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(130, now);
        osc.frequency.linearRampToValueAtTime(80, now + 0.3);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      } else if (type === "countdown") {
        osc.type = "square";
        osc.frequency.setValueAtTime(440, now); // A4
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc.start(now);
        osc.stop(now + 0.1);
      } else if (type === "go") {
        osc.type = "square";
        osc.frequency.setValueAtTime(880, now); // A5
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      }
    } catch (e) {
      console.error("Audio error", e);
    }
  };

  // Pre-generate default song
  const generateDefaultSong = (): Song => {
    const points: DancePoint[] = [];
    const duration = 12000; // 12 seconds
    const interval = 33; // ~30 fps
    
    for (let t = 0; t < duration; t += interval) {
      const angle = (t / 1000) * 1.5 * Math.PI; // wave movement
      // Create a smooth rhythmic motion pattern
      points.push({
        t,
        accelX: Math.sin(angle) * 4,
        accelY: Math.cos(angle * 2) * 3 + 9.81, // offset gravity
        accelZ: Math.sin(angle) * 3,
        alpha: (Math.sin(angle) * 45 + 180) % 360,
        beta: Math.cos(angle) * 35,
        gamma: Math.sin(angle) * 20,
      });
    }
    return {
      id: "default-groove",
      name: "Badi Dance Starter (Default)",
      duration,
      points
    };
  };

  // Initialize room and custom songs
  useEffect(() => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setRoomCode(code);

    fetch("/api/ip")
      .then((res) => res.json())
      .then((data) => setLocalIp(data.ip))
      .catch((err) => console.error("Failed to fetch IP", err));

    // Load custom songs
    const defaultSong = generateDefaultSong();
    const stored = localStorage.getItem("badi_dance_songs");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSongs([defaultSong, ...parsed]);
      } catch (e) {
        setSongs([defaultSong]);
      }
    } else {
      setSongs([defaultSong]);
    }
  }, []);

  // Socket setup
  useEffect(() => {
    if (!roomCode) return;

    const hostname = window.location.hostname;
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || `http://${hostname}:3001`;
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("join-room", { room: roomCode, role: "desktop" });
    });

    socket.on("device_connected", (data) => {
      if (data.role === "mobile") {
        setConnected(true);
      }
    });

    socket.on("sensor-data", (data: SensorData) => {
      setSensorData(data);
      sensorDataRef.current = data;

      // If recording, collect points
      if (isRecordingRef.current) {
        const elapsed = Date.now() - recordStartTimeRef.current;
        recordedPointsRef.current.push({
          t: elapsed,
          ...data
        });
      }

      // If playing, collect in buffer
      if (gameState === "playing" && !isRecordMode) {
        const relativeTime = gameTime;
        livePlayBuffer.current.push({
          t: relativeTime,
          ...data
        });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [roomCode, gameState, gameTime, isRecordMode]);

  // Game countdown timer logic
  useEffect(() => {
    if (gameState !== "countdown") return;

    setGameCountdown(3);
    playSound("countdown");

    const timer = setInterval(() => {
      setGameCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          playSound("go");
          
          if (isRecordMode) {
            // Start recording
            recordedPointsRef.current = [];
            recordStartTimeRef.current = Date.now();
            isRecordingRef.current = true;
          } else {
            // Start playing
            livePlayBuffer.current = [];
            setScore(0);
            setCombo(1);
            setStats({ perfect: 0, good: 0, ok: 0, miss: 0 });
            setLastRating("");
            lastScoredSecondRef.current = -1;
          }
          
          setGameTime(0);
          setGameState("playing");
          return 0;
        } else {
          playSound("countdown");
          return prev - 1;
        }
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameState, isRecordMode]);

  // Main playing game/recording loop (ticks ~30fps)
  useEffect(() => {
    if (gameState !== "playing" || !currentSong) return;

    let lastTick = Date.now();
    const tickInterval = setInterval(() => {
      const now = Date.now();
      const delta = now - lastTick;
      lastTick = now;

      setGameTime((prevTime) => {
        const nextTime = prevTime + delta;
        const totalDuration = isRecordMode ? recordDurationInput * 1000 : currentSong.duration;

        if (nextTime >= totalDuration) {
          clearInterval(tickInterval);
          if (isRecordMode) {
            // End recording and save
            isRecordingRef.current = false;
            saveRecordedSong();
          } else {
            // End game and show results
            setGameState("results");
          }
          return totalDuration;
        }

        // Scoring trigger logic: run score check every 1 second interval
        if (!isRecordMode) {
          const currentSecond = Math.floor(nextTime / 1000);
          if (currentSecond > lastScoredSecondRef.current && currentSecond > 0) {
            scoreLastSecond(currentSecond);
            lastScoredSecondRef.current = currentSecond;
          }
        }

        return nextTime;
      });
    }, 33);

    return () => clearInterval(tickInterval);
  }, [gameState, currentSong, isRecordMode, recordDurationInput]);

  // Save the recorded choreography
  const saveRecordedSong = () => {
    const songName = songNameInput.trim() || `Custom Dance ${songs.length}`;
    const newSong: Song = {
      id: "custom-" + Date.now(),
      name: songName,
      duration: recordDurationInput * 1000,
      points: [...recordedPointsRef.current]
    };

    const updated = [...songs, newSong];
    setSongs(updated);
    
    // Save custom songs only to local storage (excluding default song)
    const customOnly = updated.filter(s => s.id !== "default-groove");
    localStorage.setItem("badi_dance_songs", JSON.stringify(customOnly));

    // Reset inputs & state
    setSongNameInput("");
    setGameState("select");
  };

  // Grade the player's last 1-second dance segment
  const scoreLastSecond = (secondIndex: number) => {
    if (!currentSong) return;

    const startTime = (secondIndex - 1) * 1000;
    const endTime = secondIndex * 1000;

    // Filter reference points inside this second window
    const refSegment = currentSong.points.filter(p => p.t >= startTime && p.t < endTime);
    // Grab player points collected in buffer
    const playerSegment = [...livePlayBuffer.current];
    livePlayBuffer.current = []; // flush buffer

    if (refSegment.length === 0 || playerSegment.length === 0) {
      triggerRating("MISS");
      return;
    }

    let totalSim = 0;
    let comparisons = 0;

    // Compare each player sample with closest time match in reference
    playerSegment.forEach((p) => {
      let closestRef = refSegment[0];
      let minDiff = Infinity;
      
      refSegment.forEach((r) => {
        const diff = Math.abs(r.t - p.t);
        if (diff < minDiff) {
          minDiff = diff;
          closestRef = r;
        }
      });

      // 1. Accel Euclidean Distance
      const d_accel = Math.sqrt(
        Math.pow(p.accelX - closestRef.accelX, 2) +
        Math.pow(p.accelY - closestRef.accelY, 2) +
        Math.pow(p.accelZ - closestRef.accelZ, 2)
      );
      const d_accel_norm = Math.min(d_accel, 18) / 18; // capped at 18 m/s^2

      // 2. Gyro Angle Differences (with wrap-around check)
      const angleDiff = (a: number, b: number, max: number) => {
        let diff = Math.abs(a - b) % max;
        if (diff > max / 2) diff = max - diff;
        return diff;
      };

      const d_alpha = angleDiff(p.alpha, closestRef.alpha, 360) / 180;
      const d_beta = angleDiff(p.beta, closestRef.beta, 360) / 180;
      const d_gamma = angleDiff(p.gamma, closestRef.gamma, 180) / 90;
      const d_gyro = (d_alpha + d_beta + d_gamma) / 3;

      // 3. Combined similarity (60% accel, 40% gyro)
      const similarity = 1 - (0.6 * d_accel_norm + 0.4 * d_gyro);
      totalSim += Math.max(0, similarity);
      comparisons++;
    });

    const averageSimilarity = totalSim / comparisons;

    // Grade scoring thresholds
    if (averageSimilarity > 0.83) {
      triggerRating("PERFECT");
    } else if (averageSimilarity > 0.70) {
      triggerRating("GOOD");
    } else if (averageSimilarity > 0.50) {
      triggerRating("OK");
    } else {
      triggerRating("MISS");
    }
  };

  const triggerRating = (rating: "PERFECT" | "GOOD" | "OK" | "MISS") => {
    setLastRating(rating);
    setRatingKey((prev) => prev + 1);

    if (rating === "PERFECT") {
      playSound("perfect");
      setStats(prev => ({ ...prev, perfect: prev.perfect + 1 }));
      setScore(prev => prev + 1000 * combo);
      setCombo(prev => Math.min(prev + 1, 4));
    } else if (rating === "GOOD") {
      playSound("good");
      setStats(prev => ({ ...prev, good: prev.good + 1 }));
      setScore(prev => prev + 500 * combo);
      setCombo(prev => Math.min(prev + 1, 4));
    } else if (rating === "OK") {
      playSound("ok");
      setStats(prev => ({ ...prev, ok: prev.ok + 1 }));
      setScore(prev => prev + 200);
      // Combo stays same
    } else {
      playSound("miss");
      setStats(prev => ({ ...prev, miss: prev.miss + 1 }));
      setCombo(1); // Break combo
    }
  };

  // Get active reference rotation frame during game
  const getRefPointAt = (timeMs: number): SensorData => {
    if (!currentSong || currentSong.points.length === 0) {
      return { alpha: 0, beta: 0, gamma: 0, accelX: 0, accelY: 0, accelZ: 0 };
    }
    let closest = currentSong.points[0];
    let minDiff = Infinity;
    for (let i = 0; i < currentSong.points.length; i++) {
      const diff = Math.abs(currentSong.points[i].t - timeMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = currentSong.points[i];
      }
    }
    return closest;
  };

  const currentRefPoint = getRefPointAt(gameTime);

  // Helper to render rating styling
  const getRatingColorClass = (r: string) => {
    switch (r) {
      case "PERFECT": return "text-yellow-400 drop-shadow-[0_0_20px_rgba(234,179,8,0.6)] font-extrabold";
      case "GOOD": return "text-green-400 drop-shadow-[0_0_15px_rgba(74,222,128,0.5)] font-bold";
      case "OK": return "text-blue-400 drop-shadow-[0_0_10px_rgba(96,165,250,0.4)] font-medium";
      case "MISS": return "text-red-500 drop-shadow-[0_0_15px_rgba(239,68,68,0.6)] font-semibold";
      default: return "";
    }
  };

  // Helper to calculate stars based on score
  const getStars = (finalScore: number) => {
    if (finalScore >= 10000) return 5;
    if (finalScore >= 7500) return 4;
    if (finalScore >= 5000) return 3;
    if (finalScore >= 2500) return 2;
    if (finalScore > 0) return 1;
    return 0;
  };

  // Delete a custom choreography
  const deleteSong = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Stop trigger play
    const updated = songs.filter(s => s.id !== id);
    setSongs(updated);
    const customOnly = updated.filter(s => s.id !== "default-groove");
    localStorage.setItem("badi_dance_songs", JSON.stringify(customOnly));
  };

  const starsCount = getStars(score);
  const isMegastar = score >= 11000;

  const baseUrl = typeof window !== "undefined" && window.location.hostname !== "localhost" 
    ? window.location.origin 
    : (localIp ? `http://${localIp}:3000` : "");
  const mobileUrl = baseUrl ? `${baseUrl}/mobile?room=${roomCode}` : "";

  return (
    <div className="flex flex-col min-h-screen items-center p-6 text-white bg-slate-950">
      
      {/* Header */}
      <header className="w-full max-w-5xl flex items-center justify-between mb-8 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Gamepad2 className="w-8 h-8 text-pink-500 animate-pulse" />
          <h1 className="text-3xl font-black tracking-wider bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-400 bg-clip-text text-transparent">
            BADI DANCE
          </h1>
        </div>
        {connected && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-semibold">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              Tél. Connecté
            </div>
            <div className="text-xs text-slate-500 font-mono">Code: {roomCode}</div>
          </div>
        )}
      </header>

      {/* Connection Screen (Unconnected) */}
      {!connected ? (
        <div className="my-auto glass-panel rounded-3xl p-10 max-w-lg w-full flex flex-col items-center text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="bg-gradient-to-tr from-pink-500/20 to-purple-500/20 p-5 rounded-full border border-pink-500/20">
            <Smartphone className="w-12 h-12 text-pink-400 animate-bounce" />
          </div>
          
          <div>
            <h2 className="text-3xl font-bold tracking-tight mb-2 text-white">Connexion Mobile</h2>
            <p className="text-slate-400 text-sm max-w-sm mx-auto">
              Scannez le QR code ci-dessous avec votre smartphone pour le transformer en manette de danse sans fil.
            </p>
          </div>

          {mobileUrl ? (
            <div className="p-4 bg-white rounded-2xl shadow-2xl relative group">
              <QRCodeSVG value={mobileUrl} size={200} />
              <div className="absolute inset-0 border-4 border-pink-500/0 rounded-2xl group-hover:border-pink-500/20 transition-all pointer-events-none" />
            </div>
          ) : (
            <div className="h-[200px] w-[200px] flex items-center justify-center border-2 border-dashed border-slate-700 rounded-2xl">
              <span className="text-slate-500 text-sm animate-pulse">Obtention de l'IP...</span>
            </div>
          )}

          <div className="flex items-center gap-4 bg-slate-900/60 px-6 py-4 rounded-2xl w-full border border-slate-800">
            <LinkIcon className="w-6 h-6 text-pink-400" />
            <div className="flex-1 text-left">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Code du Salon</div>
              <div className="text-2xl font-mono tracking-widest text-white font-extrabold">{roomCode || "------"}</div>
            </div>
          </div>
        </div>
      ) : (
        /* Connected Dashboard */
        <div className="w-full max-w-5xl space-y-6">
          
          {/* Tab Navigation */}
          {gameState === "select" && (
            <div className="flex border-b border-slate-800">
              <button
                onClick={() => setActiveTab("game")}
                className={`px-6 py-3 font-semibold text-sm transition-all border-b-2 flex items-center gap-2 ${
                  activeTab === "game"
                    ? "border-pink-500 text-pink-400 bg-pink-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Gamepad2 className="w-4 h-4" /> Mode Jeu (Dance)
              </button>
              <button
                onClick={() => setActiveTab("telemetry")}
                className={`px-6 py-3 font-semibold text-sm transition-all border-b-2 flex items-center gap-2 ${
                  activeTab === "telemetry"
                    ? "border-purple-500 text-purple-400 bg-purple-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Activity className="w-4 h-4" /> Télémétrie & Capteurs
              </button>
            </div>
          )}

          {/* TELEMETRY TAB CONTENT */}
          {activeTab === "telemetry" && gameState === "select" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in duration-300">
              {/* 3D Visualizer */}
              <div className="glass-panel rounded-3xl p-8 flex flex-col items-center justify-center min-h-[400px] [perspective:1000px]">
                <div className="text-slate-400 mb-8 self-start flex items-center gap-2">
                  <Compass className="w-5 h-5 text-purple-400" /> Gyroscope 3D en Direct
                </div>
                
                <div 
                  className="w-44 h-80 bg-gradient-to-tr from-purple-600 via-indigo-600 to-pink-500 rounded-3xl shadow-2xl border border-white/20 flex items-center justify-center relative [transform-style:preserve-3d] transition-transform duration-75 ease-out"
                  style={{
                    transform: `rotateX(${-sensorData.beta || 0}deg) rotateY(${sensorData.gamma || 0}deg) rotateZ(${-sensorData.alpha || 0}deg)`
                  }}
                >
                  <div className="absolute inset-0 bg-white/5 rounded-3xl" style={{ transform: "translateZ(15px)" }} />
                  <div className="absolute top-4 w-12 h-1 bg-white/40 rounded-full" style={{ transform: "translateZ(25px)" }} />
                  <Smartphone className="w-16 h-16 text-white/80" style={{ transform: "translateZ(40px)" }} />
                  <div className="absolute bottom-4 w-4 h-4 rounded-full border-2 border-white/40" style={{ transform: "translateZ(25px)" }} />
                </div>
              </div>

              {/* Data readouts */}
              <div className="space-y-6">
                <div className="glass-panel rounded-3xl p-6">
                  <h3 className="text-slate-400 mb-4 flex items-center gap-2 font-medium">
                    <Compass className="w-5 h-5 text-blue-400" /> Orientation (Gyroscope)
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="bg-slate-900/60 rounded-2xl py-4 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Alpha (Z)</div>
                      <div className="font-mono text-xl text-white font-bold">{sensorData.alpha?.toFixed(1) || "0.0"}°</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-2xl py-4 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Beta (X)</div>
                      <div className="font-mono text-xl text-white font-bold">{sensorData.beta?.toFixed(1) || "0.0"}°</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-2xl py-4 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Gamma (Y)</div>
                      <div className="font-mono text-xl text-white font-bold">{sensorData.gamma?.toFixed(1) || "0.0"}°</div>
                    </div>
                  </div>
                </div>

                <div className="glass-panel rounded-3xl p-6">
                  <h3 className="text-slate-400 mb-4 flex items-center gap-2 font-medium">
                    <Gauge className="w-5 h-5 text-pink-400" /> Accélération (Mouvement)
                  </h3>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="bg-slate-900/60 rounded-2xl py-4 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">X-Axis</div>
                      <div className="font-mono text-xl text-white font-bold">{sensorData.accelX?.toFixed(2) || "0.00"}</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-2xl py-4 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Y-Axis</div>
                      <div className="font-mono text-xl text-white font-bold">{sensorData.accelY?.toFixed(2) || "0.00"}</div>
                    </div>
                    <div className="bg-slate-900/60 rounded-2xl py-4 border border-slate-800">
                      <div className="text-xs text-slate-500 mb-1">Z-Axis</div>
                      <div className="font-mono text-xl text-white font-bold">{sensorData.accelZ?.toFixed(2) || "0.00"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* GAME TAB CONTENT */}
          {activeTab === "game" && (
            <div className="w-full">
              
              {/* STATE 1: SELECT SONGS & RECORDER */}
              {gameState === "select" && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in duration-300">
                  
                  {/* Songs list */}
                  <div className="lg:col-span-2 space-y-4">
                    <h3 className="text-xl font-bold flex items-center gap-2 mb-2">
                      <Gamepad2 className="text-pink-500" /> Choisissez une Danse
                    </h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {songs.map((song) => (
                        <div
                          key={song.id}
                          onClick={() => {
                            setCurrentSong(song);
                            setIsRecordMode(false);
                            setGameState("countdown");
                          }}
                          className="glass-panel p-5 rounded-2xl cursor-pointer border border-slate-800 hover:border-pink-500/40 hover:bg-pink-500/5 transition-all flex flex-col justify-between h-40 group relative overflow-hidden"
                        >
                          {/* Background Glow on hover */}
                          <div className="absolute -right-10 -bottom-10 w-24 h-24 bg-pink-500/10 rounded-full blur-2xl group-hover:scale-150 transition-all duration-500" />
                          
                          <div>
                            <div className="flex justify-between items-start">
                              <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-950 font-bold tracking-wider text-slate-400 border border-slate-800">
                                {song.id === "default-groove" ? "Star Choreo" : "Custom Recording"}
                              </span>
                              {song.id !== "default-groove" && (
                                <button
                                  onClick={(e) => deleteSong(song.id, e)}
                                  className="text-slate-500 hover:text-red-400 p-1 rounded-md transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                            <h4 className="text-lg font-bold mt-2 text-white group-hover:text-pink-400 transition-colors">
                              {song.name}
                            </h4>
                          </div>

                          <div className="flex items-center justify-between text-xs text-slate-400 z-10">
                            <div>Durée : {song.duration / 1000}s</div>
                            <div className="bg-pink-500 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recorder Form */}
                  <div className="glass-panel rounded-3xl p-6 border border-slate-800 h-fit space-y-6">
                    <div>
                      <h3 className="text-xl font-bold flex items-center gap-2 text-pink-400 mb-1">
                        <Plus className="w-6 h-6" /> Enregistrer un Mouvement
                      </h3>
                      <p className="text-slate-400 text-xs">
                        Créez votre propre chorégraphie. Donnez un nom, définissez la durée et enregistrez en mimant le geste.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">Nom de la danse</label>
                        <input
                          type="text"
                          placeholder="ex: Coup de Poing Stylé"
                          value={songNameInput}
                          onChange={(e) => setSongNameInput(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-pink-500 transition-colors"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-slate-500 font-bold block mb-1">Durée (secondes)</label>
                        <select
                          value={recordDurationInput}
                          onChange={(e) => setRecordDurationInput(Number(e.target.value))}
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-pink-500 transition-colors"
                        >
                          <option value={5}>5 secondes</option>
                          <option value={10}>10 secondes</option>
                          <option value={15}>15 secondes</option>
                          <option value={20}>20 secondes</option>
                        </select>
                      </div>

                      <button
                        onClick={() => {
                          setCurrentSong({ id: "temp-record", name: songNameInput, duration: recordDurationInput * 1000, points: [] });
                          setIsRecordMode(true);
                          setGameState("countdown");
                        }}
                        className="w-full bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white rounded-xl py-3 font-bold text-sm shadow-lg shadow-pink-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Volume2 className="w-4 h-4" /> Enregistrer le geste
                      </button>
                    </div>

                    <div className="flex items-start gap-2 text-[10px] text-slate-500 bg-slate-950/40 p-3 rounded-xl border border-slate-900">
                      <Info className="w-4 h-4 text-purple-400 shrink-0" />
                      <p>
                        Après avoir cliqué, vous aurez un décompte de 3 secondes avant l'enregistrement. Tenez bien le téléphone dans la main droite !
                      </p>
                    </div>
                  </div>

                </div>
              )}

              {/* STATE 2: COUNTDOWN SCREEN */}
              {gameState === "countdown" && (
                <div className="my-16 flex flex-col items-center justify-center space-y-6">
                  <div className="text-slate-400 uppercase tracking-widest text-sm font-bold">
                    {isRecordMode ? "Préparation de l'enregistrement" : `Préparation : ${currentSong?.name}`}
                  </div>
                  <div className="relative flex items-center justify-center w-40 h-40">
                    {/* Ring animation */}
                    <div className="absolute inset-0 rounded-full border-4 border-pink-500/10 border-t-pink-500 animate-spin" />
                    <div className="text-7xl font-black text-white select-none animate-in scale-in duration-300 drop-shadow-[0_0_30px_rgba(236,72,153,0.5)]">
                      {gameCountdown}
                    </div>
                  </div>
                  <div className="text-slate-400 text-sm italic">
                    {isRecordMode ? "Tenez-vous prêt à danser !" : "Imitez le modèle coach à gauche !"}
                  </div>
                </div>
              )}

              {/* STATE 3: PLAYING / RECORDING GRAPHICS */}
              {gameState === "playing" && currentSong && (
                <div className="space-y-6 animate-in fade-in duration-300">
                  
                  {/* Top Bar with timeline & live stats */}
                  <div className="glass-panel p-6 rounded-3xl border border-slate-800 space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs text-pink-500 uppercase tracking-widest font-bold">
                          {isRecordMode ? "Enregistrement en Cours" : "Mode Jeu - Dansez !"}
                        </h4>
                        <h3 className="text-xl font-bold text-white">{currentSong.name}</h3>
                      </div>
                      
                      {!isRecordMode ? (
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <span className="text-[10px] text-slate-500 font-bold block">SCORE</span>
                            <span className="text-3xl font-mono font-black text-yellow-400 tabular-nums">
                              {score.toLocaleString()}
                            </span>
                          </div>
                          <div className={`px-4 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-2xl flex flex-col items-center justify-center min-w-16 transition-all ${combo > 1 ? "animate-combo" : ""}`}>
                            <span className="text-[9px] text-yellow-500 font-black">COMBO</span>
                            <span className="text-xl font-black text-yellow-300 font-mono">x{combo}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-full text-sm font-semibold border border-red-500/30 animate-pulse">
                          <div className="w-2.5 h-2.5 bg-red-500 rounded-full" />
                          {recordedPointsRef.current.length} points sauvés
                        </div>
                      )}
                    </div>

                    {/* Timeline progress bar */}
                    <div>
                      <div className="w-full bg-slate-900 rounded-full h-3 overflow-hidden border border-slate-800">
                        <div 
                          className={`h-full transition-all duration-75 ease-out rounded-full ${
                            isRecordMode 
                              ? "bg-gradient-to-r from-red-600 to-pink-500" 
                              : "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500"
                          }`}
                          style={{
                            width: `${(gameTime / (isRecordMode ? recordDurationInput * 1000 : currentSong.duration)) * 10000 / 100}%`
                          }}
                        />
                      </div>
                      <div className="flex justify-between text-xs text-slate-500 mt-1 font-mono">
                        <span>{(gameTime / 1000).toFixed(1)}s</span>
                        <span>{(isRecordMode ? recordDurationInput : currentSong.duration / 1000).toFixed(1)}s</span>
                      </div>
                    </div>
                  </div>

                  {/* Play Interface - Twin 3D Coaches */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    
                    {/* Left: Reference Model Phone (Yellow/Gold) */}
                    <div className="glass-panel rounded-3xl p-8 flex flex-col items-center justify-center min-h-[350px] border border-slate-800 relative [perspective:1000px]">
                      <div className="absolute top-4 left-6 text-yellow-400 font-bold uppercase tracking-widest text-[10px] flex items-center gap-2">
                        <Award className="w-4 h-4 animate-bounce" /> MODÈLE DE RÉFÉRENCE (COACH)
                      </div>
                      
                      {isRecordMode ? (
                        <div className="text-slate-500 text-center text-sm font-medium px-8 space-y-4">
                          <Smartphone className="w-16 h-16 text-red-500 animate-pulse mx-auto mb-2" />
                          Faites vos mouvements maintenant. Ils seront mémorisés pour être reproduits par la suite.
                        </div>
                      ) : (
                        <div 
                          className="w-40 h-72 bg-gradient-to-tr from-yellow-600 via-amber-500 to-orange-400 rounded-3xl shadow-2xl border border-white/20 flex items-center justify-center relative [transform-style:preserve-3d] transition-all duration-150 ease-out"
                          style={{
                            transform: `rotateX(${-currentRefPoint.beta || 0}deg) rotateY(${currentRefPoint.gamma || 0}deg) rotateZ(${-currentRefPoint.alpha || 0}deg)`
                          }}
                        >
                          <div className="absolute inset-0 bg-white/5 rounded-3xl" style={{ transform: "translateZ(15px)" }} />
                          <Smartphone className="w-16 h-16 text-white/80" style={{ transform: "translateZ(30px)" }} />
                        </div>
                      )}
                    </div>

                    {/* Right: Player Phone (Live tracking) */}
                    <div className="glass-panel rounded-3xl p-8 flex flex-col items-center justify-center min-h-[350px] border border-slate-800 relative [perspective:1000px]">
                      <div className="absolute top-4 left-6 text-pink-400 font-bold uppercase tracking-widest text-[10px] flex items-center gap-2">
                        <Smartphone className="w-4 h-4" /> VOTRE TÉLÉPHONE (JOUEUR)
                      </div>
                      
                      {/* Rating floater layer */}
                      {lastRating && (
                        <div 
                          key={ratingKey} 
                          className={`absolute top-20 text-3xl font-black tracking-widest animate-rating ${getRatingColorClass(lastRating)}`}
                        >
                          {lastRating}
                        </div>
                      )}

                      <div 
                        className="w-40 h-72 bg-gradient-to-tr from-pink-600 via-purple-600 to-indigo-500 rounded-3xl shadow-2xl border border-white/20 flex items-center justify-center relative [transform-style:preserve-3d] transition-transform duration-75 ease-out"
                        style={{
                          transform: `rotateX(${-sensorData.beta || 0}deg) rotateY(${sensorData.gamma || 0}deg) rotateZ(${-sensorData.alpha || 0}deg)`
                        }}
                      >
                        <div className="absolute inset-0 bg-white/5 rounded-3xl" style={{ transform: "translateZ(15px)" }} />
                        <Smartphone className="w-16 h-16 text-white/80" style={{ transform: "translateZ(30px)" }} />
                      </div>
                    </div>

                  </div>
                </div>
              )}

              {/* STATE 4: RESULTS DISPLAY */}
              {gameState === "results" && currentSong && (
                <div className="glass-panel rounded-3xl p-8 border border-slate-800 max-w-xl mx-auto text-center space-y-8 animate-in zoom-in duration-500">
                  <div className="flex flex-col items-center space-y-2">
                    <div className="p-4 bg-yellow-500/10 rounded-full border border-yellow-500/20">
                      <Award className="w-14 h-14 text-yellow-400 animate-bounce" />
                    </div>
                    <h2 className="text-3xl font-black tracking-tight text-white mt-4">DANCE TERMINÉE !</h2>
                    <p className="text-slate-400 text-sm font-semibold">{currentSong.name}</p>
                  </div>

                  {/* Stars Rating Gauge */}
                  <div className="flex justify-center items-center gap-2">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star 
                        key={s} 
                        className={`w-10 h-10 ${
                          s <= starsCount 
                            ? "text-yellow-400 fill-current drop-shadow-[0_0_10px_rgba(234,179,8,0.5)] animate-pulse" 
                            : "text-slate-700"
                        }`}
                      />
                    ))}
                  </div>

                  {/* Score readout */}
                  <div className="space-y-1">
                    <div className="text-xs text-slate-500 uppercase tracking-widest font-black">Score Total</div>
                    <div className={`text-5xl font-mono font-black ${isMegastar ? "animate-rainbow" : "text-yellow-400 font-extrabold"}`}>
                      {score.toLocaleString()}
                    </div>
                    {isMegastar && (
                      <div className="text-xs text-yellow-400 font-black tracking-widest uppercase animate-pulse">
                        ⭐ Rank : MEGASTAR ⭐
                      </div>
                    )}
                  </div>

                  {/* Details stats table */}
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-yellow-500/10 rounded-xl py-3 border border-yellow-500/15">
                      <div className="text-yellow-400 font-extrabold">Perfect</div>
                      <div className="font-mono text-lg font-bold text-white mt-1">{stats.perfect}</div>
                    </div>
                    <div className="bg-green-500/10 rounded-xl py-3 border border-green-500/15">
                      <div className="text-green-400 font-bold">Good</div>
                      <div className="font-mono text-lg font-bold text-white mt-1">{stats.good}</div>
                    </div>
                    <div className="bg-blue-500/10 rounded-xl py-3 border border-blue-500/15">
                      <div className="text-blue-400 font-bold">OK</div>
                      <div className="font-mono text-lg font-bold text-white mt-1">{stats.ok}</div>
                    </div>
                    <div className="bg-red-500/10 rounded-xl py-3 border border-red-500/15">
                      <div className="text-red-500 font-bold">Miss</div>
                      <div className="font-mono text-lg font-bold text-white mt-1">{stats.miss}</div>
                    </div>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex gap-4 pt-2">
                    <button
                      onClick={() => setGameState("countdown")}
                      className="flex-1 bg-slate-900 border border-slate-800 hover:bg-slate-800 text-white rounded-xl py-3 font-semibold transition-colors flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" /> Rejouer
                    </button>
                    <button
                      onClick={() => setGameState("select")}
                      className="flex-1 bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-400 hover:to-purple-500 text-white rounded-xl py-3 font-bold shadow-lg shadow-pink-500/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Gamepad2 className="w-4 h-4" /> Chansons
                    </button>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      )}

    </div>
  );
}
