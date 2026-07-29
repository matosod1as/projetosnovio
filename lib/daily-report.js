function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * Constrói o CSV diário no formato do CRM: data,servico,leads_prospected,leads_approached,leads_qualified
 *
 * @param {Array} activityEvents - eventos de /recipients-activity (LinkedIn: send_invite/connected/send_message/in_mail/replied; Email: sent/open/bounce)
 * @param {Array} replyEvents - respostas reais de /replies (só para e-mail; já filtradas por data se necessário)
 * @param {string} servico - "linkedin" ou "email"
 * @param {Object} qualifiedByDate - { 'YYYY-MM-DD': count } contagem manual de oportunidades comerciais
 */
function buildDailyReportCsv(activityEvents, replyEvents, servico, qualifiedByDate = {}) {
  const perDay = {};

  activityEvents.forEach(e => {
    const day = (e.event_time || '').slice(0, 10);
    if (!day) return;
    if (!perDay[day]) perDay[day] = { prospected: 0, approached: 0 };
    if (servico === 'linkedin') {
      if (e.event_type === 'send_invite') perDay[day].prospected++;
      if (e.event_type === 'replied') perDay[day].approached++;
    } else {
      if (e.event_type === 'sent') perDay[day].prospected++;
    }
  });

  if (servico !== 'linkedin') {
    (replyEvents || []).forEach(r => {
      const date = r.visited_at && r.visited_at.date;
      if (!date) return;
      const day = date.slice(0, 10);
      if (!perDay[day]) perDay[day] = { prospected: 0, approached: 0 };
      perDay[day].approached++;
    });
  }

  Object.keys(qualifiedByDate).forEach(day => {
    if (!perDay[day]) perDay[day] = { prospected: 0, approached: 0 };
  });

  const days = Object.keys(perDay).sort();
  const lines = ['data,servico,leads_prospected,leads_approached,leads_qualified'];
  days.forEach(day => {
    const qualified = qualifiedByDate[day] || 0;
    lines.push(
      [day, servico, perDay[day].prospected, perDay[day].approached, qualified].map(csvEscape).join(',')
    );
  });
  return lines.join('\n');
}

/**
 * CSV bruto (um evento por linha) — igual ao extract_all_campaigns.js original.
 */
function buildRawEventsCsv(activityEvents, replyEvents) {
  function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const header = [
    'data_hora', 'tipo_evento', 'conta_remetente', 'nome_destinatario', 'email_destinatario',
    'empresa', 'cargo', 'pais', 'localizacao', 'assunto_ou_trecho',
  ];

  let rows = activityEvents.map(e => ({
    data_hora: e.event_time,
    tipo_evento: e.event_type,
    conta_remetente: e.sender_email || '',
    nome_destinatario: e.recipient_name || '',
    email_destinatario: e.recipient_email || '',
    empresa: e.company || '',
    cargo: e.job_position || '',
    pais: e.country || '',
    localizacao: e.location || '',
    assunto_ou_trecho: stripHtml(e.email_subject).slice(0, 300),
  }));

  (replyEvents || []).forEach(r => {
    rows.push({
      data_hora: r.visited_at ? r.visited_at.date : '',
      tipo_evento: 'reply',
      conta_remetente: '',
      nome_destinatario: r.prospect_name || '',
      email_destinatario: r.prospect_email || '',
      empresa: '',
      cargo: '',
      pais: '',
      localizacao: '',
      assunto_ou_trecho: stripHtml(r.emails && r.emails[0] && r.emails[0].email_body).slice(0, 300),
    });
  });

  rows.sort((a, b) => new Date(a.data_hora) - new Date(b.data_hora));

  const lines = [header.join(',')];
  rows.forEach(r => lines.push(header.map(h => csvEscape(r[h])).join(',')));
  return '﻿' + lines.join('\n');
}

module.exports = { buildDailyReportCsv, buildRawEventsCsv };
