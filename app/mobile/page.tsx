"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Smartphone, Zap, CheckCircle, ShieldAlert } from "lucide-react";

export default function MobileView() {
  const [roomCode, setRoomCode] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const socketRef = useRef<Socket | null>(null);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    // Get room from URL query parameters
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      setRoomCode(room);
    }
  }, []);

  const connectToRoom = () => {
    if (!roomCode || roomCode.length < 5) {
      setErrorMsg("Please enter a valid room code.");
      return;
    }

    setStatus("connecting");
    const hostname = window.location.hostname;
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || `http://${hostname}:3001`;
    const socket = io(socketUrl);
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("join-room", { room: roomCode, role: "mobile" });
    });

    socket.on("connect_error", () => {
      setStatus("error");
      setErrorMsg("Failed to connect to the server.");
    });
  };

  const startSensors = async () => {
    try {
      // 1. Request Device Orientation Permission FIRST (required for iOS 13+)
      // This MUST be the very first await, otherwise Safari loses the "user gesture" context
      if (
        typeof (DeviceOrientationEvent as any).requestPermission === "function"
      ) {
        const permissionState = await (DeviceOrientationEvent as any).requestPermission();
        if (permissionState !== "granted") {
          setErrorMsg("Permission for device sensors was denied.");
          return;
        }
      }

      // 2. Request Wake Lock to keep screen on
      if ("wakeLock" in navigator) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
          console.log("Screen Wake Lock active");
        } catch (err: any) {
          console.error("Wake Lock error:", err);
        }
      }

      // 3. Attach event listeners
      window.addEventListener("deviceorientation", handleOrientation);
      window.addEventListener("devicemotion", handleMotion);
      
      setIsStreaming(true);
      setErrorMsg("");

    } catch (error: any) {
      console.error(error);
      setErrorMsg("Error starting sensors: " + error.message);
    }
  };

  const stopSensors = () => {
    window.removeEventListener("deviceorientation", handleOrientation);
    window.removeEventListener("devicemotion", handleMotion);
    if (wakeLockRef.current) {
      wakeLockRef.current.release();
      wakeLockRef.current = null;
    }
    setIsStreaming(false);
  };

  // Throttle sending data (e.g. max 30 fps) to avoid overwhelming socket
  const lastSendTime = useRef(0);
  const currentData = useRef({
    alpha: 0, beta: 0, gamma: 0,
    accelX: 0, accelY: 0, accelZ: 0
  });

  const handleOrientation = (event: DeviceOrientationEvent) => {
    currentData.current.alpha = event.alpha || 0;
    currentData.current.beta = event.beta || 0;
    currentData.current.gamma = event.gamma || 0;
    emitData();
  };

  const handleMotion = (event: DeviceMotionEvent) => {
    currentData.current.accelX = event.accelerationIncludingGravity?.x || 0;
    currentData.current.accelY = event.accelerationIncludingGravity?.y || 0;
    currentData.current.accelZ = event.accelerationIncludingGravity?.z || 0;
    emitData();
  };

  const emitData = () => {
    const now = Date.now();
    if (now - lastSendTime.current > 33) { // ~30 FPS
      if (socketRef.current && status === "connected") {
        socketRef.current.emit("sensor-data", {
          room: roomCode,
          data: currentData.current
        });
      }
      lastSendTime.current = now;
    }
  };

  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-6 bg-slate-950 text-white">
      <div className="glass-panel w-full max-w-sm p-8 rounded-3xl flex flex-col items-center space-y-8 relative overflow-hidden">
        
        {/* Background glow when streaming */}
        <div className={`absolute inset-0 bg-blue-500/20 transition-opacity duration-1000 ${isStreaming ? 'opacity-100' : 'opacity-0'}`} />

        <div className="z-10 flex flex-col items-center w-full">
          <Smartphone className={`w-16 h-16 mb-4 ${isStreaming ? 'text-blue-400 animate-pulse' : 'text-slate-400'}`} />
          
          <h1 className="text-2xl font-bold mb-2 text-center">Mobile Controller</h1>
          
          {status !== "connected" && (
            <div className="w-full space-y-4 mt-6">
              <input
                type="text"
                placeholder="Enter Room Code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="w-full bg-slate-800/50 border border-slate-600 rounded-xl px-4 py-3 text-center text-xl tracking-widest font-mono focus:outline-none focus:border-blue-500 transition-colors"
                maxLength={6}
              />
              <button
                onClick={connectToRoom}
                disabled={status === "connecting"}
                className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3 font-semibold transition-colors disabled:opacity-50"
              >
                {status === "connecting" ? "Connecting..." : "Connect to Room"}
              </button>
            </div>
          )}

          {status === "connected" && !isStreaming && (
            <div className="w-full flex flex-col items-center mt-6 space-y-6">
              <div className="flex items-center gap-2 text-green-400 font-medium">
                <CheckCircle className="w-5 h-5" /> Connected to {roomCode}
              </div>
              <p className="text-center text-slate-400 text-sm">
                To start sending data, we need your permission to access the device sensors and keep the screen awake.
              </p>
              <button
                onClick={startSensors}
                className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-2xl py-4 font-bold text-lg shadow-lg shadow-blue-500/30 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Zap className="w-6 h-6" /> Start Sensors
              </button>
            </div>
          )}

          {isStreaming && (
            <div className="w-full flex flex-col items-center mt-8 space-y-6">
              <div className="w-24 h-24 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
              <div className="text-xl font-bold text-blue-400 text-center">
                Streaming Data...
              </div>
              <p className="text-slate-400 text-center text-sm">
                Your screen will stay awake automatically. Move your phone to see the dashboard react.
              </p>
              <button
                onClick={stopSensors}
                className="w-full bg-slate-800 hover:bg-slate-700 text-white rounded-xl py-3 font-medium transition-colors border border-slate-600"
              >
                Stop Streaming
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl flex items-start gap-3 w-full">
              <ShieldAlert className="w-5 h-5 text-red-400 shrink-0" />
              <p className="text-sm text-red-200">{errorMsg}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
