import express from "express";
import http from "http";
import cors from "cors";
import { Server, Socket } from "socket.io";
import dotenv from "dotenv";
dotenv.config();

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

interface RegisteredUser {
  socketId: string;
  customId: string;
}

interface CallSignal {
  userToCall: string;
  signalData: any;
  from: string;
  customId: string;
}

interface AnswerSignal {
  signal: any;
  to: string;
}

const registeredUsers: RegisteredUser[] = [];

io.on("connection", (socket: Socket) => {
  console.log("User connected?????:", socket.id);
  
  socket.on("register", (customId: string) => {
    console.log("REG:", socket.id); 

    // Check if custom ID is already taken
    const existingUser = registeredUsers.find(
      (user) => user.customId === customId
    );
    if (existingUser) {
      console.log("Custom ID already in use:", customId);
      socket.emit("registration-error", "Custom ID already in use!!!");
      return;
    }

    const newUser = { socketId: socket.id, customId };
    registeredUsers.push(newUser);

    // Notify the new user about all registered users
    socket.emit("registered", registeredUsers);

    // Notify all other users about the new registration
    socket.broadcast.emit("user-registered", newUser);

  });

  socket.on(
    "call-user",
    ({ userToCall, signalData, from, customId }: CallSignal) => {
      const callerUser = registeredUsers.find((u) => u.socketId === from);
      const calleeUser = registeredUsers.find((u) => u.socketId === userToCall);

      if (!callerUser || !calleeUser) {
        socket.emit("call-error", "User not found");
        return;
      }

      io.to(userToCall).emit("call-made", {
        signal: signalData,
        from,
        customId: callerUser.customId,
      });
    }
  );

  socket.on("answer-call", ({ signal, to }: AnswerSignal) => {
    io.to(to).emit("call-answered", signal);
  });

  socket.on("end-call", () => {
    socket.broadcast.emit("call-ended");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    // Remove from registered users
    const index = registeredUsers.findIndex((u) => u.socketId === socket.id);
    if (index !== -1) {
      registeredUsers.splice(index, 1);
      io.emit("user-unregistered", socket.id);
    }

    socket.broadcast.emit("call-ended");
  });
});

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server is running on ${PORT}`);
});
