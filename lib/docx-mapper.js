const LINKEDIN_HEADER_RE = /^(\d+)\s*[ªº]?\s*[-–—]\s*abordagem\s*:\s*(.*)$/i;
const GENERIC_HEADER_RE = /^(\d+)\s*[ªº]?\s*[-–—]\s*abordagem\b\s*:?\s*(.*)$/i;
const SUBJECT_LINE_RE = /^assunto\s*:\s*(.*)$/i;
const BODY_LABEL_RE = /^corpo(\s+e-?mail)?\s*:\s*(.*)$/i;
const HEADER_WAIT_RE = /(\d+)\s*dias?/i;
const SKIP_PREAMBLE_RE = /^(prospec|linkedin|e-?mail|textos|cad[êe]ncia|\d+)$/i;
const NAME_RE = /\b(?:sou|[ée])\s+(?:a|o)\s+([A-ZÀ-Ýa-zà-ÿ]+)/i;

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

  const nameMatch = `${fields.invite} ${fields.after_connect}`.match(NAME_RE);
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
 *   "1ª - Abordagem (...) - INÍCIO DA CADÊNCIA"
 *   "Assunto: ..."
 *   ["Corpo e-mail:"]
 *   texto do corpo...
 *   "2ª - Abordagem (...) - ENVIAR 4 DIAS APÓS A 1ª"
 *   ...
 * O número de dias de espera fica indicado no cabeçalho da etapa SEGUINTE
 * ("ENVIAR 4 DIAS APÓS A 1ª" descreve a espera depois do 1º e-mail), então
 * o valor é deslocado para o e-mail anterior ao montar o resultado.
 * Best-effort: se o arquivo não seguir esse padrão, retorna poucos/nenhum campo.
 */
function mapEmailDocx(lines) {
  const emails = {};
  let current = null;
  let mode = null; // 'subject' | 'body'
  let titleGuess = '';

  for (const line of lines) {
    const header = line.match(GENERIC_HEADER_RE);
    if (header) {
      current = Number(header[1]);
      const waitMatch = header[2].match(HEADER_WAIT_RE);
      emails[current] = emails[current] || { subject: [], body: [], waitFromHeader: null };
      if (waitMatch) emails[current].waitFromHeader = Number(waitMatch[1]);
      mode = null;
      continue;
    }
    if (!current) {
      if (!titleGuess && !SKIP_PREAMBLE_RE.test(line)) titleGuess = line;
      continue;
    }
    const subjectMatch = line.match(SUBJECT_LINE_RE);
    const bodyLabelMatch = line.match(BODY_LABEL_RE);
    if (subjectMatch) {
      mode = 'subject';
      if (subjectMatch[1]) emails[current].subject.push(subjectMatch[1]);
      continue;
    }
    if (bodyLabelMatch) {
      mode = 'body';
      if (bodyLabelMatch[2]) emails[current].body.push(bodyLabelMatch[2]);
      continue;
    }
    if (mode === 'subject') {
      // Se a etapa não tiver um rótulo "Corpo:", a primeira linha após o
      // assunto já é o começo do corpo do e-mail.
      mode = 'body';
      emails[current].body.push(line);
    } else if (mode === 'body') {
      emails[current].body.push(line);
    }
  }

  const join = arr => normalizeSpaces(stripStrayLines(arr).join('\n'));
  const indexes = Object.keys(emails).map(Number).sort((a, b) => a - b);
  const list = indexes
    .map((idx, i) => {
      const nextIdx = indexes[i + 1];
      const waitDays = nextIdx !== undefined ? emails[nextIdx].waitFromHeader : null;
      return {
        step: idx,
        subject: join(emails[idx].subject),
        body: join(emails[idx].body),
        waitDays: waitDays ?? 4,
      };
    })
    .filter(e => e.subject || e.body);

  const allText = list.map(e => `${e.subject} ${e.body}`).join(' ');
  const nameMatch = allText.match(NAME_RE);
  const detectedName = nameMatch ? nameMatch[1] : null;

  return { titleGuess, emails: list, matchedCount: list.length, detectedName };
}

module.exports = { mapLinkedinDocx, mapEmailDocx, applyNameSubstitution };
