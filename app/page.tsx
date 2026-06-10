"use client";

import { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Activity, Link as LinkIcon, Compass, Gauge } from "lucide-react";

export default function Home() {
  const [roomCode, setRoomCode] = useState("");
  const [localIp, setLocalIp] = useState("");
  const [connected, setConnected] = useState(false);
  const [sensorData, setSensorData] = useState({ alpha: 0, beta: 0, gamma: 0, accelX: 0, accelY: 0, accelZ: 0 });
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setRoomCode(code);

    fetch("/api/ip")
      .then((res) => res.json())
      .then((data) => {
        setLocalIp(data.ip);
      })
      .catch((err) => console.error("Failed to fetch IP", err));
  }, []);

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

    socket.on("sensor-data", (data) => {
      setSensorData(data);
    });

    return () => {
      socket.disconnect();
    };
  }, [roomCode]);

  const baseUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
    ? window.location.origin 
    : (localIp ? `http://${localIp}:3000` : "");
  const mobileUrl = baseUrl ? `${baseUrl}/mobile?room=${roomCode}` : "";

  return (
    <div className="flex flex-col min-h-screen items-center justify-center p-6">
      
      {!connected ? (
        <div className="glass-panel rounded-3xl p-10 max-w-lg w-full flex flex-col items-center text-center space-y-8 animate-in fade-in zoom-in duration-500">
          <div className="bg-blue-500/20 p-4 rounded-full">
            <Smartphone className="w-12 h-12 text-blue-400" />
          </div>
          
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-2 text-white">Connect Device</h1>
            <p className="text-slate-400">Scan the QR code or enter the code manually on your phone to start streaming sensor data.</p>
          </div>

          {mobileUrl ? (
            <div className="p-4 bg-white rounded-2xl shadow-xl">
              <QRCodeSVG value={mobileUrl} size={200} />
            </div>
          ) : (
            <div className="h-[200px] w-[200px] flex items-center justify-center border-2 border-dashed border-slate-600 rounded-2xl">
              <span className="text-slate-500">Loading IP...</span>
            </div>
          )}

          <div className="flex items-center gap-4 bg-slate-800/50 px-6 py-4 rounded-2xl w-full">
            <LinkIcon className="w-6 h-6 text-blue-400" />
            <div className="flex-1 text-left">
              <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Room Code</div>
              <div className="text-2xl font-mono tracking-widest text-white">{roomCode || "------"}</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-5xl space-y-8 animate-in fade-in duration-700">
          <div className="flex items-center justify-between glass-panel px-8 py-6 rounded-2xl">
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-3">
                <Activity className="text-green-400" /> Live Telemetry
              </h1>
              <p className="text-slate-400">Receiving data from room {roomCode}</p>
            </div>
            <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 text-green-400 rounded-full text-sm font-medium">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Connected
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* 3D Visualization */}
            <div className="glass-panel rounded-3xl p-8 flex flex-col items-center justify-center min-h-[400px] [perspective:1000px]">
              <div className="text-slate-400 mb-8 self-start flex items-center gap-2">
                <Compass className="w-5 h-5" /> Gyroscope 3D
              </div>
              
              <div 
                className="w-48 h-48 bg-gradient-to-tr from-blue-600 to-purple-600 rounded-2xl shadow-2xl border border-white/20 flex items-center justify-center relative [transform-style:preserve-3d] transition-transform duration-75 ease-out"
                style={{
                  transform: `rotateX(${-sensorData.beta || 0}deg) rotateY(${sensorData.gamma || 0}deg) rotateZ(${-sensorData.alpha || 0}deg)`
                }}
              >
                <div className="absolute inset-0 bg-white/5 rounded-2xl" style={{ transform: 'translateZ(20px)' }} />
                <Smartphone className="w-16 h-16 text-white/80" style={{ transform: 'translateZ(40px)' }} />
              </div>
            </div>

            {/* Raw Data Readouts */}
            <div className="space-y-6">
              <div className="glass-panel rounded-3xl p-6">
                <div className="text-slate-400 mb-4 flex items-center gap-2">
                  <Compass className="w-5 h-5 text-blue-400" /> Gyroscope (Orientation)
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-slate-800/50 rounded-xl py-4">
                    <div className="text-xs text-slate-500 mb-1">Alpha (Z)</div>
                    <div className="font-mono text-xl text-white">{sensorData.alpha?.toFixed(1) || "0.0"}°</div>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl py-4">
                    <div className="text-xs text-slate-500 mb-1">Beta (X)</div>
                    <div className="font-mono text-xl text-white">{sensorData.beta?.toFixed(1) || "0.0"}°</div>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl py-4">
                    <div className="text-xs text-slate-500 mb-1">Gamma (Y)</div>
                    <div className="font-mono text-xl text-white">{sensorData.gamma?.toFixed(1) || "0.0"}°</div>
                  </div>
                </div>
              </div>

              <div className="glass-panel rounded-3xl p-6">
                <div className="text-slate-400 mb-4 flex items-center gap-2">
                  <Gauge className="w-5 h-5 text-purple-400" /> Accelerometer (Motion)
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-slate-800/50 rounded-xl py-4">
                    <div className="text-xs text-slate-500 mb-1">X-Axis</div>
                    <div className="font-mono text-xl text-white">{sensorData.accelX?.toFixed(2) || "0.00"}</div>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl py-4">
                    <div className="text-xs text-slate-500 mb-1">Y-Axis</div>
                    <div className="font-mono text-xl text-white">{sensorData.accelY?.toFixed(2) || "0.00"}</div>
                  </div>
                  <div className="bg-slate-800/50 rounded-xl py-4">
                    <div className="text-xs text-slate-500 mb-1">Z-Axis</div>
                    <div className="font-mono text-xl text-white">{sensorData.accelZ?.toFixed(2) || "0.00"}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
