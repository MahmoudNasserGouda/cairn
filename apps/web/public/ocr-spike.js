/** Harness for the OCR sandbox spike (ADR-0028). Renders what the frame reports. */
window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'ocr-spike-result') return;
  const list = document.getElementById('results');
  list.innerHTML = '';
  for (const result of event.data.results) {
    const li = document.createElement('li');
    li.className = result.ok ? 'ok' : 'no';
    li.textContent = `${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.detail}`;
    list.appendChild(li);
  }
  window.__spike = event.data.results;
});
