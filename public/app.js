const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Sessão expirada, faça login novamente.');
  }
  return res;
}

// ---------- Login ----------
function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app-screen').classList.add('hidden');
}
function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app-screen').classList.remove('hidden');
  loadMeta();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  const password = $('#login-password').value;
  btn.disabled = true;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  btn.disabled = false;
  if (data.success) {
    $('#login-error').textContent = '';
    showApp();
  } else {
    $('#login-error').textContent = data.error || 'Senha incorreta';
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

(async () => {
  const res = await fetch('/api/session');
  const data = await res.json();
  if (data.authed) showApp();
  else showLogin();
})();

// ---------- Tabs ----------
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab-panel').forEach(p => p.classList.add('hidden'));
    $(`#tab-${btn.dataset.tab}`).classList.remove('hidden');
  });
});

// ---------- Meta ----------
let META = { linkedinAccounts: [], lists: [], activeCampaigns: [] };

async function loadMeta() {
  const res = await api('/api/meta');
  META = await res.json();

  const liAccountSel = $('#li-account');
  liAccountSel.innerHTML = META.linkedinAccounts
    .map(a => `<option value="${a.id}">${a.name} (${a.username})</option>`)
    .join('');

  const liListSel = $('#li-list-existing');
  liListSel.innerHTML = META.lists.map(l => `<option value="${l.id}">${l.name} (${l.contacts})</option>`).join('');

  const emListSel = $('#em-list-existing');
  emListSel.innerHTML = META.lists.map(l => `<option value="${l.id}">${l.name} (${l.contacts})</option>`).join('');

  const rpCampaignSel = $('#rp-campaign');
  rpCampaignSel.innerHTML = META.activeCampaigns
    .map(c => `<option value="${c.id}" data-type="${c.type}">${c.name} (${c.type})</option>`)
    .join('');

  const exExcludeList = $('#ex-exclude-list');
  exExcludeList.innerHTML = META.activeCampaigns
    .map(
      c => `<div class="exclude-row"><label><input type="checkbox" value="${c.id}" class="ex-exclude-cb"/> ${c.name}</label></div>`
    )
    .join('');

  const rcCampaignSel = $('#rc-campaign');
  rcCampaignSel.innerHTML = META.activeCampaigns
    .map(c => `<option value="${c.id}" data-type="${c.type}">${c.name} (${c.type})</option>`)
    .join('');
}

function setupListModeToggle(prefix) {
  const radios = $$(`input[name="${prefix}-list-mode"]`);
  const nameField = $(`#${prefix}-list-name`);
  const existingField = $(`#${prefix}-list-existing`);
  radios.forEach(r =>
    r.addEventListener('change', () => {
      if (r.value === 'new' && r.checked) {
        nameField.classList.remove('hidden');
        existingField.classList.add('hidden');
      } else if (r.value === 'existing' && r.checked) {
        nameField.classList.add('hidden');
        existingField.classList.remove('hidden');
      }
    })
  );
}
setupListModeToggle('li');
setupListModeToggle('em');

// ---------- Docx parsing helper ----------
async function handleDocxUpload(inputEl, previewEl) {
  inputEl.addEventListener('change', async () => {
    const file = inputEl.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/docx-parse', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.lines) {
      previewEl.classList.remove('hidden');
      previewEl.textContent = data.lines.join('\n');
      previewEl.dataset.lines = JSON.stringify(data.lines);
    }
  });
}
handleDocxUpload($('#li-docx'), $('#li-docx-preview'));
handleDocxUpload($('#em-docx'), $('#em-docx-preview'));

// ---------- LinkedIn char counter ----------
$('#li-msg-invite').addEventListener('input', () => {
  const len = $('#li-msg-invite').value.length;
  const countEl = $('#li-invite-count');
  countEl.textContent = `${len} / 200`;
  countEl.style.color = len > 200 ? 'var(--error)' : 'var(--muted)';
});

// ---------- Create LinkedIn campaign ----------
$('#li-create-btn').addEventListener('click', async () => {
  const btn = $('#li-create-btn');
  const resultEl = $('#li-result');
  resultEl.classList.add('hidden');

  const listMode = $$('input[name="li-list-mode"]').find(r => r.checked).value;
  const spec = {
    title: $('#li-title').value.trim(),
    linkedin_account_id: Number($('#li-account').value),
    connection_wait_days: Number($('#li-wait-conn').value),
    delay_1_days: Number($('#li-delay1').value),
    delay_2_days: Number($('#li-delay2').value),
    messages: {
      invite: $('#li-msg-invite').value.trim(),
      after_connect: $('#li-msg-connect').value.trim(),
      followup_1: $('#li-msg-f1').value.trim(),
      followup_2: $('#li-msg-f2').value.trim(),
      inmail_subject: $('#li-inmail-subject').value.trim(),
      inmail_body: $('#li-inmail-body').value.trim(),
    },
  };
  if (listMode === 'new') spec.list_name = $('#li-list-name').value.trim();
  else spec.list_id = Number($('#li-list-existing').value);

  if (!spec.title || !spec.linkedin_account_id || !spec.messages.invite) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="error">Preencha ao menos título, conta e mensagem de convite.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Criando...';
  try {
    const res = await api('/api/campaigns/linkedin/create', { method: 'POST', body: JSON.stringify(spec) });
    const data = await res.json();
    resultEl.classList.remove('hidden');
    if (data.error) {
      resultEl.innerHTML = `<span class="error">${data.error}</span>`;
    } else {
      resultEl.innerHTML = `<span class="success-text">Campanha criada!</span> ID ${data.id} — status "${data.status}" (rascunho).<br><a href="${data.link}" target="_blank">${data.link}</a>`;
      loadMeta();
    }
  } catch (e) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<span class="error">${e.message}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar campanha';
  }
});

// ---------- Email campaign: dynamic email blocks ----------
let emailBlockCount = 0;
function addEmailBlock(subject = '', body = '', waitDays = 4) {
  emailBlockCount++;
  const id = emailBlockCount;
  const container = $('#em-emails-container');
  const div = document.createElement('div');
  div.className = 'email-block';
  div.dataset.id = id;
  div.innerHTML = `
    <button type="button" class="remove-btn" data-remove="${id}">remover</button>
    <div class="field"><label>Assunto (e-mail ${id})</label><input type="text" class="em-subject" value="${escapeHtml(subject)}" /></div>
    <div class="field"><label>Corpo</label><textarea class="em-body" rows="5">${escapeHtml(body)}</textarea></div>
    <div class="field" style="max-width:200px"><label>Esperar depois deste e-mail (dias)</label><input type="number" class="em-wait" value="${waitDays}" /></div>
  `;
  container.appendChild(div);
  div.querySelector('[data-remove]').addEventListener('click', () => div.remove());
}
function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
$('#em-add-email').addEventListener('click', () => addEmailBlock());
addEmailBlock();
addEmailBlock();
addEmailBlock();

// ---------- Create Email campaign ----------
$('#em-create-btn').addEventListener('click', async () => {
  const btn = $('#em-create-btn');
  const resultEl = $('#em-result');
  const progressEl = $('#em-progress');
  resultEl.classList.add('hidden');
  progressEl.classList.add('hidden');
  progressEl.textContent = '';

  const listMode = $$('input[name="em-list-mode"]').find(r => r.checked).value;
  const emails = $$('.email-block').map(block => ({
    subject: block.querySelector('.em-subject').value.trim(),
    body: block.querySelector('.em-body').value.trim(),
    wait_days_after: Number(block.querySelector('.em-wait').value),
  }));

  const spec = {
    title: $('#em-title').value.trim(),
    email_account_id: Number($('#em-account').value),
    emails,
  };
  if (listMode === 'new') spec.list_name = $('#em-list-name').value.trim();
  else spec.list_id = Number($('#em-list-existing').value);

  if (!spec.title || !spec.email_account_id || emails.length === 0 || emails.some(e => !e.subject || !e.body)) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="error">Preencha título, conta e todos os e-mails (assunto + corpo).</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Criando...';
  progressEl.classList.remove('hidden');
  progressEl.textContent = 'Iniciando...';

  try {
    const res = await api('/api/campaigns/email/create', { method: 'POST', body: JSON.stringify(spec) });
    const { jobId } = await res.json();
    await pollJob(jobId, progressEl, (result, error) => {
      resultEl.classList.remove('hidden');
      if (error) {
        resultEl.innerHTML = `<span class="error">${error}</span>`;
      } else {
        renderEmailCopyPaste(resultEl, result);
        loadMeta();
      }
      btn.disabled = false;
      btn.textContent = 'Criar campanha';
    });
  } catch (e) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<span class="error">${e.message}</span>`;
    btn.disabled = false;
    btn.textContent = 'Criar campanha';
  }
});

function renderEmailCopyPaste(resultEl, result) {
  resultEl.innerHTML = '';
  const header = document.createElement('div');
  header.innerHTML = `<span class="success-text">Campanha criada!</span> ID ${result.id} — status "${result.status}".<br>
    A API do Snov.io não salva o texto dos e-mails — cole cada etapa abaixo diretamente na campanha:<br>
    <a href="${result.sequenceLink}" target="_blank">${result.sequenceLink}</a><br><br>`;
  resultEl.appendChild(header);

  result.emails.forEach(e => {
    const block = document.createElement('div');
    block.className = 'email-block';
    block.innerHTML = `
      <strong>Etapa ${e.step}</strong>
      <div class="field">
        <label>Assunto</label>
        <div style="display:flex; gap:8px;">
          <input type="text" readonly value="${escapeHtml(e.subject)}" style="flex:1" />
          <button type="button" class="secondary-btn copy-btn">Copiar</button>
        </div>
      </div>
      <div class="field">
        <label>Corpo</label>
        <textarea readonly rows="5">${escapeHtml(e.body)}</textarea>
        <button type="button" class="secondary-btn copy-btn" style="margin-top:6px">Copiar corpo</button>
      </div>
    `;
    const [subjectInput, bodyTextarea] = [block.querySelector('input'), block.querySelector('textarea')];
    const [copySubjectBtn, copyBodyBtn] = block.querySelectorAll('.copy-btn');
    copySubjectBtn.addEventListener('click', () => copyToClipboard(subjectInput.value, copySubjectBtn));
    copyBodyBtn.addEventListener('click', () => copyToClipboard(bodyTextarea.value, copyBodyBtn));
    resultEl.appendChild(block);
  });
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const original = btn.textContent;
    btn.textContent = 'Copiado!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('copied');
    }, 1500);
  });
}

async function pollJob(jobId, progressEl, onFinish) {
  while (true) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await api(`/api/jobs/${jobId}`);
    const job = await res.json();
    progressEl.textContent = job.log.map(l => l.msg).join('\n');
    progressEl.scrollTop = progressEl.scrollHeight;
    if (job.status === 'done') return onFinish(job.result, null);
    if (job.status === 'error') return onFinish(null, job.error);
  }
}

// ---------- Daily report ----------
function addQualifiedRow() {
  const container = $('#rp-qualified-rows');
  const div = document.createElement('div');
  div.className = 'qualified-row';
  div.innerHTML = `<input type="date" class="q-date" /> <input type="number" class="q-count" value="1" min="1" /> <button type="button">remover</button>`;
  container.appendChild(div);
  div.querySelector('button').addEventListener('click', () => div.remove());
}
$('#rp-add-qualified').addEventListener('click', addQualifiedRow);

$('#rp-generate-btn').addEventListener('click', async () => {
  const resultEl = $('#rp-result');
  resultEl.classList.add('hidden');
  const sel = $('#rp-campaign');
  const campaignId = Number(sel.value);
  const servico = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.type : 'email';
  const from = $('#rp-from').value;
  const to = $('#rp-to').value;
  const raw = $('#rp-format').value === 'raw';

  const qualifiedByDate = {};
  $$('.qualified-row').forEach(row => {
    const date = row.querySelector('.q-date').value;
    const count = Number(row.querySelector('.q-count').value);
    if (date) qualifiedByDate[date] = count;
  });

  if (!campaignId || !from || !to) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="error">Selecione a campanha e o período.</span>';
    return;
  }

  try {
    const res = await api('/api/reports/daily', {
      method: 'POST',
      body: JSON.stringify({ campaignId, servico, from, to, qualifiedByDate, raw }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Erro ao gerar relatório');
    }
    const blob = await res.blob();
    downloadBlob(blob, `relatorio_${campaignId}.csv`);
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = '<span class="success-text">CSV baixado.</span>';
  } catch (e) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<span class="error">${e.message}</span>`;
  }
});

// ---------- Export all ----------
$('#ex-run-btn').addEventListener('click', async () => {
  const btn = $('#ex-run-btn');
  const progressEl = $('#ex-progress');
  const resultEl = $('#ex-result');
  resultEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  progressEl.textContent = 'Iniciando...';

  const from = $('#ex-from').value || undefined;
  const to = $('#ex-to').value || undefined;
  const raw = $('#ex-format').value === 'raw';
  const excludeIds = $$('.ex-exclude-cb')
    .filter(cb => cb.checked)
    .map(cb => Number(cb.value));

  btn.disabled = true;
  btn.textContent = 'Extraindo...';

  try {
    const res = await api('/api/reports/export-all', {
      method: 'POST',
      body: JSON.stringify({ from, to, raw, excludeIds }),
    });
    const { jobId } = await res.json();
    await pollJob(jobId, progressEl, (result, error) => {
      resultEl.classList.remove('hidden');
      if (error) {
        resultEl.innerHTML = `<span class="error">${error}</span>`;
      } else {
        resultEl.innerHTML = `<span class="success-text">Pronto!</span> <a href="${result.downloadPath}">Baixar ZIP</a>`;
        window.location.href = result.downloadPath;
      }
      btn.disabled = false;
      btn.textContent = 'Extrair todas e gerar ZIP';
    });
  } catch (e) {
    resultEl.classList.remove('hidden');
    resultEl.innerHTML = `<span class="error">${e.message}</span>`;
    btn.disabled = false;
    btn.textContent = 'Extrair todas e gerar ZIP';
  }
});

// ---------- Verificar respostas ----------
$('#rc-check-btn').addEventListener('click', async () => {
  const btn = $('#rc-check-btn');
  const resultEl = $('#rc-result');
  resultEl.classList.remove('hidden');

  const sel = $('#rc-campaign');
  const campaignId = Number(sel.value);
  const servico = sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.type : 'email';
  const date = $('#rc-date').value;

  if (!campaignId || !date) {
    resultEl.innerHTML = '<span class="error">Selecione a campanha e a data.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verificando...';
  resultEl.innerHTML = 'Buscando respostas...';

  try {
    const res = await api('/api/replies/check', {
      method: 'POST',
      body: JSON.stringify({ campaignId, date, servico }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao verificar respostas');

    if (!data.found) {
      resultEl.innerHTML = `Nenhuma resposta encontrada em <strong>${date}</strong> para essa campanha.`;
    } else {
      const rows = data.replies
        .map(r => {
          const who = escapeHtml(r.name || '(sem nome)') + (r.email ? ` <span class="hint">&lt;${escapeHtml(r.email)}&gt;</span>` : '');
          const snippet = r.snippet ? `<div class="hint" style="margin-top:4px">"${escapeHtml(r.snippet)}"</div>` : '';
          return `<div style="margin-bottom:12px"><strong>${who}</strong>${r.time ? ` — ${escapeHtml(String(r.time))}` : ''}${snippet}</div>`;
        })
        .join('');
      resultEl.innerHTML = `<span class="success-text">${data.count} resposta(s) encontrada(s) em ${date}:</span><br><br>${rows}`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span class="error">${e.message}</span>`;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verificar';
  }
});

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
