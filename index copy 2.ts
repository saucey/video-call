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

io.on("connection", (socket: Socket) => {
  console.log("User connected:", socket.id);
  socket.emit("your-id", socket.id);

  socket.on("call-user", ({ userToCall, signalData, from }: CallSignal) => {
    console.log(`Call from ${from} to ${userToCall}`);
    io.to(userToCall).emit("call-made", { signal: signalData, from });
  });

  socket.on("answer-call", ({ signal, to }: AnswerSignal) => {
    console.log(`Answer from ${socket.id} to ${to}`);
    io.to(to).emit("call-answered", signal);
  });

  socket.on("end-call", () => {
    console.log(`Call ended by ${socket.id}`);
    socket.broadcast.emit("call-ended");
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
