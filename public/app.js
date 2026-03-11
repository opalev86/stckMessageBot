const notesContainer = document.getElementById("notes");
let loadedNotes = new Set(); // чтобы не менять старые
let firstLoad = true;

async function loadNotes(){
  const res = await fetch("/notes");
  const notes = await res.json();

  const containerWidth = notesContainer.offsetWidth;

  notes.forEach(n=>{
    // если заметка уже есть, пропускаем
    if(loadedNotes.has(n.id)) return;

    const div = document.createElement("div");
    div.className = "note";
    div.innerText = n.text;
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

  firstLoad = false; // далее новые заметки просто добавляются сверху
}



loadNotes();
setInterval(loadNotes, 3000); // автообновление