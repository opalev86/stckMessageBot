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
  const text = msg.text;

  if(text === "/clear"){
    // очистка таблицы
    db.run("DELETE FROM notes", [], (err)=>{
      if(err){
        bot.sendMessage(msg.chat.id, "Ошибка при очистке заметок!");
      } else {
        bot.sendMessage(msg.chat.id, "Все заметки удалены ✅");
      }
    });
  } else {
    // обычная заметка
    const colors = ["#fff59d","#ffe082","#ffd54f"];
    const color = colors[Math.floor(Math.random()*colors.length)];

    db.run(
      "INSERT INTO notes (text, color) VALUES (?,?)",
      [text, color]
    );
  }
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
