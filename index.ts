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
  inCall: boolean;
  inCallWith?: string; // Track who they're in call with
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

// Helper function to update user status and notify all clients
const updateUserStatus = (
  socketId: string,
  status: Partial<RegisteredUser>
) => {
  const userIndex = registeredUsers.findIndex((u) => u.socketId === socketId);
  if (userIndex !== -1) {
    registeredUsers[userIndex] = { ...registeredUsers[userIndex], ...status };
    io.emit("users-updated", registeredUsers);
  }
};

io.on("connection", (socket: Socket) => {
  console.log("User connected:", socket.id);

  socket.on("register", (customId: string) => {
    console.log("Registration attempt from:", socket.id, "ID:", customId);

    const existingUser = registeredUsers.find(
      (user) => user.customId === customId
    );
    if (existingUser) {
      console.log("Custom ID already in use:", customId);
      socket.emit("registration-error", "Custom ID already in use");
      return;
    }

    const newUser = {
      socketId: socket.id,
      customId,
      inCall: false,
    };
    registeredUsers.push(newUser);

    console.log("New user registered:", newUser);
    socket.emit("registered", registeredUsers);
    socket.broadcast.emit("user-registered", newUser);
  });

  socket.on(
    "call-user",
    ({ userToCall, signalData, from, customId }: CallSignal) => {
      console.log("Call initiated from:", from, "to:", userToCall);

      const caller = registeredUsers.find((u) => u.socketId === from);
      const callee = registeredUsers.find((u) => u.socketId === userToCall);

      if (!caller || !callee) {
        console.log("Call failed - user not found");
        socket.emit("call-error", "User not found");
        return;
      }

      // Update caller status immediately
      updateUserStatus(from, { inCall: true, inCallWith: userToCall });

      io.to(userToCall).emit("call-made", {
        signal: signalData,
        from,
        customId: caller.customId,
      });
    }
  );

  socket.on("answer-call", ({ signal, to }: AnswerSignal) => {
    console.log("Call answered by:", socket.id, "to:", to);

    // Update both parties' status
    updateUserStatus(socket.id, { inCall: true, inCallWith: to });
    updateUserStatus(to, { inCall: true, inCallWith: socket.id });

    io.to(to).emit("call-answered", signal);
  });

  socket.on("end-call", () => {
    console.log("Call ended by:", socket.id);

    // Find who they were in call with
    const user = registeredUsers.find((u) => u.socketId === socket.id);
    if (user?.inCallWith) {
      // Update both parties' status
      updateUserStatus(socket.id, { inCall: false, inCallWith: undefined });
      updateUserStatus(user.inCallWith, {
        inCall: false,
        inCallWith: undefined,
      });
    }

    socket.broadcast.emit("call-ended");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    const user = registeredUsers.find((u) => u.socketId === socket.id);
    if (user) {
      // If they were in a call, notify the other party
      if (user.inCallWith) {
        io.to(user.inCallWith).emit("call-ended");
        updateUserStatus(user.inCallWith, {
          inCall: false,
          inCallWith: undefined,
        });
      }

      // Remove user
      const index = registeredUsers.findIndex((u) => u.socketId === socket.id);
      registeredUsers.splice(index, 1);
      io.emit("user-unregistered", socket.id);
    }
  });
});

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server is running on port ${PORT}`);
});
