function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, '').trim();
}

function wrapP(text) {
  return (text || '')
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `<p>${l}</p>`)
    .join('');
}

function buildLinkedinSequence(spec) {
  const messages = spec.messages || {};
  const requiredFields = [
    ['invite', '1. convite de conexão'],
    ['after_connect', '2. mensagem após conectar'],
    ['followup_1', '3. mensagem de follow-up 1'],
    ['followup_2', '4. mensagem de follow-up 2'],
    ['inmail_subject', '5. assunto do InMail'],
    ['inmail_body', '5. corpo do InMail'],
  ];
  const missing = requiredFields.filter(([key]) => !stripHtml(messages[key] || '')).map(([, label]) => label);
  if (missing.length) {
    throw new Error(`Preencha os campos obrigatórios da campanha: ${missing.join(', ')}.`);
  }

  const inviteHtml = wrapP(spec.messages.invite);
  const inviteLen = stripHtml(inviteHtml).length;
  if (inviteLen > 200) {
    throw new Error(
      `A mensagem de convite de conexão tem ${inviteLen} caracteres (limite da API: 200). Encurte o texto.`
    );
  }

  const connWait = spec.connection_wait_days ?? 7;
  const delay1 = spec.delay_1_days ?? 4;
  const delay2 = spec.delay_2_days ?? 8;

  return {
    entry: 'invite',
    steps: [
      { _ref: 'invite', type: 'linkedin', action: 'invite', body: inviteHtml, next: 'connMark1' },
      { _ref: 'connMark1', type: 'linkedin', action: 'connected_on_linkedin', next: 'trigConn1' },
      {
        _ref: 'trigConn1',
        type: 'trigger',
        action: 'connected_on_linkedin',
        yes: 'msgAfterConnect',
        no: 'inmail',
        waiting_type: 'days',
        waiting_val: connWait,
      },
      { _ref: 'msgAfterConnect', type: 'linkedin', action: 'message', body: wrapP(spec.messages.after_connect), next: 'delay1' },
      { _ref: 'delay1', type: 'delay', waiting_type: 'days', waiting_val: delay1, next: 'msgFollowup1' },
      { _ref: 'msgFollowup1', type: 'linkedin', action: 'message', body: wrapP(spec.messages.followup_1), next: 'delay2' },
      { _ref: 'delay2', type: 'delay', waiting_type: 'days', waiting_val: delay2, next: 'msgFollowup2' },
      { _ref: 'msgFollowup2', type: 'linkedin', action: 'message', body: wrapP(spec.messages.followup_2) },
      {
        _ref: 'inmail',
        type: 'linkedin',
        action: 'in_mail',
        subject: spec.messages.inmail_subject,
        body: wrapP(spec.messages.inmail_body),
        next: 'trigInmail',
      },
      {
        _ref: 'trigInmail',
        type: 'trigger',
        action: 'linkedin_in_mail_sent',
        yes: 'connMark2',
        no: null,
        waiting_type: 'days',
        waiting_val: 0,
      },
      { _ref: 'connMark2', type: 'linkedin', action: 'connected_on_linkedin', next: 'trigConn2' },
      {
        _ref: 'trigConn2',
        type: 'trigger',
        action: 'connected_on_linkedin',
        yes: 'delay1',
        no: null,
        waiting_type: 'days',
        waiting_val: connWait,
      },
    ],
  };
}

module.exports = { buildLinkedinSequence, wrapP, stripHtml };
