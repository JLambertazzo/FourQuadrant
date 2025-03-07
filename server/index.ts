import { config } from "dotenv";
config();
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import http from "http";
import { Server } from "socket.io";
const app = express();
const server = http.createServer(app);
const origin = process.env.CLIENT_URL || "http://localhost:8080"
const io = new Server(server, {
  cors: {
    origin,
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});
const port = process.env.PORT || 8080;
import router from "./router";
import Sentencer from "sentencer";
import { readBoard, logVisitor, toObjectId } from "./mongo";
import { ObjectId } from "mongodb";
import session from "express-session";
declare module "express-session" {
  export interface SessionData {
    username?: string;
  }
}
import { MemoryStore } from "express-session";

console.log(`Expecting traffic from ${origin}`)

const idChecker = async (req: Request, res: Response, next: NextFunction) => {
  if (req.params.boardID && !ObjectId.isValid(req.params.boardID)) {
    console.log("invalid board id:", req.params.board_id);
    res.sendFile(path.join(__dirname, "../client/dist/error/index.html"));
    return;
  }
  next();
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../client/dist")));

app.use(cors({ origin }));

app.use("/", router);

app.use(
  session({
    secret: "a hardcoded secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 36000000,
      sameSite: "strict",
      httpOnly: true,
    },
    store: new MemoryStore(),
    unset: "destroy",
  })
);

app.get("/username", async (req: Request<{ username: string }>, res) => {
  if (!req.session || !req.session.username) {
    req.session.username = Sentencer.make("{{ adjective }}-{{ noun }}");
  }
  logVisitor(req.session.username);
  res.send({ username: req.session.username });
});

app.post("/username", async (req, res) => {
  const { username } = req.body;
  if (req.session) {
    req.session.username = username;
    res.send({ message: "success" });
  } else {
    res.status(400).send({ message: "unsuccessful" });
  }
});

function requireHTTPS(req: Request, res: Response, next: NextFunction) {
  // The 'x-forwarded-proto' check is for Heroku
  if (
    !req.secure &&
    req.get("x-forwarded-proto") !== "https" &&
    process.env.NODE_ENV !== "development"
  ) {
    return res.redirect("https://" + req.get("host") + req.url);
  }
  next();
}

// app.get('/', requireHTTPS, function(req, res) {
//   res.sendFile(path.join(__dirname, '../client/dist/index.html'));
// })

app.get("/admin", requireHTTPS, function (req, res) {
  res.sendFile(path.join(__dirname, "../client/dist/admin/index.html"));
});

app.get("/:boardId", requireHTTPS, idChecker, async function (req, res) {
  const boardId = toObjectId(req.params.boardId);
  if (!boardId || !(await readBoard(boardId))) {
    res.sendFile(path.join(__dirname, "../client/dist/error/index.html"));
  }
  res.sendFile(path.join(__dirname, "../client/dist/board/index.html"));
});

// socket.io functions
/**
 * Functions we need for sockets:
 * note: create new
 * note: update text
 * note: update position
 * note: resize
 * note: delete
 * currently probly wont scale great -
 */
io.on("connection", (socket) => {
  // socket.emit('receive name', { name: Sentencer.make("{{ adjective }}-{{ noun }}") })

  socket.on("note created", ({ note, board_id, username }) => {
    socket.broadcast.emit("receive note", {
      note,
      io_board_id: board_id,
      username,
    });
    const title = (note && note.title) || "[no title]";
    io.emit("receive create log", { io_board_id: board_id, username, title });
  });

  socket.on("note update", ({ note, board_id, username }) => {
    socket.broadcast.emit("receive update", { note, io_board_id: board_id });
    const title = (note && note.title) || "[no title]";
    io.emit("receive update log", { io_board_id: board_id, username, title });
  });

  socket.on("note move", ({ note_id, pos, board_id }) => {
    socket.broadcast.emit("receive move", {
      note_id,
      pos,
      io_board_id: board_id,
    });
  });

  socket.on("note delete", async ({ note_id, board_id, username, title }) => {
    socket.broadcast.emit("receive delete", {
      note_id,
      io_board_id: board_id,
      username,
    });
    io.emit("receive delete log", {
      io_board_id: board_id,
      username,
      title: title || "[no title]",
    });
  });

  socket.on("log message", ({ board_id, message }) => {
    io.emit("receive message", { io_board_id: board_id, message });
  });
  socket.on("note resize", ({ note_id, size, board_id }) => {
    socket.broadcast.emit("receive resize", {
      note_id,
      size,
      io_board_id: board_id,
    });
  });
});

server.listen(port, () => {
  console.log(`app listening at http://localhost:${port}`);
});
