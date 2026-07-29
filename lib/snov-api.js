const https = require('https');
const querystring = require('querystring');

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

class SnovClient {
  constructor(clientId, clientSecret) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.token = null;
    this.tokenObtainedAt = 0;
  }

  async getToken() {
    if (this.token && Date.now() - this.tokenObtainedAt < 50 * 60 * 1000) return this.token;
    const postData = querystring.stringify({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const { body } = await httpsRequest(
      {
        hostname: 'api.snov.io',
        path: '/v1/oauth/access_token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) },
      },
      postData
    );
    if (!body.access_token) throw new Error('Falha ao autenticar no Snov.io: ' + JSON.stringify(body));
    this.token = body.access_token;
    this.tokenObtainedAt = Date.now();
    return this.token;
  }

  async request(method, urlPath, jsonBody) {
    const token = await this.getToken();
    const postData = jsonBody ? JSON.stringify(jsonBody) : null;
    const headers = { Authorization: `Bearer ${token}` };
    if (postData) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    return httpsRequest({ hostname: 'api.snov.io', path: urlPath, method, headers }, postData);
  }

  async getAllCampaigns() {
    const { body } = await this.request('GET', '/v1/get-user-campaigns');
    if (!Array.isArray(body)) throw new Error('Resposta inesperada em get-user-campaigns: ' + JSON.stringify(body));
    return body;
  }

  async getActiveCampaigns() {
    const all = await this.getAllCampaigns();
    return all.filter(c => c.status === 'Active');
  }

  async getLinkedinAccounts() {
    const { body } = await this.request('GET', '/v2/linkedin-accounts');
    return (body.data || []).filter(a => a && a.id);
  }

  async getUserLists() {
    const { body } = await this.request('GET', '/v1/get-user-lists');
    return Array.isArray(body) ? body : [];
  }

  async createList(name) {
    const { body } = await this.request('POST', '/v2/lists', { name });
    if (!body.data || !body.data.id) throw new Error('Falha ao criar lista: ' + JSON.stringify(body));
    return body.data.id;
  }

  async addProspectByEmail(listId, email) {
    const { body } = await this.request('POST', '/v1/add-prospect-to-list', { listId, email });
    return body;
  }

  async createCampaign(payload) {
    const { body } = await this.request('POST', '/v2/campaigns/create', payload);
    if (!body.success) throw new Error('Falha ao criar campanha: ' + JSON.stringify(body));
    return body.data;
  }

  async deleteCampaign(id) {
    const { body } = await this.request('DELETE', `/v2/campaigns/${id}`);
    return body;
  }

  async getCampaign(id) {
    const { body } = await this.request('GET', `/v2/campaigns/${id}`);
    return body.data;
  }

  splitInto31DayChunks(from, to) {
    const chunks = [];
    let start = new Date(from + 'T00:00:00Z');
    const end = new Date(to + 'T00:00:00Z');
    while (start <= end) {
      const chunkEnd = new Date(start);
      chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 30);
      const actualEnd = chunkEnd > end ? end : chunkEnd;
      chunks.push([start.toISOString().slice(0, 10), actualEnd.toISOString().slice(0, 10)]);
      start = new Date(actualEnd);
      start.setUTCDate(start.getUTCDate() + 1);
    }
    return chunks;
  }

  async getAllActivity(campaignId, from, to) {
    const all = [];
    for (const [chunkFrom, chunkTo] of this.splitInto31DayChunks(from, to)) {
      let offset = 0;
      const count = 100;
      while (true) {
        const { body } = await this.request(
          'GET',
          `/v2/campaigns/${campaignId}/recipients-activity?date_from=${chunkFrom}&date_to=${chunkTo}&count=${count}&offset=${offset}`
        );
        if (!body || body.errors) break;
        if (!Array.isArray(body.data) || body.data.length === 0) break;
        all.push(...body.data);
        if (body.data.length < count) break;
        offset += count;
      }
    }
    return all;
  }

  async getAllReplies(campaignId) {
    const all = [];
    let offset = 0;
    const count = 100;
    while (true) {
      const { body } = await this.request('GET', `/v2/campaigns/${campaignId}/replies?count=${count}&offset=${offset}`);
      if (!body || body.errors) break;
      if (!Array.isArray(body.data) || body.data.length === 0) break;
      all.push(...body.data);
      if (body.data.length < count) break;
      offset += count;
    }
    return all;
  }
}

module.exports = { SnovClient };
