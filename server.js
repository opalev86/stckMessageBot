
const express = require("express");
const https = require("https");
const sqlite3 = require("sqlite3").verbose();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(express.static("public"));

const db = new sqlite3.Database("database.db");

// простой счётчик текущих посетителей (по открытым вкладкам)
let visitors = 0;
const sseClients = new Set();

function broadcastVisitors(){
  const payload = `data: ${JSON.stringify({ visitors })}\n\n`;
  sseClients.forEach((res) => {
    res.write(payload);
  });
}

db.run(`
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 text TEXT,
 color TEXT
)
`);

// SSE-стрим с количеством текущих посетителей
app.get("/visitors/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("\n");

  visitors += 1;
  sseClients.add(res);
  broadcastVisitors();

  req.on("close", () => {
    visitors = Math.max(0, visitors - 1);
    sseClients.delete(res);
    broadcastVisitors();
  });
});

// Добавляем недостающие колонки, если их ещё нет
db.run("ALTER TABLE notes ADD COLUMN author TEXT", (err) => {
  if (err && !String(err.message).includes("duplicate column name")) {
    console.error("Ошибка при добавлении колонки author:", err.message);
  }
});
db.run("ALTER TABLE notes ADD COLUMN telegram_message_id INTEGER", (err) => {
  if (err && !String(err.message).includes("duplicate column name")) {
    console.error("Ошибка при добавлении колонки telegram_message_id:", err.message);
  }
});
db.run("ALTER TABLE notes ADD COLUMN telegram_user_id INTEGER", (err) => {
  if (err && !String(err.message).includes("duplicate column name")) {
    console.error("Ошибка при добавлении колонки telegram_user_id:", err.message);
  }
});
db.run("ALTER TABLE notes ADD COLUMN telegram_chat_id INTEGER", (err) => {
  if (err && !String(err.message).includes("duplicate column name")) {
    console.error("Ошибка при добавлении колонки telegram_chat_id:", err.message);
  }
});

db.run("ALTER TABLE notes ADD COLUMN likes INTEGER DEFAULT 0", (err) => {
  if (err && !String(err.message).includes("duplicate column name")) {
    console.error("Ошибка при добавлении колонки likes:", err.message);
  }
});
db.run("ALTER TABLE notes ADD COLUMN photo_file_id TEXT", (err) => {
  if (err && !String(err.message).includes("duplicate column name")) {
    console.error("Ошибка при добавлении колонки photo_file_id:", err.message);
  }
});

db.run(`
CREATE TABLE IF NOT EXISTS board_drawing (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  image_data TEXT NOT NULL
)
`);
db.run(`INSERT OR IGNORE INTO board_drawing (id, image_data) VALUES (1, '')`);

// токен берём из переменной окружения или отдельного файла
let TOKEN = process.env.TELEGRAM_TOKEN;
if (!TOKEN) {
  try {
    TOKEN = fs.readFileSync("telegram_token.txt", "utf8").trim();
  } catch (e) {
    console.error("Не найден токен Telegram. Установите TELEGRAM_TOKEN или создайте файл telegram_token.txt");
    process.exit(1);
  }
}

const bot = new TelegramBot(TOKEN, { polling: true });

// Обработка сообщений
bot.on("message", (msg) => {
  const text = msg.text || "";
  const caption = msg.caption || "";

  // приветствие и подсказка
  if (text === "/start") {
    bot.sendMessage(
      msg.chat.id,
      "Привет! Напишите сообщение или отправьте фото — оно появится на доске.\n\n" +
      "Чтобы удалить свою заметку, ответьте на исходное сообщение командой /delete."
    );
    return;
  }

  // очистка всех заметок
  if (text === "/clear") {
    db.run("DELETE FROM notes", [], (err)=>{
      if(err){
        bot.sendMessage(msg.chat.id, "Ошибка при очистке заметок!");
      } else {
        bot.sendMessage(msg.chat.id, "Все заметки удалены ✅");
      }
    });
    return;
  }

  // удаление своей заметки по ответу на сообщение
  if (text === "/delete") {
    const replied = msg.reply_to_message;
    if (!replied) {
      bot.sendMessage(msg.chat.id, "Ответьте командой /delete на сообщение, которое нужно удалить.");
      return;
    }

    const from = msg.from || {};
    const userId = from.id;
    const originalMessageId = replied.message_id;

    if (!userId || !originalMessageId) {
      bot.sendMessage(msg.chat.id, "Не удалось определить сообщение для удаления.");
      return;
    }

    db.run(
      "DELETE FROM notes WHERE telegram_message_id = ? AND telegram_user_id = ?",
      [originalMessageId, userId],
      function(err) {
        if (err) {
          bot.sendMessage(msg.chat.id, "Ошибка при удалении заметки.");
        } else if (this.changes === 0) {
          bot.sendMessage(msg.chat.id, "Не нашёл заметку, которую вы можете удалить.");
        } else {
          bot.sendMessage(msg.chat.id, "Ваша заметка удалена ✅");
        }
      }
    );
    return;
  }

  const colors = ["#fff59d","#ffe082","#ffd54f"];
  const color = colors[Math.floor(Math.random()*colors.length)];

  const from = msg.from || {};
  const author =
    from.username ? `@${from.username}` :
    [from.first_name, from.last_name].filter(Boolean).join(" ") || "unknown";

  const userId = from.id || null;
  const messageId = msg.message_id || null;
  const chatId = msg.chat && msg.chat.id ? msg.chat.id : null;

  // фото — на доску с картинкой (подпись опциональна)
  const photos = msg.photo;
  if (photos && photos.length > 0) {
    const largest = photos[photos.length - 1];
    const fileId = largest.file_id;
    const noteText = caption || "";
    db.run(
      "INSERT INTO notes (text, color, author, telegram_message_id, telegram_user_id, telegram_chat_id, photo_file_id) VALUES (?,?,?,?,?,?,?)",
      [noteText, color, author, messageId, userId, chatId, fileId]
    );
    return;
  }

  // обычная текстовая заметка
  if (!text) return;

  db.run(
    "INSERT INTO notes (text, color, author, telegram_message_id, telegram_user_id, telegram_chat_id) VALUES (?,?,?,?,?,?)",
    [text, color, author, messageId, userId, chatId]
  );
});

// API для сайта
app.get("/notes", (req,res)=>{
  db.all("SELECT * FROM notes ORDER BY id DESC",(err,rows)=>{
    res.json(rows);
  });
});

// сохранённый рисунок на доске (PNG data URL)
app.get("/doodle", (req, res) => {
  db.get("SELECT image_data FROM board_drawing WHERE id = 1", (err, row) => {
    if (err || !row || typeof row.image_data !== "string" || row.image_data.length < 80) {
      return res.json({ imageData: null });
    }
    if (!row.image_data.startsWith("data:image/png;base64,")) {
      return res.json({ imageData: null });
    }
    res.json({ imageData: row.image_data });
  });
});

app.post("/doodle", (req, res) => {
  const imageData = req.body && req.body.imageData;
  if (typeof imageData !== "string" || !imageData.startsWith("data:image/png;base64,")) {
    return res.status(400).json({ ok: false });
  }
  if (imageData.length > 18 * 1024 * 1024) {
    return res.status(413).json({ ok: false });
  }
  db.run(
    "INSERT OR REPLACE INTO board_drawing (id, image_data) VALUES (1, ?)",
    [imageData],
    (saveErr) => {
      if (saveErr) {
        return res.status(500).json({ ok: false });
      }
      res.json({ ok: true });
    }
  );
});

// картинка заметки (прокси из Telegram, токен не светится в браузере)
app.get("/note-photo/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).end();
  }
  db.get("SELECT photo_file_id FROM notes WHERE id = ?", [id], (err, row) => {
    if (err || !row || !row.photo_file_id) {
      return res.status(404).end();
    }
    bot.getFile(row.photo_file_id)
      .then((file) => {
        const path = file.file_path;
        if (!path) {
          return res.status(404).end();
        }
        const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${path}`;
        https.get(fileUrl, (tgRes) => {
          const ct = tgRes.headers["content-type"] || "image/jpeg";
          res.setHeader("Content-Type", ct);
          res.setHeader("Cache-Control", "public, max-age=86400");
          tgRes.pipe(res);
        }).on("error", () => {
          if (!res.headersSent) res.status(502).end();
        });
      })
      .catch(() => {
        if (!res.headersSent) res.status(500).end();
      });
  });
});

// лайки по стикеру
app.post("/notes/:id/like", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ ok: false });
  }

  db.get("SELECT * FROM notes WHERE id = ?", [id], (err, row) => {
    if (err || !row) {
      return res.status(404).json({ ok: false });
    }

    const currentLikes = row.likes || 0;
    const nextLikes = currentLikes + 1;

    db.run("UPDATE notes SET likes = ? WHERE id = ?", [nextLikes, id], (updErr) => {
      if (updErr) {
        return res.status(500).json({ ok: false });
      }

      // уведомление автору в телеграм
      if (row.telegram_chat_id && row.telegram_message_id) {
        const snippet = String(row.text || "").slice(0, 80);
        const msgText =
          snippet.length > 0
            ? `Вашей заметке "${snippet}" поставили лайк 👍`
            : row.photo_file_id
              ? "Вашей заметке с фото поставили лайк 👍"
              : "Вашей заметке поставили лайк 👍";

        bot.sendMessage(row.telegram_chat_id, msgText, {
          reply_to_message_id: row.telegram_message_id
        }).catch(()=>{});
      }

      res.json({ ok: true, likes: nextLikes });
    });
  });
});

app.listen(3000, ()=>{
  console.log("server started");
});
