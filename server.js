
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const app = express();
app.use(express.json());
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

  // приветствие и подсказка
  if (text === "/start") {
    bot.sendMessage(
      msg.chat.id,
      "Привет! Просто напишите мне сообщение — оно появится на доске.\n\n" +
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

  // обычная заметка
  const colors = ["#fff59d","#ffe082","#ffd54f"];
  const color = colors[Math.floor(Math.random()*colors.length)];

  const from = msg.from || {};
  const author =
    from.username ? `@${from.username}` :
    [from.first_name, from.last_name].filter(Boolean).join(" ") || "unknown";

  const userId = from.id || null;
  const messageId = msg.message_id || null;
  const chatId = msg.chat && msg.chat.id ? msg.chat.id : null;

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
            ? `Вашей заметке "${snippet}" поставили лайк ❤️`
            : "Вашей заметке поставили лайк ❤️";

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
