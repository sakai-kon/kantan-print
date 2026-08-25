const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const startScreen = document.querySelector('#startScreen');
const editor = document.querySelector('#editor');
const canvas = document.querySelector('#documentCanvas');
const ctx = canvas.getContext('2d');
const pageArea = document.querySelector('#pageArea');
const textLayer = document.querySelector('#textLayer');
const printButton = document.querySelector('#printButton');
const scaleRange = document.querySelector('#scaleRange');
const emptyHint = document.querySelector('#emptyHint');
const textDialog = document.querySelector('#textDialog');
const textInput = document.querySelector('#textInput');
const textSize = document.querySelector('#textSize');

let sourceImage = null;
let sourceDataUrl = null;
let rotation = 0;
let scale = 1;
let texts = [];
let drag = null;

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
}));
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  if (file) loadFile(file);
});

document.querySelector('#newFileButton').addEventListener('click', () => fileInput.click());
printButton.addEventListener('click', () => window.print());

document.querySelector('#rotateButton').addEventListener('click', () => {
  rotation = (rotation + 90) % 360;
  render();
});

scaleRange.addEventListener('input', () => {
  scale = Number(scaleRange.value) / 100;
  render();
});

document.querySelector('#resetButton').addEventListener('click', () => {
  rotation = 0;
  scale = 1;
  scaleRange.value = 100;
  texts = [];
  render();
});

document.querySelector('#addTextButton').addEventListener('click', () => {
  textInput.value = '';
  textDialog.classList.remove('hidden');
  textInput.focus();
});
document.querySelector('#cancelText').addEventListener('click', () => textDialog.classList.add('hidden'));
document.querySelector('#confirmText').addEventListener('click', addText);
textDialog.addEventListener('click', e => {
  if (e.target === textDialog) textDialog.classList.add('hidden');
});

async function loadFile(file) {
  if (file.type.startsWith('image/')) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      sourceDataUrl = url;
      rotation = 0;
      scale = 1;
      scaleRange.value = 100;
      texts = [];
      showEditor();
      render();
    };
    img.src = url;
    return;
  }

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
      const buffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      sourceImage = canvasToImage();
      sourceDataUrl = canvas.toDataURL('image/png');
      rotation = 0;
      scale = 1;
      scaleRange.value = 100;
      texts = [];
      showEditor();
      render();
      if (pdf.numPages > 1) {
        alert(`PDFの1ページ目を表示しています。現在は1ページ目の編集に対応しています。`);
      }
    } catch (error) {
      console.error(error);
      alert('PDFを開けませんでした。');
    }
    return;
  }

  alert('画像またはPDFを選んでください。');
}

function canvasToImage() {
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  return img;
}

function showEditor() {
  startScreen.classList.add('hidden');
  editor.classList.remove('hidden');
  printButton.disabled = false;
  emptyHint.classList.add('hidden');
}

function render() {
  if (!sourceImage || !sourceImage.complete) return;

  const w = sourceImage.naturalWidth || sourceImage.width;
  const h = sourceImage.naturalHeight || sourceImage.height;
  const angle = rotation * Math.PI / 180;
  const rotated = rotation % 180 !== 0;
  const outW = Math.round((rotated ? h : w) * scale);
  const outH = Math.round((rotated ? w : h) * scale);

  canvas.width = outW;
  canvas.height = outH;
  ctx.clearRect(0, 0, outW, outH);
  ctx.save();
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate(angle);
  ctx.drawImage(sourceImage, -w * scale / 2, -h * scale / 2, w * scale, h * scale);
  ctx.restore();

  pageArea.style.width = `${outW}px`;
  pageArea.style.height = `${outH}px`;
  renderTexts();
}

function addText() {
  const value = textInput.value.trim();
  if (!value) return;
  texts.push({
    id: crypto.randomUUID(),
    value,
    x: 40,
    y: 40,
    size: Number(textSize.value)
  });
  textDialog.classList.add('hidden');
  renderTexts();
}

function renderTexts() {
  textLayer.innerHTML = '';
  texts.forEach(item => {
    const el = document.createElement('div');
    el.className = 'text-item';
    el.textContent = item.value;
    el.style.left = `${item.x}px`;
    el.style.top = `${item.y}px`;
    el.style.fontSize = `${item.size}px`;
    el.dataset.id = item.id;

    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('selected');
      drag = { item, startX: e.clientX, startY: e.clientY, x: item.x, y: item.y };
    });
    el.addEventListener('pointermove', e => {
      if (!drag || drag.item !== item) return;
      item.x = Math.max(0, drag.x + e.clientX - drag.startX);
      item.y = Math.max(0, drag.y + e.clientY - drag.startY);
      el.style.left = `${item.x}px`;
      el.style.top = `${item.y}px`;
    });
    el.addEventListener('pointerup', () => {
      drag = null;
      el.classList.remove('selected');
    });
    el.addEventListener('dblclick', () => {
      textInput.value = item.value;
      textSize.value = item.size;
      textDialog.classList.remove('hidden');
      texts = texts.filter(t => t.id !== item.id);
    });

    textLayer.appendChild(el);
  });
}
