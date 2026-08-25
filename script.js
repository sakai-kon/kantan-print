const $ = (selector) => document.querySelector(selector);

const fileInput = $('#fileInput');
const dropZone = $('#dropZone');
const startScreen = $('#startScreen');
const editor = $('#editor');
const canvas = $('#documentCanvas');
const ctx = canvas.getContext('2d', { alpha: false });
const pageArea = $('#pageArea');
const textLayer = $('#textLayer');
const printButton = $('#printButton');
const undoButton = $('#undoButton');
const redoButton = $('#redoButton');
const scaleRange = $('#scaleRange');
const scaleLabel = $('#scaleLabel');
const brightnessRange = $('#brightnessRange');
const contrastRange = $('#contrastRange');
const grayscaleButton = $('#grayscaleButton');
const textDialog = $('#textDialog');
const textInput = $('#textInput');
const textSize = $('#textSize');
const textColor = $('#textColor');
const boldTextButton = $('#boldTextButton');
const verticalTextButton = $('#verticalTextButton');
const confirmText = $('#confirmText');
const cropButton = $('#cropButton');
const cropNotice = $('#cropNotice');
const cropOverlay = $('#cropOverlay');
const cancelCropButton = $('#cancelCropButton');
const applyCropButton = $('#applyCropButton');
const pageIndicator = $('#pageIndicator');
const prevPageButton = $('#prevPageButton');
const nextPageButton = $('#nextPageButton');

const DEFAULT_RENDER_SCALE = 1;
const MAX_HISTORY = 20;
let pages = [];
let currentPage = 0;
let history = [];
let future = [];
let sourceImage = null;
let drag = null;
let snapshotBeforeDrag = null;
let cropMode = false;
let cropStart = null;
let cropRect = null;
let editingTextId = null;
let selectedTextId = null;
let dialogBold = false;
let dialogVertical = false;
let isRestoringHistory = false;
let sliderHistoryStarted = false;

function emptyPage() {
  return { name: 'scan', baseSrc: null, initialSrc: null, rotation: 0, scale: 1, brightness: 100, contrast: 100, grayscale: false, texts: [] };
}
function clonePage(page) { return JSON.parse(JSON.stringify(page)); }
function snapshot() { return { currentPage, pages: pages.map(clonePage) }; }

function restoreSnapshot(state) {
  pages = state.pages.map(clonePage);
  currentPage = Math.min(state.currentPage, Math.max(0, pages.length - 1));
  selectedTextId = null;
  renderCurrentPage();
}

function commitHistory() {
  if (isRestoringHistory || !pages.length) return;
  history.push(snapshot());
  if (history.length > MAX_HISTORY) history.shift();
  future = [];
  updateHistoryButtons();
}
function updateHistoryButtons() {
  undoButton.disabled = history.length === 0;
  redoButton.disabled = future.length === 0;
}

undoButton.addEventListener('click', () => {
  if (!history.length) return;
  future.push(snapshot());
  const state = history.pop();
  isRestoringHistory = true;
  restoreSnapshot(state);
  isRestoringHistory = false;
  updateHistoryButtons();
});
redoButton.addEventListener('click', () => {
  if (!future.length) return;
  history.push(snapshot());
  const state = future.pop();
  isRestoringHistory = true;
  restoreSnapshot(state);
  isRestoringHistory = false;
  updateHistoryButtons();
});

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(event.target?.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) { event.preventDefault(); undoButton.click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !typing) { event.preventDefault(); redoButton.click(); }
  if (event.key === 'Escape' && cropMode) exitCropMode();
  if (event.key === 'Delete' && !typing) deleteSelectedText();
});

fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });
['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove('dragover'); }));
dropZone.addEventListener('drop', event => { const file = event.dataTransfer.files[0]; if (file) loadFile(file); });

$('#newFileButton').addEventListener('click', () => fileInput.click());
printButton.addEventListener('click', printAllPages);

$('#rotateButton').addEventListener('click', () => {
  if (!pages.length) return;
  commitHistory();
  const page = pages[currentPage];
  page.rotation = (page.rotation + 90) % 360;
  page.texts.forEach(text => { const oldX = text.x; text.x = 1 - text.y; text.y = oldX; });
  renderCurrentPage();
});

for (const range of [scaleRange, brightnessRange, contrastRange]) {
  range.addEventListener('pointerdown', () => {
    if (!sliderHistoryStarted && pages.length) { commitHistory(); sliderHistoryStarted = true; }
  });
  range.addEventListener('change', () => { sliderHistoryStarted = false; });
}
scaleRange.addEventListener('input', () => {
  if (!pages.length) return;
  pages[currentPage].scale = Number(scaleRange.value) / 100;
  scaleLabel.textContent = `${scaleRange.value}%`;
  renderCurrentPage();
});
brightnessRange.addEventListener('input', () => {
  if (!pages.length) return;
  pages[currentPage].brightness = Number(brightnessRange.value);
  renderCurrentPage();
});
contrastRange.addEventListener('input', () => {
  if (!pages.length) return;
  pages[currentPage].contrast = Number(contrastRange.value);
  renderCurrentPage();
});

gratings();
function gratings() {
  grayscaleButton.addEventListener('click', () => {
    if (!pages.length) return;
    commitHistory();
    pages[currentPage].grayscale = !pages[currentPage].grayscale;
    grayscaleButton.textContent = pages[currentPage].grayscale ? '🟦 カラーに戻す' : '⚫ 白黒にする';
    renderCurrentPage();
  });
}

$('#resetButton').addEventListener('click', () => {
  if (!pages.length) return;
  commitHistory();
  const page = pages[currentPage];
  page.baseSrc = page.initialSrc;
  page.rotation = 0;
  page.scale = DEFAULT_RENDER_SCALE;
  page.brightness = 100;
  page.contrast = 100;
  page.grayscale = false;
  page.texts = [];
  selectedTextId = null;
  refreshControls();
  renderCurrentPage();
});

$('#addTextButton').addEventListener('click', () => openTextDialog());
$('#cancelText').addEventListener('click', closeTextDialog);
confirmText.addEventListener('click', confirmTextAction);
textDialog.addEventListener('click', event => { if (event.target === textDialog) closeTextDialog(); });
boldTextButton.addEventListener('click', () => { dialogBold = !dialogBold; boldTextButton.classList.toggle('active', dialogBold); });
verticalTextButton.addEventListener('click', () => { dialogVertical = !dialogVertical; verticalTextButton.classList.toggle('active', dialogVertical); });

cropButton.addEventListener('click', enterCropMode);
cancelCropButton.addEventListener('click', exitCropMode);
applyCropButton.addEventListener('click', applyCrop);

pageArea.addEventListener('pointerdown', event => {
  if (!cropMode || (event.target !== canvas && event.target !== pageArea)) return;
  const point = canvasPointFromEvent(event);
  cropStart = point;
  cropRect = { x: point.x, y: point.y, width: 0, height: 0 };
  updateCropOverlay();
});
pageArea.addEventListener('pointermove', event => {
  if (!cropMode || !cropStart) return;
  cropRect = normalizeRect(cropStart, canvasPointFromEvent(event));
  updateCropOverlay();
});
pageArea.addEventListener('pointerup', event => {
  if (!cropMode || !cropStart) return;
  cropRect = normalizeRect(cropStart, canvasPointFromEvent(event));
  cropStart = null;
  updateCropOverlay();
});

prevPageButton.addEventListener('click', () => switchPage(currentPage - 1));
nextPageButton.addEventListener('click', () => switchPage(currentPage + 1));

async function loadFile(file) {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!file.type.startsWith('image/') && !isPdf) { alert('画像またはPDFを選んでください。'); return; }
  try {
    printButton.disabled = true;
    fileInput.disabled = true;
    pages = isPdf ? await loadPdfPages(file) : [await loadImagePage(file)];
    currentPage = 0; history = []; future = []; selectedTextId = null;
    showEditor(); refreshControls(); renderCurrentPage(); updateHistoryButtons();
  } catch (error) {
    console.error(error);
    alert(`ファイルを開けませんでした。\n${error?.message || ''}`);
  } finally { fileInput.disabled = false; }
}

async function loadImagePage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const normalized = document.createElement('canvas');
    normalized.width = img.naturalWidth; normalized.height = img.naturalHeight;
    normalized.getContext('2d').drawImage(img, 0, 0);
    const src = normalized.toDataURL('image/png');
    return { ...emptyPage(), name: file.name, baseSrc: src, initialSrc: src };
  } finally { URL.revokeObjectURL(url); }
}

async function loadPdfPages(file) {
  const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const result = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    pageIndicator.textContent = `PDF読込中 ${index} / ${pdf.numPages}`;
    const pdfPage = await pdf.getPage(index);
    const viewport = pdfPage.getViewport({ scale: 1.5 });
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = Math.ceil(viewport.width); pageCanvas.height = Math.ceil(viewport.height);
    await pdfPage.render({ canvasContext: pageCanvas.getContext('2d'), viewport }).promise;
    const src = pageCanvas.toDataURL('image/png');
    result.push({ ...emptyPage(), name: `${file.name} - ${index}ページ`, baseSrc: src, initialSrc: src });
  }
  return result;
}

function showEditor() {
  startScreen.classList.add('hidden'); editor.classList.remove('hidden'); printButton.disabled = false;
}

async function renderCurrentPage() {
  const page = pages[currentPage];
  if (!page?.baseSrc) return;
  sourceImage = await loadImage(page.baseSrc);
  const w = sourceImage.naturalWidth; const h = sourceImage.naturalHeight;
  const angle = page.rotation * Math.PI / 180; const rotated = page.rotation % 180 !== 0;
  const outW = Math.max(1, Math.round((rotated ? h : w) * page.scale));
  const outH = Math.max(1, Math.round((rotated ? w : h) * page.scale));
  canvas.width = outW; canvas.height = outH;
  ctx.filter = `brightness(${page.brightness}%) contrast(${page.contrast}%)${page.grayscale ? ' grayscale(100%)' : ''}`;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, outW, outH);
  ctx.save(); ctx.translate(outW / 2, outH / 2); ctx.rotate(angle);
  ctx.drawImage(sourceImage, -w * page.scale / 2, -h * page.scale / 2, w * page.scale, h * page.scale);
  ctx.restore(); ctx.filter = 'none';
  pageArea.style.width = `${outW}px`; pageArea.style.height = `${outH}px`;
  renderTexts(); updatePageControls();
}

function renderTexts() {
  textLayer.innerHTML = '';
  const page = pages[currentPage]; if (!page) return;
  page.texts.forEach(item => {
    const el = document.createElement('div');
    el.className = `text-item${item.id === selectedTextId ? ' selected' : ''}`;
    el.textContent = item.value; el.dataset.id = item.id;
    el.style.left = `${item.x * canvas.width}px`; el.style.top = `${item.y * canvas.height}px`;
    el.style.fontSize = `${Math.max(10, item.fontRatio * canvas.width)}px`;
    el.style.color = item.color; el.style.fontWeight = item.bold ? '800' : '600';
    el.style.writingMode = item.vertical ? 'vertical-rl' : 'horizontal-tb';

    el.addEventListener('pointerdown', event => {
      if (cropMode) return;
      event.preventDefault(); event.stopPropagation();
      el.setPointerCapture(event.pointerId);
      selectedTextId = item.id;
      snapshotBeforeDrag = snapshot();
      drag = { item, startX: event.clientX, startY: event.clientY, x: item.x, y: item.y };
      markSelected(item.id);
    });
    el.addEventListener('pointermove', event => {
      if (!drag || drag.item !== item) return;
      const dx = (event.clientX - drag.startX) / canvas.width;
      const dy = (event.clientY - drag.startY) / canvas.height;
      item.x = clamp(drag.x + dx, 0, 1); item.y = clamp(drag.y + dy, 0, 1);
      el.style.left = `${item.x * canvas.width}px`; el.style.top = `${item.y * canvas.height}px`;
    });
    el.addEventListener('pointerup', () => {
      if (!drag || drag.item !== item) return;
      drag = null;
      if (snapshotBeforeDrag) {
        history.push(snapshotBeforeDrag);
        if (history.length > MAX_HISTORY) history.shift();
        future = [];
        snapshotBeforeDrag = null;
      }
      updateHistoryButtons(); markSelected(item.id);
    });
    el.addEventListener('dblclick', event => { event.stopPropagation(); openTextDialog(item); });
    textLayer.appendChild(el);
  });
}

function markSelected(id) {
  selectedTextId = id;
  [...textLayer.children].forEach(node => node.classList.toggle('selected', node.dataset.id === id));
}
function deleteSelectedText() {
  if (!pages.length || !selectedTextId) return;
  const page = pages[currentPage];
  if (!page.texts.some(text => text.id === selectedTextId)) return;
  commitHistory(); page.texts = page.texts.filter(text => text.id !== selectedTextId); selectedTextId = null; renderTexts();
}

async function openTextDialog(item = null) {
  editingTextId = item?.id || null;
  textInput.value = item?.value || '';
  textSize.value = item ? Math.round(item.fontRatio * canvas.width) : 28;
  textColor.value = item?.color || '#111111';
  dialogBold = item?.bold || false; dialogVertical = item?.vertical || false;
  boldTextButton.classList.toggle('active', dialogBold); verticalTextButton.classList.toggle('active', dialogVertical);
  confirmText.textContent = item ? '文字を変更する' : '文字を入れる';
  textDialog.classList.remove('hidden');
  await new Promise(resolve => requestAnimationFrame(resolve)); textInput.focus();
}
function closeTextDialog() { textDialog.classList.add('hidden'); editingTextId = null; }
function confirmTextAction() {
  const value = textInput.value.trim(); if (!value || !pages.length) return;
  commitHistory();
  const page = pages[currentPage]; const fontRatio = Number(textSize.value) / Math.max(1, canvas.width);
  if (editingTextId) {
    const item = page.texts.find(text => text.id === editingTextId);
    if (item) { item.value = value; item.fontRatio = fontRatio; item.color = textColor.value; item.bold = dialogBold; item.vertical = dialogVertical; }
  } else {
    page.texts.push({ id: crypto.randomUUID(), value, x: 0.05, y: 0.05, fontRatio, color: textColor.value, bold: dialogBold, vertical: dialogVertical });
  }
  closeTextDialog(); renderTexts();
}

function enterCropMode() {
  if (!pages.length) return;
  cropMode = true; cropStart = null; cropRect = null;
  cropNotice.classList.remove('hidden'); cropOverlay.classList.remove('hidden'); textLayer.style.pointerEvents = 'none';
}
function exitCropMode() {
  cropMode = false; cropStart = null; cropRect = null;
  cropNotice.classList.add('hidden'); cropOverlay.classList.add('hidden'); textLayer.style.pointerEvents = 'none';
}
function updateCropOverlay() {
  if (!cropRect) { cropOverlay.style.width = '0'; cropOverlay.style.height = '0'; return; }
  cropOverlay.style.left = `${cropRect.x}px`; cropOverlay.style.top = `${cropRect.y}px`;
  cropOverlay.style.width = `${cropRect.width}px`; cropOverlay.style.height = `${cropRect.height}px`;
}
function applyCrop() {
  if (!pages.length || !cropRect || cropRect.width < 5 || cropRect.height < 5) { alert('切り取る範囲をドラッグしてください。'); return; }
  commitHistory();
  const x = Math.max(0, Math.floor(cropRect.x)); const y = Math.max(0, Math.floor(cropRect.y));
  const width = Math.min(canvas.width - x, Math.floor(cropRect.width)); const height = Math.min(canvas.height - y, Math.floor(cropRect.height));
  const out = document.createElement('canvas'); out.width = Math.max(1, width); out.height = Math.max(1, height);
  out.getContext('2d').drawImage(canvas, x, y, width, height, 0, 0, width, height);
  const page = pages[currentPage];
  page.baseSrc = out.toDataURL('image/png'); page.rotation = 0; page.scale = 1; page.brightness = 100; page.contrast = 100; page.grayscale = false;
  page.texts = page.texts.map(text => {
    const px = text.x * canvas.width; const py = text.y * canvas.height;
    return { ...text, x: clamp((px - x) / width, 0, 1), y: clamp((py - y) / height, 0, 1), fontRatio: (text.fontRatio * canvas.width) / width };
  }).filter(text => text.x >= 0 && text.x <= 1 && text.y >= 0 && text.y <= 1);
  exitCropMode(); refreshControls(); renderCurrentPage();
}
function canvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) * (canvas.width / rect.width), 0, canvas.width), y: clamp((event.clientY - rect.top) * (canvas.height / rect.height), 0, canvas.height) };
}
function normalizeRect(a, b) { return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }; }

function refreshControls() {
  const page = pages[currentPage]; if (!page) return;
  scaleRange.value = Math.round(page.scale * 100); scaleLabel.textContent = `${scaleRange.value}%`;
  brightnessRange.value = page.brightness; contrastRange.value = page.contrast;
  grayscaleButton.textContent = page.grayscale ? '🟦 カラーに戻す' : '⚫ 白黒にする'; updatePageControls();
}
function updatePageControls() {
  if (!pages.length) return;
  pageIndicator.textContent = `${currentPage + 1} / ${pages.length}`;
  prevPageButton.disabled = currentPage === 0; nextPageButton.disabled = currentPage === pages.length - 1;
}
function switchPage(next) {
  if (next < 0 || next >= pages.length || next === currentPage) return;
  currentPage = next; selectedTextId = null; exitCropMode(); refreshControls(); renderCurrentPage();
}

async function printAllPages() {
  if (!pages.length) return;
  const printRoot = document.createElement('div'); printRoot.id = 'printPages'; printRoot.className = 'print-pages'; document.body.appendChild(printRoot);
  try {
    for (const page of pages) {
      const image = await loadImage(page.baseSrc); const w = image.naturalWidth; const h = image.naturalHeight; const rotated = page.rotation % 180 !== 0;
      const outW = Math.max(1, Math.round((rotated ? h : w) * page.scale)); const outH = Math.max(1, Math.round((rotated ? w : h) * page.scale));
      const out = document.createElement('canvas'); out.width = outW; out.height = outH; const outCtx = out.getContext('2d');
      outCtx.filter = `brightness(${page.brightness}%) contrast(${page.contrast}%)${page.grayscale ? ' grayscale(100%)' : ''}`;
      outCtx.fillStyle = '#fff'; outCtx.fillRect(0, 0, outW, outH); outCtx.save(); outCtx.translate(outW / 2, outH / 2); outCtx.rotate(page.rotation * Math.PI / 180);
      outCtx.drawImage(image, -w * page.scale / 2, -h * page.scale / 2, w * page.scale, h * page.scale); outCtx.restore(); outCtx.filter = 'none';
      const sheet = document.createElement('div'); sheet.className = 'print-sheet'; sheet.style.width = `${outW}px`; sheet.style.height = `${outH}px`; sheet.appendChild(out);
      page.texts.forEach(text => {
        const label = document.createElement('div'); label.className = 'print-text'; label.textContent = text.value;
        label.style.left = `${text.x * outW}px`; label.style.top = `${text.y * outH}px`; label.style.fontSize = `${Math.max(10, text.fontRatio * outW)}px`;
        label.style.color = text.color; label.style.fontWeight = text.bold ? '800' : '600'; label.style.writingMode = text.vertical ? 'vertical-rl' : 'horizontal-tb'; sheet.appendChild(label);
      });
      printRoot.appendChild(sheet);
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.print();
  } finally { setTimeout(() => printRoot.remove(), 1200); }
}

function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('画像の読み込みに失敗しました。')); img.src = src; });
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
