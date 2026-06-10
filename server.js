const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins for local development
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a client (desktop or mobile) joins a room
  socket.on("join-room", ({ room, role }) => {
    socket.join(room);
    console.log(`Socket ${socket.id} joined room ${room} as ${role}`);
    
    // Notify the room that a new device connected
    socket.to(room).emit("device_connected", { role, id: socket.id });
  });

  // Relay sensor data from mobile to desktop
  socket.on("sensor-data", ({ room, data }) => {
    socket.to(room).emit("sensor-data", data);
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Socket.io server running on http://localhost:${PORT}`);
});
