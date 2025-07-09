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

interface RejectSignal {
  signal: any;
  to: string;
}


const registeredUsers: RegisteredUser[] = [];

// Helper function to update user status and notify all clients
const updateUserStatus = (
  socketId: string,
  status: Partial<RegisteredUser>
) => {
  console.log('SHOULD UPDATE USER STATUS')
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

    // Emit to all clients including the new one
    io.emit("users-updated", registeredUsers);
    socket.emit("user-registered", newUser); // For welcome message
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

      // Don't allow calls if either user is already in a call
      if (caller.inCall || callee.inCall) {
        console.log("Call failed - user busy");
        socket.emit("call-error", "User is already in a call");
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

      // Notify the other party
      io.to(user.inCallWith).emit("call-ended");
    } else {
      // If no inCallWith but was in call (call rejected case)
      updateUserStatus(socket.id, { inCall: false, inCallWith: undefined });
    }
  });

  socket.on("reject-call", ({ to }: { to: string }) => {
    console.log("Call rejected by:", socket.id, "to:", to);

    // Find both users
    const caller = registeredUsers.find((u) => u.socketId === to);
    const callee = registeredUsers.find((u) => u.socketId === socket.id);

    // Update both parties' status if they exist
    if (caller) {
      updateUserStatus(to, { inCall: false, inCallWith: undefined });
    }
    if (callee) {
      updateUserStatus(socket.id, { inCall: false, inCallWith: undefined });
    }

    // Notify the caller
    io.to(to).emit("call-rejected");
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    const disconnectedUser = registeredUsers.find(
      (u) => u.socketId === socket.id
    );

    if (disconnectedUser) {
      // 1. Find all users who were in a call with the disconnected user
      const affectedUsers = registeredUsers.filter(
        (user) => user.inCallWith === socket.id
      );

      // 2. Notify each affected user
      affectedUsers.forEach((user) => {
        console.log(`Notifying ${user.socketId} about disconnection`);
        io.to(user.socketId).emit("call-ended", {
          reason: `${disconnectedUser.customId || "The user"} has disconnected`,
          socketId: socket.id,
        });

        // Update their status
        updateUserStatus(user.socketId, {
          inCall: false,
          inCallWith: undefined,
        });
      });

      // 3. If the disconnected user was in a call, notify their partner
      if (disconnectedUser.inCallWith) {
        const partner = registeredUsers.find(
          (u) => u.socketId === disconnectedUser.inCallWith
        );
        if (partner) {
          console.log(`Notifying partner ${partner.socketId}`);
          io.to(disconnectedUser.inCallWith).emit("call-ended", {
            reason: `${
              disconnectedUser.customId || "Your call partner"
            } has disconnected`,
            socketId: socket.id,
          });

          updateUserStatus(disconnectedUser.inCallWith, {
            inCall: false,
            inCallWith: undefined,
          });
        }
      }

      // 4. Remove the disconnected user
      const index = registeredUsers.findIndex((u) => u.socketId === socket.id);
      if (index !== -1) {
        registeredUsers.splice(index, 1);
      }

      // 5. Broadcast the unregistration
      io.emit("user-unregistered", socket.id);
    }
  });
});

const PORT = Number(process.env.PORT) || 5000;
server.listen(PORT, () => {
  console.log(`Signaling server is running on ports ${PORT}`);

});
