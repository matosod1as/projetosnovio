const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'marked-replies.json');
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH_KEY = 'snov_painel_marked_replies';
const useRedis = !!(REDIS_URL && REDIS_TOKEN);

async function redisCall(...segments) {
  const url = `${REDIS_URL}/${segments.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${REDIS_TOKEN}` } });
  const data = await res.json();
  if (data.error) throw new Error('Erro no Upstash Redis: ' + data.error);
  return data.result;
}

function loadLocal() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveLocal(data) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(data), 'utf8');
}

function replyKey(campaignId, servico, reply) {
  const identity = reply.email || reply.name || '';
  return `${campaignId}|${servico}|${identity}|${reply.time || ''}`;
}

async function isMarked(key) {
  if (useRedis) {
    const result = await redisCall('hget', HASH_KEY, key);
    return result !== null;
  }
  return !!loadLocal()[key];
}

async function mark(key) {
  if (useRedis) {
    await redisCall('hset', HASH_KEY, key, String(Date.now()));
    return;
  }
  const data = loadLocal();
  data[key] = Date.now();
  saveLocal(data);
}

module.exports = { replyKey, isMarked, mark, usingRedis: useRedis };
