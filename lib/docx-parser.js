const mammoth = require('mammoth');

/**
 * Extrai o texto puro (parágrafos) de um .docx enviado por upload.
 * Retorna um array de linhas não vazias, na ordem do documento.
 */
async function extractDocxLines(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

module.exports = { extractDocxLines };
