const notesContainer = document.getElementById("notes");
let loadedNotes = new Set(); // чтобы не менять старые
let firstLoad = true;
const renderedAuthors = new Set(); // чтобы авторы не «прыгали»
let watermarkRendered = false;

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function renderAuthorsBackground(notes) {
  const authorsSet = new Set();
  notes.forEach(n => {
    if (n.author) {
      authorsSet.add(n.author);
    }
  });

  const authors = Array.from(authorsSet);
  if (!authors.length) return;

  const containerWidth = notesContainer.offsetWidth || window.innerWidth;
  const containerHeight =
    notesContainer.scrollHeight || notesContainer.offsetHeight || window.innerHeight;

  const maxLabels = Math.min(authors.length, 20);

  for (let i = 0; i < maxLabels; i++) {
    const name = authors[i];
    if (renderedAuthors.has(name)) continue;

    const span = document.createElement("div");
    span.className = "author-bg";
    span.textContent = name;

    const h = hashString(name);
    const x = (h % Math.max(containerWidth - 120, 100)) + 60;
    const y = (Math.floor(h / 997) % Math.max(containerHeight - 80, 80)) + 40;
    const angle = ((h % 21) - 10); // -10..+10

    span.style.left = x + "px";
    span.style.top = y + "px";
    span.style.transform = `rotate(${angle}deg)`;

    notesContainer.appendChild(span);
    renderedAuthors.add(name);
  }
}

function renderWatermark() {
  if (watermarkRendered) return;

  const positions = [
    [5, 10],
    [40, 20],
    [75, 12],
    [15, 45],
    [55, 50],
    [80, 42],
    [10, 78],
    [45, 82],
    [78, 70],
  ];

  positions.forEach(([x, y]) => {
    const el = document.createElement("div");
    el.className = "watermark";
    el.textContent = "t.me/StickMessageBot";
    el.style.left = x + "%";
    el.style.top = y + "%";
    notesContainer.appendChild(el);
  });

  watermarkRendered = true;
}

async function loadNotes(){
  const res = await fetch("/notes");
  const notes = await res.json();

  const containerWidth = notesContainer.offsetWidth;

  notes.forEach(n=>{
    // если заметка уже есть, пропускаем
    if(loadedNotes.has(n.id)) return;

    const div = document.createElement("div");
    div.className = "note";
    div.dataset.id = String(n.id);

    const author = n.author || "";
    const authorEl = author
      ? `<div class="note-author">${author}</div>`
      : "";

    div.innerHTML = `${authorEl}<div class="note-text">${n.text}</div>`;
    div.style.background = n.color || "#ffeb3b";

    if(firstLoad){
      // хаотичное размещение при первой загрузке
      const x = Math.random() * (containerWidth - 120);
      const y = Math.random() * 500; // примерно верхняя половина экрана
      div.style.left = x + "px";
      div.style.top = y + "px";

      const angle = (Math.random() - 0.5) * 20; // -10°..+10°
      div.style.transform = `rotate(${angle}deg)`;
    } else {
      // новые стики: верхняя часть экрана, небольшое смещение
      const x = Math.random() * (containerWidth - 120);
      const y = Math.random() * 50; // смещение сверху
      const angle = (Math.random() - 0.5) * 15; // наклон
      div.style.left = x + "px";
      div.style.top = y + "px";
      div.style.transform = `rotate(${angle}deg)`;
      div.style.zIndex = loadedNotes.size + 100; // новые выше старых
    }

    notesContainer.appendChild(div);
    loadedNotes.add(n.id);
  });

  // удаляем исчезнувшие заметки без перезагрузки страницы
  const currentIds = new Set(notes.map(n => String(n.id)));
  document.querySelectorAll(".note").forEach(el => {
    const id = el.dataset.id;
    if (id && !currentIds.has(id)) {
      el.remove();
    }
  });
  loadedNotes = new Set(Array.from(currentIds).map(id => Number(id)));

  // отрисуем водяной знак один раз
  renderWatermark();

  firstLoad = false; // далее новые заметки просто добавляются сверху

  // обновляем список авторов на фоне
  renderAuthorsBackground(notes);
}

loadNotes();
setInterval(loadNotes, 3000); // автообновление