const $ = (id) => document.getElementById(id);

const PAPER = {
  A4: [210, 297],
  A5: [148, 210],
  B5: [176, 250]
};
const MAX_HISTORY = 30;

let pages = [];
let currentPage = 0;
let mode = 'blank';
let history = [];
let future = [];
let selectedId = null;
let editingTextId = null;
let cropMode = false;
let cropStart = null;
let cropRect = null;
let drag = null;
let sliderSession = null;
let printRoot = null;

let dialogStyle = {
  bold: false,
  italic: false,
  underline: false,
  vertical: false,
  align: 'left'
};

const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const clone = (value) => JSON.parse(JSON.stringify(value));

function blankPage(paper = 'A4', orientation = 'portrait') {
  return {
    id: uid(),
    source: null,
    sourceName: '白紙',
    rotation: 0,
    scale: 1,
    brightness: 100,
    contrast: 100,
    grayscale: false,
    paper,
    orientation,
    elements: []
  };
}

function snapshot() {
  return { pages: clone(pages), currentPage, mode };
}

function pushHistory() {
  if (!pages.length) return;
  history.push(snapshot());
  if (history.length > MAX_HISTORY) history.shift();
  future = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  $('undoButton').disabled = history.length === 0;
  $('redoButton').disabled = future.length === 0;
}

function restore(state) {
  pages = clone(state.pages);
  currentPage = Math.max(0, Math.min(state.currentPage, pages.length - 1));
  mode = state.mode;
  selectedId = null;
  render();
}

function dims(page) {
  const [w, h] = PAPER[page.paper] || PAPER.A4;
  return page.orientation === 'portrait' ? [w, h] : [h, w];
}

function aspect(page) {
  const [w, h] = dims(page);
  return `${w} / ${h}`;
}

function currentPageData() {
  return pages[currentPage] || null;
}

function showEditor() {
  $('homeScreen').classList.add('hidden');
  $('editor').classList.remove('hidden');
}

function showHome() {
  closeHelp();
  closeTextDialog();
  closePreview();
  exitCropMode();
  selectedId = null;
  $('editor').classList.add('hidden');
  $('homeScreen').classList.remove('hidden');
}

function refreshControls() {
  const page = currentPageData();
  if (!page) return;

  $('paperSize').value = page.paper;
  $('orientation').value = page.orientation;
  $('scaleRange').value = Math.round(page.scale * 100);
  $('scaleLabel').textContent = `${Math.round(page.scale * 100)}%`;
  $('brightnessRange').value = page.brightness;
  $('contrastRange').value = page.contrast;
  $('grayscaleButton').textContent = page.grayscale
    ? '🟦 カラーに戻す'
    : '⚫ 白黒にする';
  $('pageIndicator').textContent = `${currentPage + 1} / ${pages.length}`;
  $('prevPageButton').disabled = currentPage === 0;
  $('nextPageButton').disabled = currentPage === pages.length - 1;
  $('printButton').disabled = pages.length === 0;
  $('previewButton').disabled = pages.length === 0;

  updateSelectionUI();
  updateHistoryButtons();
}

function updateSelectionUI() {
  const page = currentPageData();
  const item = page?.elements.find((entry) => entry.id === selectedId) || null;
  $('editSelectedButton').disabled = item?.type !== 'text';
  $('deleteSelectedButton').disabled = !item;

  document.querySelectorAll('.canvas-item').forEach((node) => {
    node.classList.toggle('selected', node.dataset.id === selectedId);
  });
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('画像を読み込めませんでした。'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像の表示に失敗しました。'));
    image.src = src;
  });
}

async function loadFile(file) {
  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (!isImage && !isPdf) {
    alert('画像またはPDFを選んでください。');
    return;
  }

  try {
    $('openFileButton').disabled = true;
    $('scanModeButton').disabled = true;

    if (isImage) {
      const src = await loadImageFile(file);
      pages = [{ ...blankPage(), source: src, sourceName: file.name }];
      mode = 'scan';
    } else {
      const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
      const result = [];

      for (let index = 1; index <= pdf.numPages; index += 1) {
        const pdfPage = await pdf.getPage(index);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        result.push({
          ...blankPage(),
          source: canvas.toDataURL('image/png'),
          sourceName: `${file.name} - ${index}ページ`
        });
      }
      pages = result;
      mode = 'scan';
    }

    currentPage = 0;
    history = [];
    future = [];
    selectedId = null;
    showEditor();
    render();
  } catch (error) {
    console.error(error);
    alert(`ファイルを開けませんでした。\n${error?.message || ''}`);
  } finally {
    $('openFileButton').disabled = false;
    $('scanModeButton').disabled = false;
    $('fileInput').value = '';
  }
}

function containRect(imageWidth, imageHeight, containerWidth, containerHeight) {
  if (!imageWidth || !imageHeight || !containerWidth || !containerHeight) {
    return { x: 0, y: 0, width: containerWidth, height: containerHeight };
  }
  const scale = Math.min(containerWidth / imageWidth, containerHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (containerWidth - width) / 2,
    y: (containerHeight - height) / 2,
    width,
    height
  };
}

function render() {
  const page = currentPageData();
  if (!page) return;

  const layer = $('documentLayer');
  layer.innerHTML = '';
  layer.style.aspectRatio = aspect(page);
  $('pageArea').style.aspectRatio = aspect(page);

  if (page.source) {
    const background = document.createElement('img');
    background.className = 'page-background';
    background.id = 'page-background';
    background.src = page.source;
    background.alt = page.sourceName || 'スキャンしたページ';
    background.style.filter =
      `brightness(${page.brightness}%) contrast(${page.contrast}%)` +
      (page.grayscale ? ' grayscale(100%)' : '');
    background.style.transform = `scale(${page.scale}) rotate(${page.rotation}deg)`;
    layer.appendChild(background);
  }

  for (const item of page.elements) layer.appendChild(makeElement(item));
  refreshControls();
}

function makeElement(item) {
  const element = document.createElement('div');
  element.className = `canvas-item ${item.type}${item.id === selectedId ? ' selected' : ''}`;
  element.dataset.id = item.id;
  element.style.left = `${item.x * 100}%`;
  element.style.top = `${item.y * 100}%`;
  element.style.width = `${item.w * 100}%`;
  element.style.height = `${item.h * 100}%`;

  if (item.type === 'text') {
    element.textContent = item.value;
    element.style.fontSize = `${item.size}px`;
    element.style.color = item.color;
    element.style.fontWeight = item.bold ? '800' : '500';
    element.style.fontStyle = item.italic ? 'italic' : 'normal';
    element.style.textDecoration = item.underline ? 'underline' : 'none';
    element.style.writingMode = item.vertical ? 'vertical-rl' : 'horizontal-tb';
    element.style.textAlign = item.align || 'left';
  } else {
    const image = document.createElement('img');
    image.src = item.src;
    image.alt = '追加した画像';
    image.draggable = false;
    element.appendChild(image);
  }

  const handle = document.createElement('span');
  handle.className = 'resize-handle';
  element.appendChild(handle);

  element.addEventListener('pointerdown', (event) => {
    if (cropMode) return;
    event.preventDefault();
    event.stopPropagation();
    selectedId = item.id;
    drag = {
      item,
      startX: event.clientX,
      startY: event.clientY,
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
      resize: event.target === handle,
      before: snapshot()
    };
    element.setPointerCapture?.(event.pointerId);
    updateSelectionUI();
  });

  element.addEventListener('pointermove', (event) => {
    if (!drag || drag.item !== item) return;
    const rect = $('documentLayer').getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dx = (event.clientX - drag.startX) / rect.width;
    const dy = (event.clientY - drag.startY) / rect.height;

    if (drag.resize) {
      item.w = Math.max(0.05, Math.min(1 - item.x, drag.w + dx));
      item.h = Math.max(0.04, Math.min(1 - item.y, drag.h + dy));
    } else {
      item.x = Math.max(0, Math.min(1 - item.w, drag.x + dx));
      item.y = Math.max(0, Math.min(1 - item.h, drag.y + dy));
    }

    element.style.left = `${item.x * 100}%`;
    element.style.top = `${item.y * 100}%`;
    element.style.width = `${item.w * 100}%`;
    element.style.height = `${item.h * 100}%`;
  });

  const finishDrag = () => {
    if (!drag || drag.item !== item) return;
    history.push(drag.before);
    if (history.length > MAX_HISTORY) history.shift();
    future = [];
    drag = null;
    updateHistoryButtons();
  };

  element.addEventListener('pointerup', finishDrag);
  element.addEventListener('pointercancel', finishDrag);
  element.addEventListener('lostpointercapture', finishDrag);
  element.addEventListener('dblclick', (event) => {
    event.stopPropagation();
    if (item.type === 'text') openTextDialog(item);
  });

  return element;
}

function enterEditor(which = 'blank') {
  mode = which;
  if (!pages.length) pages = [blankPage()];
  currentPage = Math.max(0, Math.min(currentPage, pages.length - 1));
  history = [];
  future = [];
  selectedId = null;
  showEditor();
  render();
}

function addBlankPage() {
  const current = currentPageData();
  pushHistory();
  pages.push(blankPage(current?.paper || 'A4', current?.orientation || 'portrait'));
  currentPage = pages.length - 1;
  mode = 'blank';
  selectedId = null;
  render();
}

function handlePageNavigation(nextPage) {
  if (nextPage < 0 || nextPage >= pages.length || nextPage === currentPage) return;
  exitCropMode();
  selectedId = null;
  currentPage = nextPage;
  render();
}

function beginSliderHistory(id) {
  if (sliderSession?.id === id) return;
  pushHistory();
  sliderSession = { id };
}

function endSliderHistory() {
  sliderSession = null;
}

function applySlider(id, value) {
  const page = currentPageData();
  if (!page) return;

  if (id === 'scaleRange') {
    page.scale = Number(value) / 100;
    $('scaleLabel').textContent = `${value}%`;
  } else if (id === 'brightnessRange') {
    page.brightness = Number(value);
  } else if (id === 'contrastRange') {
    page.contrast = Number(value);
  }
  render();
}

function updateTextPreview() {
  const preview = $('textPreview');
  if (!preview) return;
  preview.textContent = $('textInput').value || '入力した文字がここに表示されます';
  preview.style.fontSize = `${$('textSize').value}px`;
  preview.style.color = $('textColor').value;
  preview.style.fontWeight = dialogStyle.bold ? '800' : '500';
  preview.style.fontStyle = dialogStyle.italic ? 'italic' : 'normal';
  preview.style.textDecoration = dialogStyle.underline ? 'underline' : 'none';
  preview.style.writingMode = dialogStyle.vertical ? 'vertical-rl' : 'horizontal-tb';
  preview.style.textAlign = dialogStyle.align;
}

function syncDialogButtons() {
  $('boldTextButton').classList.toggle('active', dialogStyle.bold);
  $('italicTextButton').classList.toggle('active', dialogStyle.italic);
  $('underlineTextButton').classList.toggle('active', dialogStyle.underline);
  $('verticalTextButton').classList.toggle('active', dialogStyle.vertical);
  document.querySelectorAll('[data-align]').forEach((button) => {
    button.classList.toggle('active', button.dataset.align === dialogStyle.align);
  });
}

function openTextDialog(item = null) {
  editingTextId = item?.id || null;
  dialogStyle = {
    bold: item?.bold || false,
    italic: item?.italic || false,
    underline: item?.underline || false,
    vertical: item?.vertical || false,
    align: item?.align || 'left'
  };
  $('textInput').value = item?.value || '';
  $('textSize').value = item?.size || 28;
  $('textColor').value = item?.color || '#111111';
  $('textDialogTitle').textContent = item ? '文字を編集' : '文字を入れる';
  $('confirmText').textContent = item ? '変更する' : '文字を入れる';
  syncDialogButtons();
  updateTextPreview();
  $('textDialog').classList.remove('hidden');
  $('textInput').focus();
}

function closeTextDialog() {
  $('textDialog').classList.add('hidden');
  editingTextId = null;
}

function saveText() {
  const value = $('textInput').value.trim();
  if (!value || !pages.length) return;

  const page = currentPageData();
  const existing = editingTextId
    ? page.elements.find((entry) => entry.id === editingTextId)
    : null;

  if (existing && existing.type === 'text') {
    const next = {
      ...existing,
      value,
      size: Number($('textSize').value),
      color: $('textColor').value,
      ...dialogStyle
    };
    if (JSON.stringify(existing) === JSON.stringify(next)) {
      closeTextDialog();
      return;
    }
  }

  pushHistory();

  if (existing && existing.type === 'text') {
    Object.assign(existing, {
      value,
      size: Number($('textSize').value),
      color: $('textColor').value,
      ...dialogStyle
    });
  } else {
    page.elements.push({
      id: uid(),
      type: 'text',
      value,
      size: Number($('textSize').value),
      color: $('textColor').value,
      x: 0.06,
      y: 0.06,
      w: 0.62,
      h: 0.18,
      ...dialogStyle
    });
  }

  closeTextDialog();
  render();
}

function getPageRect() {
  return $('documentLayer').getBoundingClientRect();
}

function normalizePoint(event, rect = getPageRect()) {
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function enterCropMode() {
  const page = currentPageData();
  if (!page?.source) {
    alert('画像やPDFを開いているページで使えます。');
    return;
  }
  cropMode = true;
  cropStart = null;
  cropRect = null;
  $('cropNotice').classList.remove('hidden');
  $('cropOverlay').classList.remove('hidden');
}

function exitCropMode() {
  cropMode = false;
  cropStart = null;
  cropRect = null;
  $('cropNotice')?.classList.add('hidden');
  $('cropOverlay')?.classList.add('hidden');
}

function updateCropOverlay() {
  const overlay = $('cropOverlay');
  if (!cropRect) {
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '0';
    overlay.style.height = '0';
    return;
  }
  overlay.style.left = `${cropRect.x * 100}%`;
  overlay.style.top = `${cropRect.y * 100}%`;
  overlay.style.width = `${cropRect.w * 100}%`;
  overlay.style.height = `${cropRect.h * 100}%`;
}

async function applyCrop() {
  const page = currentPageData();
  if (!page?.source || !cropRect || cropRect.w < 0.03 || cropRect.h < 0.03) {
    alert('切り取る範囲をドラッグしてください。');
    return;
  }

  const image = await loadImage(page.source);
  const pageRect = getPageRect();
  const fit = containRect(image.naturalWidth, image.naturalHeight, pageRect.width, pageRect.height);
  const cropLeftPx = cropRect.x * pageRect.width;
  const cropTopPx = cropRect.y * pageRect.height;
  const cropWidthPx = cropRect.w * pageRect.width;
  const cropHeightPx = cropRect.h * pageRect.height;
  const sourceLeft = (cropLeftPx - fit.x) / fit.width;
  const sourceTop = (cropTopPx - fit.y) / fit.height;
  const sourceWidth = cropWidthPx / fit.width;
  const sourceHeight = cropHeightPx / fit.height;
  const sx = Math.max(0, Math.min(1, sourceLeft));
  const sy = Math.max(0, Math.min(1, sourceTop));
  const sw = Math.max(0, Math.min(1 - sx, sourceWidth));
  const sh = Math.max(0, Math.min(1 - sy, sourceHeight));

  if (sw <= 0 || sh <= 0) {
    alert('画像が含まれる範囲を選んでください。');
    return;
  }

  const output = document.createElement('canvas');
  output.width = Math.max(1, Math.round(image.naturalWidth * sw));
  output.height = Math.max(1, Math.round(image.naturalHeight * sh));
  output.getContext('2d').drawImage(
    image,
    image.naturalWidth * sx,
    image.naturalHeight * sy,
    image.naturalWidth * sw,
    image.naturalHeight * sh,
    0,
    0,
    output.width,
    output.height
  );

  pushHistory();
  page.source = output.toDataURL('image/png');
  page.sourceName = `${page.sourceName || '画像'} - 切り取り`;
  page.scale = 1;
  page.rotation = 0;
  page.brightness = 100;
  page.contrast = 100;
  page.grayscale = false;

  page.elements = page.elements
    .map((item) => ({
      ...item,
      x: (item.x - cropRect.x) / cropRect.w,
      y: (item.y - cropRect.y) / cropRect.h,
      w: item.w / cropRect.w,
      h: item.h / cropRect.h
    }))
    .filter((item) => item.x + item.w > 0 && item.y + item.h > 0 && item.x < 1 && item.y < 1)
    .map((item) => ({
      ...item,
      x: Math.max(0, Math.min(1 - Math.min(0.95, item.w), item.x)),
      y: Math.max(0, Math.min(1 - Math.min(0.95, item.h), item.y)),
      w: Math.min(0.95, item.w),
      h: Math.min(0.95, item.h)
    }));

  exitCropMode();
  selectedId = null;
  render();
}

function buildPaper(page) {
  const sheet = document.createElement('div');
  sheet.className = 'paper-sheet';
  const [widthMm, heightMm] = dims(page);
  sheet.style.width = `${widthMm}mm`;
  sheet.style.height = `${heightMm}mm`;
  sheet.style.aspectRatio = `${widthMm} / ${heightMm}`;

  if (page.source) {
    const background = document.createElement('img');
    background.className = 'paper-bg';
    background.src = page.source;
    background.alt = '';
    background.style.filter =
      `brightness(${page.brightness}%) contrast(${page.contrast}%)` +
      (page.grayscale ? ' grayscale(100%)' : '');
    background.style.transform = `scale(${page.scale}) rotate(${page.rotation}deg)`;
    sheet.appendChild(background);
  }

  page.elements.forEach((item) => {
    const element = document.createElement('div');
    element.className = `paper-item ${item.type}`;
    element.style.left = `${item.x * 100}%`;
    element.style.top = `${item.y * 100}%`;
    element.style.width = `${item.w * 100}%`;
    element.style.height = `${item.h * 100}%`;

    if (item.type === 'text') {
      element.textContent = item.value;
      element.style.fontSize = `${item.size}px`;
      element.style.color = item.color;
      element.style.fontWeight = item.bold ? '800' : '500';
      element.style.fontStyle = item.italic ? 'italic' : 'normal';
      element.style.textDecoration = item.underline ? 'underline' : 'none';
      element.style.writingMode = item.vertical ? 'vertical-rl' : 'horizontal-tb';
      element.style.textAlign = item.align || 'left';
    } else {
      const image = document.createElement('img');
      image.src = item.src;
      image.alt = '';
      element.appendChild(image);
    }
    sheet.appendChild(element);
  });
  return sheet;
}

function openPreview() {
  const root = $('previewPages');
  root.innerHTML = '';
  pages.forEach((page) => root.appendChild(buildPaper(page)));
  $('previewDialog').classList.remove('hidden');
}

function closePreview() {
  $('previewDialog').classList.add('hidden');
}

function printAll() {
  if (!pages.length) return;
  if (printRoot) printRoot.remove();
  printRoot = document.createElement('div');
  printRoot.id = 'printRoot';
  pages.forEach((page) => printRoot.appendChild(buildPaper(page)));
  document.body.appendChild(printRoot);

  const cleanup = () => {
    printRoot?.remove();
    printRoot = null;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
}

function openHelp() {
  $('helpDialog').classList.remove('hidden');
}
function closeHelp() {
  $('helpDialog').classList.add('hidden');
}

$('scanModeButton').addEventListener('click', () => $('fileInput').click());
$('blankModeButton').addEventListener('click', () => {
  pages = [blankPage()];
  currentPage = 0;
  history = [];
  future = [];
  selectedId = null;
  enterEditor('blank');
});
$('homeHelpButton').addEventListener('click', openHelp);
$('helpButton').addEventListener('click', openHelp);
$('closeHelpButton').addEventListener('click', closeHelp);
$('fileInput').addEventListener('change', () => {
  const file = $('fileInput').files[0];
  if (file) loadFile(file);
});
$('openFileButton').addEventListener('click', () => $('fileInput').click());
$('backHomeButton').addEventListener('click', showHome);
$('newBlankButton').addEventListener('click', addBlankPage);
$('addPageButton').addEventListener('click', addBlankPage);
$('prevPageButton').addEventListener('click', () => handlePageNavigation(currentPage - 1));
$('nextPageButton').addEventListener('click', () => handlePageNavigation(currentPage + 1));

$('paperSize').addEventListener('change', (event) => {
  pushHistory();
  currentPageData().paper = event.target.value;
  render();
});
$('orientation').addEventListener('change', (event) => {
  pushHistory();
  currentPageData().orientation = event.target.value;
  render();
});
$('rotatePageButton').addEventListener('click', () => {
  pushHistory();
  const page = currentPageData();
  page.orientation = page.orientation === 'portrait' ? 'landscape' : 'portrait';
  render();
});

for (const id of ['scaleRange', 'brightnessRange', 'contrastRange']) {
  $(id).addEventListener('pointerdown', () => beginSliderHistory(id));
  $(id).addEventListener('pointerup', endSliderHistory);
  $(id).addEventListener('pointercancel', endSliderHistory);
  $(id).addEventListener('change', endSliderHistory);
  $(id).addEventListener('input', (event) => applySlider(id, event.target.value));
}

$('grayscaleButton').addEventListener('click', () => {
  pushHistory();
  const page = currentPageData();
  page.grayscale = !page.grayscale;
  render();
});

$('addTextButton').addEventListener('click', () => openTextDialog());
$('addImageButton').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', async () => {
  const file = $('imageInput').files[0];
  if (!file) return;
  try {
    const src = await loadImageFile(file);
    pushHistory();
    const item = { id: uid(), type: 'image', src, x: 0.1, y: 0.1, w: 0.42, h: 0.3 };
    currentPageData().elements.push(item);
    selectedId = item.id;
    render();
  } catch (error) {
    alert(error.message || '画像を追加できませんでした。');
  } finally {
    $('imageInput').value = '';
  }
});

$('deleteSelectedButton').addEventListener('click', () => {
  const page = currentPageData();
  if (!page || !selectedId) return;
  const index = page.elements.findIndex((item) => item.id === selectedId);
  if (index < 0) return;
  pushHistory();
  page.elements.splice(index, 1);
  selectedId = null;
  render();
});

$('editSelectedButton').addEventListener('click', () => {
  const page = currentPageData();
  const item = page?.elements.find((entry) => entry.id === selectedId);
  if (item?.type === 'text') openTextDialog(item);
});

$('undoButton').addEventListener('click', () => {
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
});
$('redoButton').addEventListener('click', () => {
  if (!future.length) return;
  history.push(snapshot());
  restore(future.pop());
});

$('textInput').addEventListener('input', updateTextPreview);
$('textSize').addEventListener('input', updateTextPreview);
$('textColor').addEventListener('input', updateTextPreview);
for (const [id, key] of [
  ['boldTextButton', 'bold'],
  ['italicTextButton', 'italic'],
  ['underlineTextButton', 'underline'],
  ['verticalTextButton', 'vertical']
]) {
  $(id).addEventListener('click', () => {
    dialogStyle[key] = !dialogStyle[key];
    syncDialogButtons();
    updateTextPreview();
  });
}
document.querySelectorAll('[data-align]').forEach((button) => {
  button.addEventListener('click', () => {
    dialogStyle.align = button.dataset.align;
    syncDialogButtons();
    updateTextPreview();
  });
});
$('cancelText').addEventListener('click', closeTextDialog);
$('confirmText').addEventListener('click', saveText);

$('cropButton').addEventListener('click', enterCropMode);
$('cancelCropButton').addEventListener('click', exitCropMode);
$('applyCropButton').addEventListener('click', applyCrop);

$('pageArea').addEventListener('pointerdown', (event) => {
  if (!cropMode || event.target.closest('.canvas-item')) return;
  const rect = getPageRect();
  if (!rect.width || !rect.height) return;
  cropStart = normalizePoint(event, rect);
  cropRect = { x: cropStart.x, y: cropStart.y, w: 0, h: 0 };
  updateCropOverlay();
});
$('pageArea').addEventListener('pointermove', (event) => {
  if (!cropMode || !cropStart) return;
  const point = normalizePoint(event);
  cropRect = {
    x: Math.min(cropStart.x, point.x),
    y: Math.min(cropStart.y, point.y),
    w: Math.abs(cropStart.x - point.x),
    h: Math.abs(cropStart.y - point.y)
  };
  updateCropOverlay();
});
$('pageArea').addEventListener('pointerup', () => { if (cropMode) cropStart = null; });
$('pageArea').addEventListener('pointercancel', () => { cropStart = null; });

$('previewButton').addEventListener('click', openPreview);
$('closePreviewButton').addEventListener('click', closePreview);
$('previewPrintButton').addEventListener('click', () => {
  closePreview();
  printAll();
});

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !typing) {
    event.preventDefault();
    $('undoButton').click();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && !typing) {
    event.preventDefault();
    $('redoButton').click();
  }
  if (event.key === 'Delete' && !typing) $('deleteSelectedButton').click();
  if (event.key === 'Escape') {
    closeHelp();
    closeTextDialog();
    closePreview();
    exitCropMode();
  }
});

document.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
});

document.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.files?.length) return;
  const target = event.target;
  if (target.closest('#homeScreen') || target.closest('#pageArea')) {
    event.preventDefault();
    loadFile(event.dataTransfer.files[0]);
  }
});

pages = [];
updateHistoryButtons();
$('editor').classList.add('hidden');
$('homeScreen').classList.remove('hidden');
