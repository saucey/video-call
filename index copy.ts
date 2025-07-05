import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // Remove explicit path if not needed
  // path: "/socket.io",
  transports: ["websocket", "polling"], // Add polling as fallback
  allowEIO3: true, // Enable v3 compatibility
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

// Define interface for better type checking
interface CallSignal {
  userToCall: string;
  signalData: any;
  from: string;
}

interface AnswerSignal {
  signal: any;
  to: string;
}

io.on("connection", (socket: Socket) => {
  console.log("User connected:", socket.id);

  // Notify the user of their own ID
  socket.emit("your-id", socket.id);

  socket.on("call-user", ({ userToCall, signalData, from }: CallSignal) => {
    io.to(userToCall).emit("call-made", { signal: signalData, from });
  });

  socket.on("answer-call", ({ signal, to }: AnswerSignal) => {
    io.to(to).emit("call-answered", signal);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    socket.broadcast.emit("call-ended");
  });
});

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server is running on ${PORT}`);
});
