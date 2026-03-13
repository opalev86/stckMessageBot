
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(express.static("public"));

const db = new sqlite3.Database("database.db");

db.run(`
CREATE TABLE IF NOT EXISTS notes (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 text TEXT,
 color TEXT
)
`);

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

app.listen(3000, ()=>{
  console.log("server started");
});
