// AuStudio Playwright Frontend Renderers

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clearStepsTable(stepsTbody) {
  if (stepsTbody) stepsTbody.innerHTML = '';
}

function renderSteps(steps, stepsTbody) {
  clearStepsTable(stepsTbody);
  if (!steps || steps.length === 0) {
    if (stepsTbody) {
      stepsTbody.innerHTML = `
        <tr class="empty-row">
          <td colspan="5" class="empty-cell">
            <div class="empty-prompt">
              <div class="empty-title">Belum ada langkah yang direkam</div>
            </div>
          </td>
        </tr>`;
    }
    return;
  }
  steps.forEach(s => appendStepToTable(s, stepsTbody));
}

function appendStepToTable(step, stepsTbody) {
  if (!stepsTbody) return;
  const emptyRow = stepsTbody.querySelector('.empty-row');
  if (emptyRow) emptyRow.remove();

  const tr = document.createElement('tr');
  tr.id = `step-row-${step.id}`;

  const timeStr = new Date(step.timestamp || Date.now()).toLocaleTimeString();
  const actionBadge = `<span class="badge-action ${step.type}">${step.type}</span>`;
  const selectorDisplay = step.selector
    ? `<code class="selector-code" title="${escapeHtml(step.selector)}">${escapeHtml(step.selector)}</code>`
    : (step.url ? `<code class="selector-code" title="${escapeHtml(step.url)}">${escapeHtml(step.url)}</code>` : '-');

  let valueDisplay = '-';
  if (step.value !== undefined && step.value !== '') {
    valueDisplay = `<span class="value-preview">"${escapeHtml(step.value)}"</span>`;
  } else if (step.key) {
    valueDisplay = `<span class="value-preview">[Key: ${escapeHtml(step.key)}]</span>`;
  } else if (step.text) {
    valueDisplay = `<span class="text-sub">"${escapeHtml(step.text)}"</span>`;
  }

  tr.innerHTML = `
    <td class="step-num">#${step.id}</td>
    <td>${actionBadge}</td>
    <td>${selectorDisplay}</td>
    <td>${valueDisplay}</td>
    <td class="time-stamp">${timeStr}</td>
  `;

  stepsTbody.appendChild(tr);
  tr.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function renderRecordingsList(recordings, container, onSelect, onReplay) {
  if (!container) return;
  if (!recordings || recordings.length === 0) {
    container.innerHTML = `<div class="empty-history">Belum ada riwayat rekaman tersimpan.</div>`;
    return;
  }

  container.innerHTML = recordings.map(rec => `
    <div class="history-item" data-session="${escapeHtml(rec.name)}">
      <div class="history-item-top">
        <span class="history-name" title="${escapeHtml(rec.name)}">${escapeHtml(rec.name)}</span>
        <span class="history-steps-badge">${rec.stepCount} langkah</span>
      </div>
      <div class="history-item-bottom">
        <span class="history-time">${formatDate(rec.updatedAt)}</span>
        <div class="history-actions">
          <button class="btn-icon-mini btn-view-rec" title="Lihat Sesi" data-session="${escapeHtml(rec.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <button class="btn-icon-mini btn-replay-rec" title="Putar Ulang (Replay)" data-session="${escapeHtml(rec.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.btn-view-rec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const session = btn.getAttribute('data-session');
      if (typeof onSelect === 'function') onSelect(session);
    });
  });

  container.querySelectorAll('.btn-replay-rec').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const session = btn.getAttribute('data-session');
      if (typeof onReplay === 'function') onReplay(session);
    });
  });

  container.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', () => {
      const session = item.getAttribute('data-session');
      if (typeof onSelect === 'function') onSelect(session);
    });
  });
}

function showReplayBox(box, nameEl, infoEl, fillEl, name, total) {
  if (box) box.style.display = 'block';
  if (nameEl) nameEl.innerText = name;
  if (infoEl) infoEl.innerText = `0 / ${total}`;
  if (fillEl) fillEl.style.width = '0%';
}

function updateReplayStepUi(fillEl, infoEl, data) {
  const pct = Math.round((data.currentStep / data.totalSteps) * 100);
  if (fillEl) fillEl.style.width = `${pct}%`;
  if (infoEl) infoEl.innerText = `${data.currentStep} / ${data.totalSteps} (${data.step.type})`;
}

function finishReplayUi(fillEl, infoEl, box, totalSteps) {
  if (fillEl) fillEl.style.width = '100%';
  if (infoEl) infoEl.innerText = `Selesai (${totalSteps} langkah)`;
  setTimeout(() => { if (box) box.style.display = 'none'; }, 3000);
}
