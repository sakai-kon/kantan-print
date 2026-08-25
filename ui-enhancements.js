const textInput = document.querySelector('#textInput');
const textSize = document.querySelector('#textSize');
const textColor = document.querySelector('#textColor');
const boldTextButton = document.querySelector('#boldTextButton');
const verticalTextButton = document.querySelector('#verticalTextButton');
const textPreview = document.querySelector('#textPreview');
const helpDialog = document.querySelector('#helpDialog');
const helpButton = document.querySelector('#helpButton');
const startHelpButton = document.querySelector('#startHelpButton');
const closeHelpButton = document.querySelector('#closeHelpButton');

function updateTextPreview() {
  if (!textPreview) return;
  const value = textInput?.value || '入力した文字がここに表示されます';
  textPreview.textContent = value;
  textPreview.style.fontSize = `${Number(textSize?.value || 28)}px`;
  textPreview.style.color = textColor?.value || '#111111';
  textPreview.style.fontWeight = boldTextButton?.classList.contains('active') ? '800' : '600';
  textPreview.style.writingMode = verticalTextButton?.classList.contains('active') ? 'vertical-rl' : 'horizontal-tb';
}

[textInput, textSize, textColor].forEach((element) => element?.addEventListener('input', updateTextPreview));
boldTextButton?.addEventListener('click', () => requestAnimationFrame(updateTextPreview));
verticalTextButton?.addEventListener('click', () => requestAnimationFrame(updateTextPreview));

function openHelp() {
  helpDialog?.classList.remove('hidden');
}
function closeHelp() {
  helpDialog?.classList.add('hidden');
}
helpButton?.addEventListener('click', openHelp);
startHelpButton?.addEventListener('click', openHelp);
closeHelpButton?.addEventListener('click', closeHelp);
helpDialog?.addEventListener('click', (event) => {
  if (event.target === helpDialog) closeHelp();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && helpDialog && !helpDialog.classList.contains('hidden')) closeHelp();
});

const textDialog = document.querySelector('#textDialog');
textDialog?.addEventListener('transitionend', updateTextPreview);

// script.js opens the dialog after this file has loaded, so use a small observer to
// refresh the preview whenever the dialog becomes visible.
if (textDialog) {
  const observer = new MutationObserver(() => {
    if (!textDialog.classList.contains('hidden')) updateTextPreview();
  });
  observer.observe(textDialog, { attributes: true, attributeFilter: ['class'] });
}
