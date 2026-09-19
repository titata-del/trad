const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const MAX_PAGES = 200;

const state = {
  pin: "",
  sourceMode: "file",
  files: [],
  pages: [],
  currentPage: 0,
  apiBase: String(window.SCANMOOD_CONFIG?.apiBase || "").trim().replace(/\/$/, ""),
  theme: localStorage.getItem("scanmood_theme") || "light",
  readerMode: false,
  zoom: 1,
  progressTimer: null,
  readerObserver: null,
  sourceUrl: "",
  sourceTitle: "",
  historyId: "",
};

const elements = {
  lock: $("#lockScreen"), app: $("#app"), dots: $$("#pinDots span"), pinDots: $("#pinDots"), pinError: $("#pinError"),
  fileInput: $("#fileInput"), dropZone: $("#dropZone"), dropTitle: $("#dropTitle"), dropMeta: $("#dropMeta"), urlInput: $("#urlInput"),
  translateBtn: $("#translateBtn"), sourceCard: $("#sourceCard"), processing: $("#processingCard"), progress: $("#progressBar"),
  processingTitle: $("#processingTitle"), processingMeta: $("#processingMeta"), result: $("#resultSection"), resultTitle: $("#resultTitle"), resultMeta: $("#resultMeta"),
  originalImage: $("#originalImage"), canvas: $("#translatedCanvas"), translatedLayer: $("#translatedLayer"), viewerStage: $("#viewerStage"), stagePage: $("#stagePage"), readerStack: $("#readerStack"),
  pageNav: $("#pageNav"), pageCount: $("#pageCount"), regionList: $("#regionList"), apiStatus: $("#apiStatus"), toast: $("#toast"),
  settings: $("#settingsDialog"), settingsMessage: $("#settingsMessage"), compareRange: $("#compareRange"), compareHandle: $("#compareHandle"),
  readerBtn: $("#readerBtn"), zoomLabel: $("#zoomLabel"),
  history: $("#historyDialog"), historyList: $("#historyList"),
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
  $("span", elements.apiStatus).textContent = live ? "Moteur gratuit actif" : "À configurer";
  $("#engineBanner")?.classList.toggle("connected", live);
  $("#engineSettingStatus").textContent = live ? "Actif" : "À configurer";
}

function applyTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem("scanmood_theme", state.theme);
  $$('[data-theme-choice]').forEach(button => button.classList.toggle("active", button.dataset.themeChoice === state.theme));
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
  state.sourceUrl = "";
  state.sourceTitle = state.files.length === 1 ? state.files[0].name : `${state.files.length} scans importés`;
  state.historyId = "";
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
  return canvasToPage(canvas, name);
}

function canvasToPage(canvas, name) {
  return { name, dataUrl: canvas.toDataURL("image/jpeg", .9), width: canvas.width, height: canvas.height, regions: [], translatedDataUrl: "", translationError: "" };
}

async function imageDataToPages(dataUrl, name, limit) {
  const image = await loadImage(dataUrl);
  if (image.naturalHeight <= image.naturalWidth * 2.5) return [await imageDataToPage(dataUrl, name)];

  const scale = Math.min(1, 2200 / image.naturalWidth);
  const sourceSliceHeight = Math.max(1, Math.floor(2200 / scale));
  const count = Math.min(limit, Math.ceil(image.naturalHeight / sourceSliceHeight));
  const pages = [];
  for (let index = 0; index < count; index++) {
    const sourceY = index * sourceSliceHeight;
    const sourceHeight = Math.min(sourceSliceHeight, image.naturalHeight - sourceY);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(sourceHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, sourceY, image.naturalWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    pages.push(canvasToPage(canvas, `${name} · partie ${index + 1}`));
  }
  if (Math.ceil(image.naturalHeight / sourceSliceHeight) > limit) toast(`Cette longue image dépasse la limite de ${MAX_PAGES} parties.`);
  return pages;
}

async function pdfToPages(file, limit = MAX_PAGES) {
  const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs";
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const count = Math.min(pdf.numPages, limit);
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
  if (pdf.numPages > limit) toast(`Cet import dépasse la limite totale de ${MAX_PAGES} pages. Fais un second PDF pour la suite.`);
  return pages;
}

async function buildPagesFromFiles() {
  const pages = [];
  for (const file of state.files) {
    if (file.type === "application/pdf") pages.push(...await pdfToPages(file, MAX_PAGES - pages.length));
    else pages.push(...await imageDataToPages(await fileToDataUrl(file), file.name, MAX_PAGES - pages.length));
    if (pages.length >= MAX_PAGES) break;
  }
  return pages.slice(0, MAX_PAGES);
}

async function fetchRemoteFile(url, referer = "") {
  if (!state.apiBase) throw new Error("La configuration Cloudflare n’est pas encore terminée.");
  const response = await fetch(`${state.apiBase}/fetch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, referer }) });
  if (!response.ok) throw new Error((await safeJson(response))?.error || "Impossible de récupérer ce lien.");
  const blob = await response.blob();
  const name = new URL(url).pathname.split("/").pop() || (blob.type === "application/pdf" ? "scan.pdf" : "scan.jpg");
  return new File([blob], name, { type: blob.type });
}

async function inspectRemoteLink(url) {
  const response = await fetch(`${state.apiBase}/chapter`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = await safeJson(response);
  if (!response.ok) throw new Error(data?.error || "Impossible d’analyser ce lien.");
  return data;
}

async function buildPagesFromLink(url) {
  setProcessing("Ouverture du chapitre…", "Recherche des pages sur le site", 7);
  const chapter = await inspectRemoteLink(url);
  state.sourceTitle = chapter.title || new URL(url).pathname.split("/").filter(Boolean).pop() || "Chapitre importé";
  if (chapter.kind === "file") {
    const file = await fetchRemoteFile(chapter.url || url, url);
    state.files = [file];
    return buildPagesFromFiles();
  }
  const imageUrls = Array.isArray(chapter.images) ? chapter.images.slice(0, MAX_PAGES) : [];
  if (!imageUrls.length) throw new Error("Aucune page de scan trouvée dans ce chapitre.");
  const pages = [];
  let failed = 0;
  for (let index = 0; index < imageUrls.length && pages.length < MAX_PAGES; index++) {
    setProcessing(`Import de la page ${index + 1}/${imageUrls.length}…`, "Les pages sont préparées pour la lecture verticale", 8 + ((index + 1) / imageUrls.length) * 17);
    try {
      const file = await fetchRemoteFile(imageUrls[index], url);
      if (!file.type.startsWith("image/")) continue;
      const room = MAX_PAGES - pages.length;
      pages.push(...await imageDataToPages(await fileToDataUrl(file), `Page ${index + 1}`, room));
    } catch {
      failed++;
    }
  }
  if (!pages.length) throw new Error("Les images du chapitre sont protégées par le site et n’ont pas pu être chargées.");
  if (failed) toast(`${failed} image${failed > 1 ? "s" : ""} du site n’ont pas pu être chargées.`);
  return pages.slice(0, MAX_PAGES);
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

async function runTranslation() {
  if (!state.apiBase) {
    openSettings("La vraie traduction sera disponible dès que l’adresse Cloudflare aura été ajoutée dans config.js sur GitHub.");
    return;
  }
  elements.result.hidden = true;
  elements.processing.hidden = false;
  startProgress();
  try {
    let preparedPages = null;
    if (state.sourceMode === "link") {
      state.sourceUrl = elements.urlInput.value.trim();
      preparedPages = await buildPagesFromLink(state.sourceUrl);
    }
    state.pages = preparedPages || await buildPagesFromFiles();
    if (!state.pages.length) throw new Error("Aucune page à traduire.");
    let translatedCount = 0;
    let failedCount = 0;
    let firstError = "";
    for (let i = 0; i < state.pages.length; i++) {
      try {
        await translatePage(state.pages[i], i, state.pages.length);
        state.pages[i].translationError = "";
        state.pages[i].translatedDataUrl = "";
        translatedCount++;
      } catch (pageError) {
        const message = pageError?.message || "Cette page n’a pas pu être traduite.";
        state.pages[i].translationError = message;
        state.pages[i].regions = [];
        failedCount++;
        firstError ||= message;
        if (/limite gratuite|quota|allocation/i.test(message)) {
          for (let rest = i + 1; rest < state.pages.length; rest++) {
            state.pages[rest].translationError = "Limite gratuite atteinte avant cette page.";
            state.pages[rest].regions = [];
            failedCount++;
          }
          break;
        }
      }
    }
    if (!translatedCount) throw new Error(firstError || "La traduction a échoué.");
    clearInterval(state.progressTimer);
    setProcessing("Traduction terminée", "Mise en page du français dans les bulles", 100);
    state.currentPage = 0;
    elements.viewerStage.dataset.view = "translated";
    $$('[data-view]').forEach(button => button.classList.toggle("active", button.dataset.view === "translated"));
    elements.processing.hidden = true;
    elements.result.hidden = false;
    await new Promise(resolve => requestAnimationFrame(resolve));
    await renderCurrentPage();
    buildReaderStack();
    saveCurrentHistory().catch(() => {});
    toggleReaderMode(true);
    requestAnimationFrame(syncStageSize);
    if (failedCount) toast(`${translatedCount} page${translatedCount > 1 ? "s" : ""} traduite${translatedCount > 1 ? "s" : ""}, ${failedCount} à réessayer.`);
  } catch (error) {
    clearInterval(state.progressTimer);
    elements.processing.hidden = true;
    elements.result.hidden = true;
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

async function renderPageDataUrl(page) {
  if (page.translatedDataUrl) return page.translatedDataUrl;
  if (!page.regions.length) {
    page.translatedDataUrl = page.dataUrl;
    return page.translatedDataUrl;
  }
  const image = await loadImage(page.dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  page.width = canvas.width;
  page.height = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  for (const region of page.regions) drawRegion(ctx, canvas, region);
  page.translatedDataUrl = canvas.toDataURL("image/jpeg", .9);
  canvas.width = 1;
  canvas.height = 1;
  return page.translatedDataUrl;
}

function buildReaderStack() {
  state.readerObserver?.disconnect();
  elements.readerStack.innerHTML = "";
  const fragment = document.createDocumentFragment();

  state.pages.forEach((page, index) => {
    const card = document.createElement("article");
    card.className = "reader-page";
    card.dataset.index = String(index);
    card.innerHTML = `
      <div class="reader-page-frame">
        <img class="reader-original" alt="Page ${index + 1} originale" decoding="async" />
        <div class="reader-translated-layer"><img class="reader-translated" alt="Page ${index + 1} traduite" decoding="async" /></div>
        <input class="reader-compare-range" type="range" min="0" max="100" value="52" aria-label="Comparer la page ${index + 1}" />
        <span class="reader-compare-handle" aria-hidden="true"></span>
        <p class="reader-page-error" hidden></p>
      </div>`;
    const frame = $(".reader-page-frame", card);
    const ratioWidth = page.width || 3;
    const ratioHeight = page.height || 4;
    frame.style.aspectRatio = `${ratioWidth} / ${ratioHeight}`;
    if (page.translationError) {
      const error = $(".reader-page-error", card);
      error.textContent = `Page ${index + 1} non traduite · ${page.translationError}`;
      error.hidden = false;
    }
    const range = $(".reader-compare-range", card);
    range.addEventListener("input", () => setReaderCompare(card, Number(range.value)));
    setReaderCompare(card, 52);
    fragment.appendChild(card);
  });

  elements.readerStack.appendChild(fragment);
  state.readerObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      entry.target.dataset.near = String(entry.isIntersecting);
      if (entry.isIntersecting) loadReaderCard(entry.target);
      else unloadReaderCard(entry.target);
    });
  }, { root: elements.viewerStage, rootMargin: "1400px 0px", threshold: .01 });
  $$(".reader-page", elements.readerStack).forEach(card => state.readerObserver.observe(card));
  syncReaderPageSizes();
}

function setReaderCompare(card, value) {
  const layer = $(".reader-translated-layer", card);
  const handle = $(".reader-compare-handle", card);
  if (layer) layer.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  if (handle) handle.style.left = `${value}%`;
}

async function loadReaderCard(card) {
  if (card.dataset.loading === "true" || card.dataset.loaded === "true") return;
  const page = state.pages[Number(card.dataset.index)];
  if (!page) return;
  card.dataset.loading = "true";
  try {
    const translated = await renderPageDataUrl(page);
    if (card.dataset.near !== "true" || !card.isConnected) return;
    $(".reader-original", card).src = page.dataUrl;
    $(".reader-translated", card).src = translated;
    card.dataset.loaded = "true";
  } catch {
    const error = $(".reader-page-error", card);
    error.textContent = `Page ${Number(card.dataset.index) + 1} impossible à afficher.`;
    error.hidden = false;
  } finally {
    card.dataset.loading = "false";
  }
}

function unloadReaderCard(card) {
  if (card.dataset.loaded !== "true") return;
  $(".reader-original", card).removeAttribute("src");
  $(".reader-translated", card).removeAttribute("src");
  card.dataset.loaded = "false";
}

function syncReaderPageSizes() {
  if (!state.readerMode || !elements.readerStack.children.length) return;
  const available = Math.max(1, elements.viewerStage.clientWidth - (window.innerWidth <= 680 ? 0 : 36));
  $$(".reader-page", elements.readerStack).forEach(card => {
    const page = state.pages[Number(card.dataset.index)];
    const natural = page?.width || available;
    card.style.width = `${Math.round(Math.min(natural, available) * state.zoom)}px`;
  });
}

async function renderCurrentPage() {
  const page = state.pages[state.currentPage];
  if (!page) return;
  await setImageElementSource(elements.originalImage, page.dataUrl);
  await drawTranslation(page);
  elements.pageNav.hidden = state.pages.length < 2;
  elements.pageCount.textContent = `Page ${state.currentPage + 1} sur ${state.pages.length}`;
  $("#prevPage").disabled = state.currentPage === 0;
  $("#nextPage").disabled = state.currentPage === state.pages.length - 1;
  const translatedPages = state.pages.filter(item => !item.translationError).length;
  elements.resultTitle.textContent = state.pages.length > 1 ? `${translatedPages}/${state.pages.length} pages traduites` : "Page traduite";
  const language = languageLabel(page.detectedLanguage || $("#languageSelect").value);
  const style = $("#styleSelect").selectedOptions[0].textContent.split("·")[0].trim().toLowerCase();
  elements.resultMeta.textContent = `${language} → Français · ton ${style}`;
  renderRegionList(page);
}

function setImageElementSource(image, src) {
  return new Promise((resolve, reject) => {
    if (image.src === src && image.complete && image.naturalWidth) { resolve(); return; }
    image.onload = () => { image.onload = null; image.onerror = null; resolve(); };
    image.onerror = () => { image.onload = null; image.onerror = null; reject(new Error("L’image ne peut pas être affichée.")); };
    image.src = src;
  });
}

async function drawTranslation(page) {
  const image = await loadImage(page.dataUrl);
  const canvas = elements.canvas;
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  page.width = canvas.width; page.height = canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  for (const region of page.regions) drawRegion(ctx, canvas, region);
  syncStageSize();
  requestAnimationFrame(syncStageSize);
  setTimeout(syncStageSize, 80);
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
  syncReaderPageSizes();
  if (!elements.canvas.width || !elements.canvas.height) return;
  const padding = state.readerMode ? 0 : (window.innerWidth <= 680 ? 16 : 44);
  const available = Math.max(1, elements.viewerStage.clientWidth - padding);
  const natural = elements.originalImage.naturalWidth || elements.canvas.width;
  const fittedWidth = Math.min(natural, available);
  const width = Math.round(fittedWidth * (state.readerMode ? state.zoom : 1));
  const ratio = elements.canvas.height / elements.canvas.width;
  elements.stagePage.style.width = `${width}px`;
  elements.stagePage.style.height = `${Math.round(width * ratio)}px`;
  elements.originalImage.style.width = "100%";
  elements.originalImage.style.height = "100%";
  elements.canvas.style.width = "100%";
  elements.canvas.style.height = "100%";
}

function toggleReaderMode(force) {
  state.readerMode = typeof force === "boolean" ? force : !state.readerMode;
  document.body.classList.toggle("reader-mode", state.readerMode);
  elements.readerBtn.setAttribute("aria-pressed", String(state.readerMode));
  $("span", elements.readerBtn).textContent = state.readerMode ? "Quitter" : "Mode lecture";
  if (!state.readerMode) state.zoom = 1;
  else {
    if (!elements.readerStack.children.length) buildReaderStack();
    elements.viewerStage.scrollTop = 0;
    elements.viewerStage.scrollLeft = 0;
    requestAnimationFrame(() => {
      $$(".reader-page", elements.readerStack).slice(0, 2).forEach(card => {
        card.dataset.near = "true";
        loadReaderCard(card);
      });
    });
  }
  updateZoom();
  setTimeout(syncStageSize, 30);
}

function updateZoom(delta = 0) {
  state.zoom = clamp(Math.round((state.zoom + delta) * 10) / 10, .5, 2);
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  syncStageSize();
}

async function downloadResult() {
  if (!state.pages.length) return;
  if (state.pages.length === 1) {
    const link = document.createElement("a");
    link.download = "scanmood-traduction.jpg";
    link.href = await renderPageDataUrl(state.pages[0]);
    link.click(); return;
  }
  if (!window.jspdf?.jsPDF) { toast("Le module PDF n’est pas encore chargé. Réessaie dans un instant."); return; }
  const { jsPDF } = window.jspdf;
  let pdf;
  for (let i = 0; i < state.pages.length; i++) {
    const page = state.pages[i];
    const image = await renderPageDataUrl(page);
    const landscape = page.width > page.height;
    const orientation = landscape ? "landscape" : "portrait";
    const width = page.width; const height = page.height;
    if (!pdf) pdf = new jsPDF({ orientation, unit: "px", format: [width, height], hotfixes: ["px_scaling"] });
    else pdf.addPage([width, height], orientation);
    pdf.addImage(image, "JPEG", 0, 0, width, height);
  }
  pdf.save("scanmood-traduction.pdf");
}

const HISTORY_DB = "scanmood-history";
const HISTORY_STORE = "chapters";

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HISTORY_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(HISTORY_STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function historyOperation(mode, action) {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(HISTORY_STORE, mode);
    const store = transaction.objectStore(HISTORY_STORE);
    let result;
    try { result = action(store); } catch (error) { db.close(); reject(error); return; }
    transaction.oncomplete = () => { db.close(); resolve(result?.result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Stockage interrompu.")); };
  });
}

async function getHistoryEntries() {
  const entries = await historyOperation("readonly", store => store.getAll());
  return (entries || []).sort((a, b) => b.savedAt - a.savedAt);
}

async function trimHistory() {
  const entries = await getHistoryEntries();
  for (const entry of entries.slice(10)) await historyOperation("readwrite", store => store.delete(entry.id));
}

function historyPages() {
  return state.pages.map(page => ({
    name: page.name,
    dataUrl: page.dataUrl,
    width: page.width,
    height: page.height,
    regions: page.regions,
    detectedLanguage: page.detectedLanguage || "auto",
    translationError: page.translationError || "",
    translatedDataUrl: "",
  }));
}

async function saveCurrentHistory() {
  if (!state.pages.length) return;
  state.historyId ||= globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const base = {
    id: state.historyId,
    title: state.sourceTitle || state.pages[0]?.name || "Scan traduit",
    url: state.sourceUrl || "",
    savedAt: Date.now(),
    pageCount: state.pages.length,
    sourceLanguage: $("#languageSelect").value,
    style: $("#styleSelect").value,
  };
  try {
    await historyOperation("readwrite", store => store.put({ ...base, pages: historyPages() }));
  } catch {
    await historyOperation("readwrite", store => store.put({ ...base, pages: null }));
  }
  await trimHistory();
}

async function deleteHistoryEntry(id) {
  await historyOperation("readwrite", store => store.delete(id));
  await renderHistoryList();
}

async function openHistoryEntry(entry) {
  elements.history.close();
  $("#languageSelect").value = entry.sourceLanguage || "auto";
  $("#styleSelect").value = entry.style || "natural";
  state.historyId = entry.id;
  state.sourceUrl = entry.url || "";
  state.sourceTitle = entry.title || "Chapitre enregistré";
  if (!Array.isArray(entry.pages) || !entry.pages.length) {
    if (!entry.url) { toast("Ce scan n’est plus stocké sur l’iPhone."); return; }
    const linkTab = $('[data-source="link"]');
    linkTab.click();
    elements.urlInput.value = entry.url;
    syncSourceButton();
    runTranslation();
    return;
  }
  state.pages = entry.pages.map(page => ({ ...page, translatedDataUrl: "" }));
  state.currentPage = 0;
  elements.viewerStage.dataset.view = "translated";
  $$('[data-view]').forEach(button => button.classList.toggle("active", button.dataset.view === "translated"));
  elements.processing.hidden = true;
  elements.result.hidden = false;
  await renderCurrentPage();
  buildReaderStack();
  toggleReaderMode(true);
}

async function renderHistoryList() {
  let entries = [];
  try { entries = await getHistoryEntries(); } catch {}
  elements.historyList.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Aucun chapitre dans l’historique pour le moment.";
    elements.historyList.appendChild(empty);
    $("#clearHistoryBtn").hidden = true;
    return;
  }
  $("#clearHistoryBtn").hidden = false;
  for (const entry of entries) {
    const item = document.createElement("article");
    item.className = "history-item";
    const main = document.createElement("div");
    main.className = "history-item-main";
    const title = document.createElement("strong");
    title.textContent = entry.title || "Chapitre traduit";
    const meta = document.createElement("small");
    meta.textContent = `${entry.pageCount || 0} page${entry.pageCount > 1 ? "s" : ""} · ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(entry.savedAt)}`;
    main.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "history-item-actions";
    const open = document.createElement("button");
    open.type = "button"; open.className = "history-open"; open.textContent = "Ouvrir";
    open.addEventListener("click", () => openHistoryEntry(entry));
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "history-delete"; remove.setAttribute("aria-label", "Supprimer"); remove.textContent = "×";
    remove.addEventListener("click", () => deleteHistoryEntry(entry.id));
    actions.append(open, remove);
    item.append(main, actions);
    elements.historyList.appendChild(item);
  }
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
$("#historyBtn").addEventListener("click", async () => {
  await renderHistoryList();
  elements.history.showModal();
});
$("#clearHistoryBtn").addEventListener("click", async () => {
  if (!confirm("Effacer tout l’historique ScanMood de cet appareil ?")) return;
  await historyOperation("readwrite", store => store.clear());
  await renderHistoryList();
});

// Source
$$('.source-tab').forEach(tab => tab.addEventListener("click", () => {
  state.sourceMode = tab.dataset.source;
  $$('.source-tab').forEach(item => { const active = item === tab; item.classList.toggle("active", active); item.setAttribute("aria-selected", active); });
  $("#filePanel").hidden = state.sourceMode !== "file";
  $("#linkPanel").hidden = state.sourceMode !== "link";
  syncSourceButton();
}));
elements.fileInput.addEventListener("change", event => selectFiles(event.target.files));
elements.urlInput.addEventListener("input", () => { state.historyId = ""; syncSourceButton(); });
elements.dropZone.addEventListener("dragover", event => { event.preventDefault(); elements.dropZone.classList.add("dragover"); });
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragover"));
elements.dropZone.addEventListener("drop", event => { event.preventDefault(); elements.dropZone.classList.remove("dragover"); selectFiles(event.dataTransfer.files); });
elements.translateBtn.addEventListener("click", () => runTranslation());
$("#newScanBtn").addEventListener("click", () => { toggleReaderMode(false); elements.result.hidden = true; elements.sourceCard.scrollIntoView({ behavior: "smooth", block: "start" }); });

// Résultats
$$('[data-view]').forEach(button => button.addEventListener("click", () => {
  $$('[data-view]').forEach(item => item.classList.toggle("active", item === button));
  elements.viewerStage.dataset.view = button.dataset.view;
  if (button.dataset.view === "compare") {
    const value = Number(elements.compareRange.value);
    elements.translatedLayer.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
    elements.compareHandle.style.left = `${value}%`;
  }
}));
elements.compareRange.addEventListener("input", () => {
  const value = Number(elements.compareRange.value);
  elements.translatedLayer.style.clipPath = `inset(0 ${100 - value}% 0 0)`;
  elements.compareHandle.style.left = `${value}%`;
});
$("#prevPage").addEventListener("click", async () => { if (state.currentPage > 0) { state.currentPage--; await renderCurrentPage(); } });
$("#nextPage").addEventListener("click", async () => { if (state.currentPage < state.pages.length - 1) { state.currentPage++; await renderCurrentPage(); } });
$("#redrawBtn").addEventListener("click", async () => {
  const page = state.pages[state.currentPage];
  page.translatedDataUrl = "";
  await drawTranslation(page);
  buildReaderStack();
  saveCurrentHistory().catch(() => {});
  toast("Modifications appliquées");
});
$("#downloadBtn").addEventListener("click", downloadResult);
elements.readerBtn.addEventListener("click", () => toggleReaderMode());
$("#zoomOutBtn").addEventListener("click", () => updateZoom(-.1));
$("#zoomInBtn").addEventListener("click", () => updateZoom(.1));
window.addEventListener("resize", syncStageSize);

// Réglages
function openSettings(message = "") {
  elements.settingsMessage.textContent = message || (state.apiBase
    ? "Le moteur gratuit Cloudflare est actif. Tu peux importer un scan, un PDF ou l’adresse publique d’un chapitre."
    : "La vraie traduction sera disponible dès que l’adresse Cloudflare aura été ajoutée dans config.js sur GitHub.");
  elements.settings.showModal();
}
$("#settingsBtn").addEventListener("click", () => openSettings());
$("#setupHelpBtn").addEventListener("click", () => openSettings("Suis le guide ÉTAPES_CLOUDFLARE.md du ZIP. Aucun paiement et aucune clé OpenAI ne sont demandés."));
$$('[data-theme-choice]').forEach(button => button.addEventListener("click", () => applyTheme(button.dataset.themeChoice)));

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then(registration => registration.update()).catch(() => {});
}
applyTheme(state.theme);
updateApiStatus();
if (sessionStorage.getItem("scanmood_unlocked") === "1") { elements.lock.hidden = true; elements.app.hidden = false; }
