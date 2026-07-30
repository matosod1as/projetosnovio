require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const archiver = require('archiver');

const { SnovClient } = require('./lib/snov-api');
const { buildLinkedinSequence } = require('./lib/linkedin-sequence');
const { buildDailyReportCsv, buildRawEventsCsv, stripHtml } = require('./lib/daily-report');
const { replyKey, isMarked, mark: markReplied, usingRedis } = require('./lib/marked-replies');
const { extractDocxLines } = require('./lib/docx-parser');
// Automação de navegador (Playwright) foi desativada por instabilidade com a
// proteção anti-bot do Snov.io — veja lib/browser-automation.js se quiser reativar.

const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!APP_PASSWORD) {
  console.error('ERRO: defina APP_PASSWORD no arquivo .env antes de iniciar o servidor.');
  process.exit(1);
}
if (!process.env.SNOV_CLIENT_ID || !process.env.SNOV_CLIENT_SECRET) {
  console.error('ERRO: defina SNOV_CLIENT_ID e SNOV_CLIENT_SECRET no arquivo .env.');
  process.exit(1);
}

const snov = new SnovClient(process.env.SNOV_CLIENT_ID, process.env.SNOV_CLIENT_SECRET);

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 12, sameSite: 'lax' },
  })
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ---------- Auth ----------
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Não autenticado' });
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === APP_PASSWORD) {
    req.session.authed = true;
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, error: 'Senha incorreta' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---------- Jobs (operações longas: automação de e-mail, exportação completa) ----------
const jobs = new Map();
function createJob() {
  const id = crypto.randomBytes(8).toString('hex');
  jobs.set(id, { status: 'running', log: [], result: null, error: null, createdAt: Date.now() });
  return id;
}
function jobLog(id, msg) {
  const job = jobs.get(id);
  if (job) job.log.push({ t: Date.now(), msg });
}
function jobDone(id, result) {
  const job = jobs.get(id);
  if (job) { job.status = 'done'; job.result = result; }
}
function jobError(id, err) {
  const job = jobs.get(id);
  if (job) { job.status = 'error'; job.error = String(err && err.message ? err.message : err); }
}

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json(job);
});

// ---------- Meta (dropdowns) ----------
app.get('/api/meta', requireAuth, async (req, res) => {
  try {
    const [linkedinAccounts, lists, activeCampaigns] = await Promise.all([
      snov.getLinkedinAccounts(),
      snov.getUserLists(),
      snov.getActiveCampaigns(),
    ]);
    res.json({
      linkedinAccounts: linkedinAccounts.map(a => ({ id: a.id, name: a.name, username: a.username })),
      lists: lists.map(l => ({ id: l.id, name: l.name, contacts: l.contacts })),
      activeCampaigns: activeCampaigns.map(c => ({
        id: c.id,
        name: c.campaign,
        type: /linkedin/i.test(c.campaign) ? 'linkedin' : 'email',
        startedAt: c.started_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Docx parsing helper (abordagens LinkedIn/E-mail) ----------
app.post('/api/docx-parse', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });
    const lines = await extractDocxLines(req.file.buffer);
    res.json({ lines });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Criar campanha LinkedIn ----------
app.post('/api/campaigns/linkedin/create', requireAuth, async (req, res) => {
  try {
    const spec = req.body;
    let listId = spec.list_id;
    if (!listId && spec.list_name) {
      listId = await snov.createList(spec.list_name);
    }
    if (!listId) return res.status(400).json({ error: 'Informe list_id ou list_name' });

    const sequence = buildLinkedinSequence(spec);
    const payload = {
      title: spec.title,
      priority: spec.priority || 'medium',
      linkedin_accounts: [spec.linkedin_account_id],
      recipients: { list_id: listId },
      complete_campaign_after_last_step: spec.complete_campaign_after_last_step ?? false,
      archive_in_months: spec.archive_in_months ?? 3,
      sequence,
    };
    const data = await snov.createCampaign(payload);
    res.json({
      id: data.id,
      status: data.status,
      link: `https://app.snov.io/campaigns/${data.id}/recipients`,
      listId,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Criar campanha E-mail (cria estrutura via API + preenche conteúdo via automação) ----------
app.post('/api/campaigns/email/create', requireAuth, async (req, res) => {
  const spec = req.body;
  const jobId = createJob();
  res.json({ jobId });

  (async () => {
    try {
      jobLog(jobId, 'Preparando lista de destinatários...');
      let listId = spec.list_id;
      if (!listId && spec.list_name) {
        listId = await snov.createList(spec.list_name);
        jobLog(jobId, `Lista criada: ${listId}`);
      }
      if (!listId) throw new Error('Informe list_id ou list_name');

      const steps = [];
      const refs = spec.emails.map((_, i) => `email${i + 1}`);
      spec.emails.forEach((email, i) => {
        const step = {
          _ref: refs[i],
          type: 'email',
          content_slots: 1,
          content: [{ subject: email.subject, body: '<p></p>', plain_text: false, usage: 'active' }],
        };
        if (i < spec.emails.length - 1) {
          const delayRef = `delay${i + 1}`;
          step.next = delayRef;
          steps.push(step);
          steps.push({ _ref: delayRef, type: 'delay', waiting_type: 'days', waiting_val: email.wait_days_after ?? 4, next: refs[i + 1] });
        } else {
          steps.push(step);
        }
      });

      jobLog(jobId, 'Criando estrutura da campanha via API...');
      const payload = {
        title: spec.title,
        priority: spec.priority || 'medium',
        email_accounts: [spec.email_account_id],
        recipients: { list_id: listId },
        complete_campaign_after_last_step: spec.complete_campaign_after_last_step ?? false,
        archive_in_months: spec.archive_in_months ?? 3,
        provider_matching: false,
        tracking: { open: true, link_click: true },
        sending_settings: { sending_priority: 'follow_up' },
        sequence: { entry: refs[0], steps },
      };
      const data = await snov.createCampaign(payload);
      jobLog(jobId, `Campanha criada (id ${data.id}).`);
      jobLog(
        jobId,
        'A API do Snov.io não salva o texto (assunto/corpo) dos e-mails — cole cada um deles na etapa correspondente pelo link abaixo.'
      );

      jobDone(jobId, {
        id: data.id,
        status: data.status,
        link: `https://app.snov.io/campaigns/${data.id}/recipients`,
        sequenceLink: `https://app.snov.io/campaigns/new/create/${data.id}/sequence`,
        listId,
        emails: spec.emails.map((e, i) => ({ step: i + 1, subject: e.subject, body: e.body })),
      });
    } catch (e) {
      jobError(jobId, e);
    }
  })();
});

// ---------- Relatório diário (CSV) ----------
app.post('/api/reports/daily', requireAuth, async (req, res) => {
  try {
    const { campaignId, servico, from, to, qualifiedByDate, raw } = req.body;
    const activity = await snov.getAllActivity(campaignId, from, to);
    let replies = [];
    if (servico !== 'linkedin') {
      const allReplies = await snov.getAllReplies(campaignId);
      const fromDate = new Date(from + 'T00:00:00');
      const toDate = new Date(to + 'T23:59:59');
      replies = allReplies.filter(r => {
        if (!r.visited_at || !r.visited_at.date) return false;
        const d = new Date(r.visited_at.date.replace(' ', 'T') + 'Z');
        return d >= fromDate && d <= toDate;
      });
    }
    const csv = raw
      ? buildRawEventsCsv(activity, replies)
      : buildDailyReportCsv(activity, replies, servico, qualifiedByDate || {});
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="relatorio_${campaignId}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Verificar respostas de uma campanha num período ----------
app.post('/api/replies/check', requireAuth, async (req, res) => {
  try {
    const { campaignId, servico } = req.body || {};
    const from = req.body?.from || req.body?.date;
    const to = req.body?.to || req.body?.date;
    if (!campaignId || !from || !to) return res.status(400).json({ error: 'Informe campaignId, from e to' });

    let replies = [];
    if (servico === 'linkedin') {
      const activity = await snov.getAllActivity(campaignId, from, to);
      replies = activity
        .filter(e => e.event_type === 'replied')
        .map(e => ({
          name: e.recipient_name || null,
          email: e.recipient_email || null,
          time: e.event_time || null,
          snippet: stripHtml(e.email_subject).slice(0, 200),
        }));
    } else {
      const allReplies = await snov.getAllReplies(campaignId);
      const fromDate = new Date(from + 'T00:00:00');
      const toDate = new Date(to + 'T23:59:59');
      replies = allReplies
        .filter(r => {
          if (!r.visited_at || !r.visited_at.date) return false;
          const d = new Date(r.visited_at.date.replace(' ', 'T') + 'Z');
          return d >= fromDate && d <= toDate;
        })
        .map(r => ({
          name: r.prospect_name || null,
          email: r.prospect_email || null,
          time: r.visited_at.date,
          snippet: stripHtml(r.emails && r.emails[0] && r.emails[0].email_body).slice(0, 200),
        }));
    }

    replies.sort((a, b) => new Date(a.time) - new Date(b.time));
    replies = replies.map(r => ({ ...r, key: replyKey(campaignId, servico, r) }));
    const marks = await Promise.all(replies.map(r => isMarked(r.key)));
    replies = replies.filter((r, i) => !marks[i]);

    res.json({ found: replies.length > 0, count: replies.length, replies });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/replies/status', requireAuth, (req, res) => {
  res.json({ persistence: usingRedis ? 'upstash-redis' : 'arquivo-local' });
});

app.post('/api/replies/mark', requireAuth, async (req, res) => {
  try {
    const { key } = req.body || {};
    if (!key) return res.status(400).json({ error: 'Informe key' });
    await markReplied(key);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Exportar todas as campanhas ativas (ZIP) ----------
app.post('/api/reports/export-all', requireAuth, async (req, res) => {
  const { from, to, excludeIds = [], raw } = req.body || {};
  const jobId = createJob();
  res.json({ jobId });

  (async () => {
    try {
      jobLog(jobId, 'Buscando campanhas ativas...');
      const active = await snov.getActiveCampaigns();
      const filtered = active.filter(c => !excludeIds.includes(c.id));
      jobLog(jobId, `${filtered.length} campanhas a exportar.`);

      const tmpDir = path.join(__dirname, 'tmp', jobId);
      fs.mkdirSync(tmpDir, { recursive: true });

      for (let i = 0; i < filtered.length; i++) {
        const camp = filtered[i];
        const isLinkedin = /linkedin/i.test(camp.campaign);
        const servico = isLinkedin ? 'linkedin' : 'email';
        const startDate = from || new Date(camp.started_at * 1000).toISOString().slice(0, 10);
        const endDate = to || new Date().toISOString().slice(0, 10);
        jobLog(jobId, `[${i + 1}/${filtered.length}] ${camp.campaign}...`);
        try {
          const activity = await snov.getAllActivity(camp.id, startDate, endDate);
          let replies = [];
          if (!isLinkedin) replies = await snov.getAllReplies(camp.id);
          const csv = raw ? buildRawEventsCsv(activity, replies) : buildDailyReportCsv(activity, replies, servico);
          const safeName = camp.campaign.replace(/[\\/:*?"<>|]/g, '_').trim();
          fs.writeFileSync(path.join(tmpDir, `${safeName} [${camp.id}].csv`), '﻿' + csv, 'utf8');
        } catch (e) {
          jobLog(jobId, `  ERRO em ${camp.campaign}: ${e.message}`);
        }
      }

      const zipPath = path.join(__dirname, 'tmp', `${jobId}.zip`);
      await new Promise((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
        output.on('close', resolve);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(tmpDir, false);
        archive.finalize();
      });

      jobLog(jobId, 'ZIP pronto.');
      jobDone(jobId, { downloadPath: `/api/reports/download/${jobId}` });
    } catch (e) {
      jobError(jobId, e);
    }
  })();
});

app.get('/api/reports/download/:jobId', requireAuth, (req, res) => {
  const zipPath = path.join(__dirname, 'tmp', `${req.params.jobId}.zip`);
  if (!fs.existsSync(zipPath)) return res.status(404).send('Arquivo não encontrado');
  res.download(zipPath, 'campanhas_ativas.zip');
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Snov Web App rodando em http://localhost:${PORT}`);
});
