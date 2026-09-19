const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  pin: "",
  sourceMode: "file",
  files: [],
  pages: [],
  currentPage: 0,
  apiBase: localStorage.getItem("scanmood_api") || window.SCANMOOD_CONFIG?.apiBase || "",
  progressTimer: null,
};

const elements = {
  lock: $("#lockScreen"), app: $("#app"), dots: $$("#pinDots span"), pinDots: $("#pinDots"), pinError: $("#pinError"),
  fileInput: $("#fileInput"), dropZone: $("#dropZone"), dropTitle: $("#dropTitle"), dropMeta: $("#dropMeta"), urlInput: $("#urlInput"),
  translateBtn: $("#translateBtn"), sourceCard: $("#sourceCard"), processing: $("#processingCard"), progress: $("#progressBar"),
  processingTitle: $("#processingTitle"), processingMeta: $("#processingMeta"), result: $("#resultSection"), resultTitle: $("#resultTitle"), resultMeta: $("#resultMeta"),
  originalImage: $("#originalImage"), canvas: $("#translatedCanvas"), translatedLayer: $("#translatedLayer"), viewerStage: $("#viewerStage"),
  pageNav: $("#pageNav"), pageCount: $("#pageCount"), regionList: $("#regionList"), apiStatus: $("#apiStatus"), toast: $("#toast"),
  settings: $("#settingsDialog"), apiUrlInput: $("#apiUrlInput"), settingsMessage: $("#settingsMessage"), compareRange: $("#compareRange"), compareHandle: $("#compareHandle"),
};

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function updateApiStatus() {
  const live = Boolean(state.apiBase);
  elements.apiStatus.classList.toggle("live", live);
  $("span", elements.apiStatus).textContent = live ? "IA connectée" : "Mode démo";
}

function updatePin() {
  elements.dots.forEach((dot, i) => dot.classList.toggle("filled", i < state.pin.length));
  elements.pinDots.setAttribute("aria-label", `${state.pin.length} chiffre${state.pin.length > 1 ? "s" : ""} saisi${state.pin.length > 1 ? "s" : ""}`);
  if (state.pin.length === 6) {
    if (state.pin === "071079") unlock();
    else {
      elements.pinError.textContent = "Code incorrect";
      elements.pinDots.classList.remove("shake");
      void elements.pinDots.offsetWidth;
      elements.pinDots.classList.add("shake");
      setTimeout(() => { state.pin = ""; updatePin(); }, 460);
    }
  }
}

function unlock() {
  sessionStorage.setItem("scanmood_unlocked", "1");
  elements.lock.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 330, easing: "ease" }).finished.then(() => {
    elements.lock.hidden = true;
    elements.app.hidden = false;
    window.scrollTo(0, 0);
  });
}

function lockApp() {
  state.pin = ""; updatePin();
  elements.app.hidden = true;
  elements.lock.hidden = false;
  elements.lock.style.opacity = "1";
  sessionStorage.removeItem("scanmood_unlocked");
}

function syncSourceButton() {
  const ready = state.sourceMode === "file" ? state.files.length > 0 : elements.urlInput.value.trim().length > 8;
  elements.translateBtn.disabled = !ready;
}

function selectFiles(files) {
  state.files = [...files].filter(file => /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type));
  if (!state.files.length) {
    toast("Format non reconnu. Choisis une image ou un PDF.");
    return;
  }
  const totalMb = state.files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024;
  elements.dropTitle.textContent = state.files.length === 1 ? state.files[0].name : `${state.files.length} fichiers sélectionnés`;
  elements.dropMeta.textContent = `${totalMb.toFixed(1)} Mo · prêt à traduire`;
  elements.dropZone.classList.add("has-file");
  syncSourceButton();
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function imageDataToPage(dataUrl, name) {
  const image = await loadImage(dataUrl);
  const maxSide = 2200;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return { name, dataUrl: canvas.toDataURL("image/jpeg", .9), originalImage: image, regions: [] };
}

async function pdfToPages(file) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = Math.min(pdf.numPages, 12);
  const pages = [];
  for (let number = 1; number <= count; number++) {
    setProcessing(`Préparation de la page ${number}/${count}…`, "Conversion du PDF en image nette", 8 + (number / count) * 17);
    const page = await pdf.getPage(number);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.2, 1900 / baseViewport.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", .9);
    pages.push(await imageDataToPage(dataUrl, `${file.name} · page ${number}`));
  }
  if (pdf.numPages > 12) toast("La V1 traduit les 12 premières pages du PDF.");
  return pages;
}

async function buildPagesFromFiles() {
  const pages = [];
  for (const file of state.files) {
    if (file.type === "application/pdf") pages.push(...await pdfToPages(file));
    else pages.push(await imageDataToPage(await fileToDataUrl(file), file.name));
    if (pages.length >= 12) break;
  }
  return pages.slice(0, 12);
}

async function fetchRemoteFile(url) {
  if (!state.apiBase) throw new Error("Connecte le service IA pour importer un lien.");
  const response = await fetch(`${state.apiBase}/fetch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  if (!response.ok) throw new Error((await safeJson(response))?.error || "Impossible de récupérer ce lien.");
  const blob = await response.blob();
  const name = new URL(url).pathname.split("/").pop() || (blob.type === "application/pdf" ? "scan.pdf" : "scan.jpg");
  return new File([blob], name, { type: blob.type });
}

function setProcessing(title, meta, percent) {
  elements.processingTitle.textContent = title;
  elements.processingMeta.textContent = meta;
  elements.progress.style.width = `${Math.min(100, percent)}%`;
}

function startProgress() {
  let value = 3;
  setProcessing("Lecture du scan…", "Détection des bulles et du sens de lecture", value);
  clearInterval(state.progressTimer);
  state.progressTimer = setInterval(() => {
    value = Math.min(88, value + Math.max(1, (90 - value) * .035));
    elements.progress.style.width = `${value}%`;
  }, 350);
}

async function translatePage(page, index, total) {
  if (!state.apiBase) return demoRegions(page, index);
  setProcessing(`Traduction de la page ${index + 1}/${total}…`, "Le sens, le ton et les personnages sont analysés ensemble", 25 + ((index + .25) / total) * 65);
  const response = await fetch(`${state.apiBase}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageDataUrl: page.dataUrl,
      sourceLanguage: $("#languageSelect").value,
      style: $("#styleSelect").value,
    }),
  });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data?.error || "La traduction a échoué.");
  if (!Array.isArray(data.regions)) throw new Error("Réponse de traduction incomplète.");
  page.detectedLanguage = data.detectedLanguage || "auto";
  page.regions = data.regions.map(normalizeRegion).filter(Boolean);
  return page.regions;
}

async function runTranslation({ demo = false } = {}) {
  elements.result.hidden = true;
  elements.processing.hidden = false;
  startProgress();
  try {
    if (demo) state.pages = [await makeDemoPage()];
    else {
      if (state.sourceMode === "link") {
        const file = await fetchRemoteFile(elements.urlInput.value.trim());
        state.files = [file];
      }
      state.pages = await buildPagesFromFiles();
    }
    if (!state.pages.length) throw new Error("Aucune page à traduire.");
    for (let i = 0; i < state.pages.length; i++) await translatePage(state.pages[i], i, state.pages.length);
    clearInterval(state.progressTimer);
    setProcessing("Traduction terminée", "Mise en page du français dans les bulles", 100);
    state.currentPage = 0;
    await renderCurrentPage();
    setTimeout(() => {
      elements.processing.hidden = true;
      elements.result.hidden = false;
      elements.result.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 420);
  } catch (error) {
    clearInterval(state.progressTimer);
    elements.processing.hidden = true;
    toast(error.message || "Une erreur est survenue.");
  }
}

function normalizeRegion(region) {
  const nums = [region.x, region.y, region.w, region.h].map(Number);
  if (nums.some(n => !Number.isFinite(n))) return null;
  return {
    x: clamp(nums[0], 0, 1000), y: clamp(nums[1], 0, 1000),
    w: clamp(nums[2], 20, 1000), h: clamp(nums[3], 20, 1000),
    original: String(region.original || ""), translation: String(region.translation || ""),
    kind: ["speech", "thought", "narration", "sfx"].includes(region.kind) ? region.kind : "speech",
    treatment: region.treatment === "blur" ? "blur" : "clean",
  };
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; }); }
async function safeJson(response) { try { return await response.json(); } catch { return null; } }

async function renderCurrentPage() {
  const page = state.pages[state.currentPage];
  if (!page) return;
  elements.originalImage.src = page.dataUrl;
  await loadImage(page.dataUrl);
  await drawTranslation(page);
  elements.pageNav.hidden = state.pages.length < 2;
  elements.pageCount.textContent = `Page ${state.currentPage + 1} sur ${state.pages.length}`;
  $("#prevPage").disabled = state.currentPage === 0;
  $("#nextPage").disabled = state.currentPage === state.pages.length - 1;
  elements.resultTitle.textContent = state.pages.length > 1 ? `${state.pages.length} pages traduites` : "Page traduite";
  const language = languageLabel(page.detectedLanguage || $("#languageSelect").value);
  const style = $("#styleSelect").selectedOptions[0].textContent.split("·")[0].trim().toLowerCase();
  elements.resultMeta.textContent = `${language} → Français · ton ${style}`;
  renderRegionList(page);
}

async function drawTranslation(page) {
  const image = await loadImage(page.dataUrl);
  const canvas = elements.canvas;
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  for (const region of page.regions) drawRegion(ctx, canvas, region);
  requestAnimationFrame(syncStageSize);
}

function drawRegion(ctx, canvas, region) {
  const x = region.x / 1000 * canvas.width;
  const y = region.y / 1000 * canvas.height;
  const w = Math.min(region.w / 1000 * canvas.width, canvas.width - x);
  const h = Math.min(region.h / 1000 * canvas.height, canvas.height - y);
  const pad = Math.max(5, Math.min(w, h) * .06);
  if (region.treatment === "blur") {
    ctx.save();
    ctx.filter = `blur(${Math.max(5, Math.round(w * .035))}px)`;
    ctx.drawImage(canvas, x, y, w, h, x, y, w, h);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.76)";
  } else ctx.fillStyle = region.kind === "narration" ? "#f5f1df" : "#fff";
  roundedRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, Math.min(20, pad * 1.6));
  ctx.fill();
  ctx.fillStyle = "#111116";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const weight = region.kind === "sfx" ? 850 : 700;
  const italic = region.kind === "thought" ? "italic " : "";
  const fontSize = fitText(ctx, region.translation, w * .9, h * .84, weight, italic);
  ctx.font = `${italic}${weight} ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
  const lines = wrapText(ctx, region.translation, w * .9);
  const lineHeight = fontSize * 1.12;
  let lineY = y + h / 2 - ((lines.length - 1) * lineHeight) / 2;
  for (const line of lines) { ctx.fillText(line, x + w / 2, lineY); lineY += lineHeight; }
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = []; let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = `${line} ${words[i]}`;
    if (ctx.measureText(test).width > maxWidth) { lines.push(line); line = words[i]; }
    else line = test;
  }
  lines.push(line); return lines;
}

function fitText(ctx, text, maxWidth, maxHeight, weight, italic) {
  let size = Math.min(54, Math.max(13, maxHeight * .3));
  while (size > 12) {
    ctx.font = `${italic}${weight} ${size}px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
    const lines = wrapText(ctx, text, maxWidth);
    if (lines.length * size * 1.12 <= maxHeight && lines.every(line => ctx.measureText(line).width <= maxWidth)) break;
    size -= 1;
  }
  return size;
}

function renderRegionList(page) {
  elements.regionList.innerHTML = "";
  page.regions.forEach((region, index) => {
    const item = document.createElement("label");
    item.className = "region-item";
    item.innerHTML = `<span>${kindLabel(region.kind)} ${index + 1}</span><textarea aria-label="Traduction ${index + 1}"></textarea>`;
    const area = $("textarea", item);
    area.value = region.translation;
    area.addEventListener("input", () => { region.translation = area.value; });
    elements.regionList.appendChild(item);
  });
  if (!page.regions.length) elements.regionList.innerHTML = `<p class="microcopy">Aucun texte n’a été détecté sur cette page.</p>`;
}

function kindLabel(kind) { return ({ speech: "Dialogue", thought: "Pensée", narration: "Narration", sfx: "Onomatopée" })[kind] || "Texte"; }
function languageLabel(language) { return ({ english: "Anglais", japanese: "Japonais", chinese: "Chinois", auto: "Langue détectée" })[language] || "Langue détectée"; }

function syncStageSize() {
  const width = elements.originalImage.clientWidth;
  const ratio = elements.canvas.height / elements.canvas.width;
  elements.translatedLayer.style.width = `${width}px`;
  elements.canvas.style.width = `${width}px`;
  elements.canvas.style.height = `${width * ratio}px`;
}

async function makeDemoPage() {
  const canvas = document.createElement("canvas");
  canvas.width = 920; canvas.height = 1240;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e5e5e8"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#292a31"; ctx.fillRect(44, 44, 832, 530);
  ctx.fillStyle = "#464852"; ctx.beginPath(); ctx.arc(460, 340, 185, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#101116"; ctx.fillRect(44, 600, 832, 596);
  ctx.fillStyle = "#242630"; ctx.beginPath(); ctx.moveTo(44, 1080); ctx.lineTo(430, 680); ctx.lineTo(876, 1080); ctx.closePath(); ctx.fill();
  drawBubble(ctx, 88, 88, 350, 180, "もう逃げない。\n今度は私が守る。", 31);
  drawBubble(ctx, 520, 440, 300, 145, "本気なのか？", 35);
  drawBubble(ctx, 126, 850, 350, 165, "ああ。\n約束する。", 35);
  ctx.save(); ctx.translate(742, 780); ctx.rotate(-.15); ctx.fillStyle = "#fff"; ctx.font = "900 58px sans-serif"; ctx.fillText("ドン", 0, 0); ctx.restore();
  const dataUrl = canvas.toDataURL("image/jpeg", .93);
  return { name: "Page démo", dataUrl, detectedLanguage: "japanese", regions: demoRegionsRaw() };
}

function drawBubble(ctx, x, y, w, h, text, size) {
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `700 ${size}px sans-serif`;
  text.split("\n").forEach((line, i, lines) => ctx.fillText(line, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.25));
}

function demoRegionsRaw() {
  return [
    { x: 110, y: 86, w: 335, h: 135, original: "もう逃げない。今度は私が守る。", translation: "Je ne fuirai plus. Cette fois, c’est moi qui te protégerai.", kind: "speech", treatment: "clean" },
    { x: 573, y: 370, w: 275, h: 105, original: "本気なのか？", translation: "Tu es vraiment sérieux ?", kind: "speech", treatment: "clean" },
    { x: 150, y: 688, w: 345, h: 132, original: "ああ。約束する。", translation: "Oui. Je te le promets.", kind: "speech", treatment: "clean" },
    { x: 765, y: 610, w: 155, h: 95, original: "ドン", translation: "BAM", kind: "sfx", treatment: "blur" },
  ];
}

function demoRegions(page) {
  page.detectedLanguage = "japanese";
  page.regions = page.regions?.length ? page.regions : demoRegionsRaw();
  return page.regions;
}

async function downloadResult() {
  if (!state.pages.length) return;
  if (state.pages.length === 1) {
    const link = document.createElement("a");
    link.download = "scanmood-traduction.jpg";
    link.href = elements.canvas.toDataURL("image/jpeg", .94);
    link.click(); return;
  }
  if (!window.jspdf?.jsPDF) { toast("Le module PDF n’est pas encore chargé. Réessaie dans un instant."); return; }
  const { jsPDF } = window.jspdf;
  let pdf;
  for (let i = 0; i < state.pages.length; i++) {
    state.currentPage = i; await renderCurrentPage();
    const image = elements.canvas.toDataURL("image/jpeg", .9);
    const landscape = elements.canvas.width > elements.canvas.height;
    const orientation = landscape ? "landscape" : "portrait";
    const width = elements.canvas.width; const height = elements.canvas.height;
    if (!pdf) pdf = new jsPDF({ orientation, unit: "px", format: [width, height], hotfixes: ["px_scaling"] });
    else pdf.addPage([width, height], orientation);
    pdf.addImage(image, "JPEG", 0, 0, width, height);
  }
  state.currentPage = 0; await renderCurrentPage();
  pdf.save("scanmood-traduction.pdf");
}

// Verrouillage
$$('[data-key]').forEach(button => button.addEventListener("click", () => {
  elements.pinError.textContent = "";
  const key = button.dataset.key;
  if (key === "delete") state.pin = state.pin.slice(0, -1);
  else if (state.pin.length < 6) state.pin += key;
  updatePin();
}));
$("#lockBtn").addEventListener("click", lockApp);

// Source
$$('.source-tab').forEach(tab => tab.addEventListener("click", () => {
  state.sourceMode = tab.dataset.source;
  $$('.source-tab').forEach(item => { const active = item === tab; item.classList.toggle("active", active); item.setAttribute("aria-selected", active); });
  $("#filePanel").hidden = state.sourceMode !== "file";
  $("#linkPanel").hidden = state.sourceMode !== "link";
  syncSourceButton();
}));
elements.fileInput.addEventListener("change", event => selectFiles(event.target.files));
elements.urlInput.addEventListener("input", syncSourceButton);
elements.dropZone.addEventListener("dragover", event => { event.preventDefault(); elements.dropZone.classList.add("dragover"); });
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragover"));
elements.dropZone.addEventListener("drop", event => { event.preventDefault(); elements.dropZone.classList.remove("dragover"); selectFiles(event.dataTransfer.files); });
elements.translateBtn.addEventListener("click", () => runTranslation());
$("#demoBtn").addEventListener("click", () => runTranslation({ demo: true }));
$("#newScanBtn").addEventListener("click", () => { elements.result.hidden = true; elements.sourceCard.scrollIntoView({ behavior: "smooth", block: "start" }); });

// Résultats
$$('[data-view]').forEach(button => button.addEventListener("click", () => {
  $$('[data-view]').forEach(item => item.classList.toggle("active", item === button));
  elements.viewerStage.dataset.view = button.dataset.view;
}));
elements.compareRange.addEventListener("input", () => {
  const value = Number(elements.compareRange.value);
  elements.translatedLayer.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  elements.compareHandle.style.left = `${value}%`;
});
$("#prevPage").addEventListener("click", async () => { if (state.currentPage > 0) { state.currentPage--; await renderCurrentPage(); } });
$("#nextPage").addEventListener("click", async () => { if (state.currentPage < state.pages.length - 1) { state.currentPage++; await renderCurrentPage(); } });
$("#redrawBtn").addEventListener("click", async () => { await drawTranslation(state.pages[state.currentPage]); toast("Modifications appliquées"); });
$("#downloadBtn").addEventListener("click", downloadResult);
window.addEventListener("resize", syncStageSize);

// Réglages
$("#settingsBtn").addEventListener("click", () => { elements.apiUrlInput.value = state.apiBase; elements.settingsMessage.textContent = ""; elements.settings.showModal(); });
$("#saveApiBtn").addEventListener("click", () => {
  const value = elements.apiUrlInput.value.trim().replace(/\/$/, "");
  if (value && !/^https:\/\//i.test(value)) { elements.settingsMessage.textContent = "L’adresse doit commencer par https://"; return; }
  state.apiBase = value;
  if (value) localStorage.setItem("scanmood_api", value); else localStorage.removeItem("scanmood_api");
  updateApiStatus(); elements.settings.close(); toast(value ? "Service IA connecté" : "Mode démo activé");
});
$("#clearApiBtn").addEventListener("click", () => { elements.apiUrlInput.value = ""; state.apiBase = ""; localStorage.removeItem("scanmood_api"); updateApiStatus(); elements.settings.close(); toast("Service retiré"); });

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("./sw.js").catch(() => {});
updateApiStatus();
if (sessionStorage.getItem("scanmood_unlocked") === "1") { elements.lock.hidden = true; elements.app.hidden = false; }
