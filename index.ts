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
  transports: ["websocket", "polling"],
  allowEIO3: true,
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
});

interface CallSignal {
  userToCall: string;
  signalData: any;
  from: string;
}

interface AnswerSignal {
  signal: any;
  to: string;
}

interface EndCallSignal {
  to: string;
}

const userSocketMap = new Map<string, string>();

io.on("connection", (socket: Socket) => {
  console.log("User connected:", socket.id);

  socket.on("register-id", (customId: string) => {
    userSocketMap.set(customId, socket.id);
    console.log(`Registered ID: ${customId} -> ${socket.id}`);
    socket.emit("id-registered", { success: true });
  });

  socket.on("call-user", ({ userToCall, signalData, from }: CallSignal) => {
    const targetSocketId = userSocketMap.get(userToCall);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call-made", { signal: signalData, from });
    } else {
      io.to(socket.id).emit("user-not-found", { userToCall });
    }
  });

  socket.on("answer-call", ({ signal, to }: AnswerSignal) => {
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call-answered", signal);
    }
  });

  socket.on("end-call", ({ to }: EndCallSignal) => {
    const targetSocketId = userSocketMap.get(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("call-ended");
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    for (const [key, val] of userSocketMap.entries()) {
      if (val === socket.id) {
        io.emit("user-disconnected", { userId: key });
        userSocketMap.delete(key);
        break;
      }
    }
  });
});

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server is running on ${PORT}`);
});
