const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const TelegramBot = require("node-telegram-bot-api");

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

// TELEGRAM TOKEN
const TOKEN = "--";

const bot = new TelegramBot(TOKEN, { polling: true });

// сообщение из telegram -> записка
bot.on("message", (msg) => {

  const text = msg.text;

  const colors = [
    "#fff59d",
    "#ffe082",
    "#ffd54f"
  ];

  const color = colors[Math.floor(Math.random()*colors.length)];

  db.run(
    "INSERT INTO notes (text, color) VALUES (?,?)",
    [text, color]
  );

});

// API сайта
app.get("/notes", (req,res)=>{
  db.all("SELECT * FROM notes ORDER BY id DESC",(err,rows)=>{
    res.json(rows);
  });
});

app.listen(3000, ()=>{
  console.log("server started");
});