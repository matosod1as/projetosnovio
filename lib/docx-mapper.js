const LINKEDIN_HEADER_RE = /^(\d+)\s*[ªº]?\s*[-–—]\s*abordagem\s*:\s*(.*)$/i;
const EMAIL_HEADER_RE = /^(\d+)\s*[ªº]?\s*[-–—]\s*e-?mail\s*:?\s*(.*)$/i;
const SUBJECT_LINE_RE = /^assunto\s*:\s*(.*)$/i;
const BODY_LINE_RE = /^corpo\s*:\s*(.*)$/i;
const WAIT_LINE_RE = /esperar.*?(\d+)\s*dia/i;
const SKIP_PREAMBLE_RE = /^(prospec|linkedin|e-?mail|textos|\d+)$/i;

function normalizeSpaces(s) {
  return s.replace(/[ \t]+/g, ' ').trim();
}

function stripStrayLines(lines) {
  return lines.filter(l => !/^[.\-–—]$/.test(l.trim()));
}

/**
 * Mapeia um .docx de abordagem de LinkedIn no padrão:
 *   "1ª - Abordagem: conexão" / "2ª - Abordagem: contato conectado" /
 *   "3ª - Abordagem: ..." / "4 - Abordagem: ..." / "5 - Abordagem: ... (InMail)"
 * para os 5 campos do formulário. O InMail nesse padrão não tem assunto
 * separado (fica de fora, precisa ser preenchido manualmente).
 */
function mapLinkedinDocx(lines) {
  const sections = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  let current = null;
  let titleGuess = '';

  for (const line of lines) {
    const m = line.match(LINKEDIN_HEADER_RE);
    if (m) {
      const idx = Number(m[1]);
      current = sections[idx] ? idx : null;
      continue;
    }
    if (current) {
      sections[current].push(line);
    } else if (!titleGuess && !SKIP_PREAMBLE_RE.test(line)) {
      titleGuess = line;
    }
  }

  const join = arr => normalizeSpaces(stripStrayLines(arr).join('\n'));
  const fields = {
    invite: join(sections[1]),
    after_connect: join(sections[2]),
    followup_1: join(sections[3]),
    followup_2: join(sections[4]),
    inmail_body: join(sections[5]),
    inmail_subject: '',
  };

  const matchedCount = Object.values(sections).filter(s => s.length > 0).length;

  const nameMatch = `${fields.invite} ${fields.after_connect}`.match(/\bsou\s+(?:a|o)\s+([A-ZÀ-Ýa-zà-ÿ]+)/i);
  const detectedName = nameMatch ? nameMatch[1] : null;

  return { titleGuess, fields, matchedCount, detectedName };
}

/**
 * Substitui, em todos os campos, o nome detectado no texto (ex: "Mayra")
 * pelo primeiro nome informado (ex: nome da conta de LinkedIn usada).
 */
function applyNameSubstitution(fields, detectedName, newFirstName) {
  if (!detectedName || !newFirstName) return fields;
  const re = new RegExp(`\\b${detectedName}\\b`, 'gi');
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = typeof value === 'string' ? value.replace(re, newFirstName) : value;
  }
  return out;
}

/**
 * Mapeia um .docx de abordagem de E-mail no padrão:
 *   "1ª - E-mail: ..." seguido de linhas "Assunto: ..." e "Corpo: ...".
 * Best-effort: se o arquivo não seguir esse padrão, retorna poucos/nenhum campo.
 */
function mapEmailDocx(lines) {
  const emails = {};
  let current = null;
  let mode = null; // 'subject' | 'body'
  let titleGuess = '';

  for (const line of lines) {
    const header = line.match(EMAIL_HEADER_RE);
    if (header) {
      current = Number(header[1]);
      emails[current] = emails[current] || { subject: [], body: [], waitDays: null };
      mode = null;
      continue;
    }
    if (!current) {
      if (!titleGuess && !SKIP_PREAMBLE_RE.test(line)) titleGuess = line;
      continue;
    }
    const subjectMatch = line.match(SUBJECT_LINE_RE);
    const bodyMatch = line.match(BODY_LINE_RE);
    const waitMatch = line.match(WAIT_LINE_RE);
    if (subjectMatch) {
      mode = 'subject';
      if (subjectMatch[1]) emails[current].subject.push(subjectMatch[1]);
      continue;
    }
    if (bodyMatch) {
      mode = 'body';
      if (bodyMatch[1]) emails[current].body.push(bodyMatch[1]);
      continue;
    }
    if (waitMatch) {
      emails[current].waitDays = Number(waitMatch[1]);
      continue;
    }
    if (mode === 'subject') emails[current].subject.push(line);
    else if (mode === 'body') emails[current].body.push(line);
  }

  const join = arr => normalizeSpaces(arr.join('\n'));
  const list = Object.keys(emails)
    .map(Number)
    .sort((a, b) => a - b)
    .map(idx => ({
      step: idx,
      subject: join(emails[idx].subject),
      body: join(emails[idx].body),
      waitDays: emails[idx].waitDays,
    }))
    .filter(e => e.subject || e.body);

  return { titleGuess, emails: list, matchedCount: list.length };
}

module.exports = { mapLinkedinDocx, mapEmailDocx, applyNameSubstitution };
