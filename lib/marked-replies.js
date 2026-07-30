const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'marked-replies.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data), 'utf8');
}

function replyKey(campaignId, servico, reply) {
  const identity = reply.email || reply.name || '';
  return `${campaignId}|${servico}|${identity}|${reply.time || ''}`;
}

function isMarked(key) {
  const data = load();
  return !!data[key];
}

function mark(key) {
  const data = load();
  data[key] = Date.now();
  save(data);
}

module.exports = { replyKey, isMarked, mark };
