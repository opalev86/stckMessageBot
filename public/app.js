const notesContainer = document.getElementById("notes");
let loadedNotes = new Set(); // чтобы не менять старые
let firstLoad = true;
let scheduleBoardCanvasResize = () => {};

function setupBoardDrawing() {
  const canvas = document.createElement("canvas");
  canvas.id = "board-canvas";
  notesContainer.prepend(canvas);

  const ctx = canvas.getContext("2d");
  let drawing = false;

  let saveBoardTimer = null;
  function scheduleSaveBoard() {
    clearTimeout(saveBoardTimer);
    saveBoardTimer = setTimeout(() => {
      if (!canvas.width || !canvas.height) return;
      const imageData = canvas.toDataURL("image/png");
      if (imageData.length < 200) return;
      fetch("/doodle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData }),
      }).catch(() => {});
    }, 700);
  }

  function dpr() {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  function applyStrokeStyle() {
    const r = dpr();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(235,235,235,0.9)";
    ctx.lineWidth = 3 * r;
  }

  function boardSize() {
    const w = notesContainer.clientWidth;
    const h = Math.max(
      notesContainer.scrollHeight,
      notesContainer.clientHeight,
      window.innerHeight
    );
    return { w, h };
  }

  function syncSize() {
    const { w, h } = boardSize();
    const r = dpr();
    const newW = Math.max(1, Math.floor(w * r));
    const newH = Math.max(1, Math.floor(h * r));

    if (canvas.width === newW && canvas.height === newH) return;

    let snap = null;
    if (canvas.width > 0 && canvas.height > 0) {
      snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    canvas.width = newW;
    canvas.height = newH;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    if (snap) {
      const t = document.createElement("canvas");
      t.width = snap.width;
      t.height = snap.height;
      t.getContext("2d").putImageData(snap, 0, 0);
      ctx.drawImage(t, 0, 0);
    }

    applyStrokeStyle();
  }

  function posFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function posFromTouch(touch) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (touch.clientX - rect.left) * scaleX,
      y: (touch.clientY - rect.top) * scaleY,
    };
  }

  function wireDrawingEvents() {
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    canvas.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      drawing = true;
      const p = posFromEvent(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });

    window.addEventListener("mousemove", (e) => {
      if (!drawing) return;
      const p = posFromEvent(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    });

    window.addEventListener("mouseup", () => {
      const was = drawing;
      drawing = false;
      ctx.beginPath();
      if (was) scheduleSaveBoard();
    });

    canvas.addEventListener("touchstart", (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      drawing = true;
      const p = posFromTouch(e.touches[0]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      if (!drawing || e.touches.length !== 1) return;
      e.preventDefault();
      const p = posFromTouch(e.touches[0]);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }, { passive: false });

    window.addEventListener("touchend", () => {
      const was = drawing;
      drawing = false;
      ctx.beginPath();
      if (was) scheduleSaveBoard();
    });
  }

  syncSize();
  window.addEventListener("resize", () => syncSize());

  let resizeTimer = null;
  function scheduleSync() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(syncSize, 150);
  }
  scheduleBoardCanvasResize = scheduleSync;

  fetch("/doodle")
    .then((r) => r.json())
    .then((data) => {
      if (!(data && data.imageData)) return;
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          applyStrokeStyle();
          resolve();
        };
        img.onerror = () => resolve();
        img.src = data.imageData;
      });
    })
    .catch(() => {})
    .finally(() => {
      wireDrawingEvents();
    });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
const renderedAuthors = new Set(); // чтобы авторы не «прыгали»
let watermarkRendered = false;
let visitorsSource = null;

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

function renderVisitors(count){
  let bar = document.getElementById("visitors-indicator");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "visitors-indicator";
    document.body.appendChild(bar);
  }

  const maxPeople = Math.min(count, 8);
  bar.innerHTML = "";

  for (let i = 0; i < maxPeople; i++) {
    const person = document.createElement("div");
    person.className = "visitor-person";
    bar.appendChild(person);
  }
}

function setupVisitorsStream(){
  if (!window.EventSource || visitorsSource) return;

  visitorsSource = new EventSource("/visitors/stream");
  visitorsSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (typeof data.visitors === "number") {
        renderVisitors(data.visitors);
      }
    } catch (e) {
      console.error("visitors parse error", e);
    }
  };
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

    const likes = typeof n.likes === "number" ? n.likes : 0;
    const likeEl = `<div class="note-like">👍 ${likes}</div>`;

    const photoEl = n.photo_file_id
      ? `<img class="note-photo" src="/note-photo/${n.id}" alt="">`
      : "";
    const textBody = n.text
      ? `<div class="note-text">${escapeHtml(n.text)}</div>`
      : "";

    div.innerHTML = `${authorEl}${photoEl}${textBody}${likeEl}`;
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

    div.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = div.dataset.id;
      if (!id) return;
      try {
        const res = await fetch(`/notes/${id}/like`, { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        if (data && typeof data.likes === "number") {
          const likeNode = div.querySelector(".note-like");
          if (likeNode) {
            likeNode.textContent = `👍 ${data.likes}`;
          }
        }
      } catch (err) {
        console.error("like error", err);
      }
    });

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

  // подключим стрим посетителей (один раз)
  setupVisitorsStream();

  firstLoad = false; // далее новые заметки просто добавляются сверху

  // обновляем список авторов на фоне
  renderAuthorsBackground(notes);

  scheduleBoardCanvasResize();
}

setupBoardDrawing();
loadNotes();
setInterval(loadNotes, 3000); // автообновление