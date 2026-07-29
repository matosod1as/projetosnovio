const { chromium } = require('playwright');

/**
 * Preenche o conteúdo (assunto + corpo) de cada etapa de e-mail de uma campanha,
 * automatizando o navegador (a API do Snov.io não persiste esse conteúdo).
 *
 * @param {string} loginEmail
 * @param {string} loginPassword
 * @param {number} campaignId
 * @param {Array<{subject: string, body: string}>} emails - na mesma ordem das etapas da campanha
 * @param {(msg: string) => void} onProgress - callback opcional pra reportar progresso
 */
async function fillEmailCampaignContent(loginEmail, loginPassword, campaignId, emails, onProgress = () => {}) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    onProgress('Fazendo login no Snov.io...');
    await page.goto('https://app.snov.io/login', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder(/johnsmith@example.com/i).fill(loginEmail);
    await page.getByPlaceholder(/8\+ characters/i).fill(loginPassword);
    await page.getByRole('button', { name: /log in|entrar/i }).click();
    await page.waitForURL(/app\.snov\.io\/(home|campaigns)?/, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    onProgress(`Abrindo campanha ${campaignId}...`);
    await page.goto(`https://app.snov.io/campaigns/new/create/${campaignId}/sequence`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    for (let i = 0; i < emails.length; i++) {
      onProgress(`Preenchendo e-mail ${i + 1}/${emails.length}...`);
      const placeholder = page.getByText('Adicionar conteúdo ao e-mail').first();
      await placeholder.waitFor({ timeout: 15000 });
      await placeholder.click();
      await page.waitForTimeout(800);

      const subjectField = page.locator('text=Linha de assunto:').locator('..').locator('[contenteditable], input, textarea').first();
      // Snov usa um campo de assunto ao lado do rótulo "Linha de assunto:" — clicamos perto dele.
      const subjectRow = page.getByText(/Linha de assunto/i);
      await subjectRow.click({ position: { x: 250, y: 0 } }).catch(() => {});
      await page.keyboard.type(emails[i].subject, { delay: 5 });

      const bodyArea = page.getByPlaceholder('Digite ou cole seu e-mail aqui');
      await bodyArea.click();
      const bodyLines = emails[i].body.split('\n');
      for (const line of bodyLines) {
        await page.keyboard.type(line, { delay: 2 });
        await page.keyboard.press('Enter');
      }

      const saveBtn = page.getByRole('button', { name: 'Salvar' }).first();
      await saveBtn.click();
      await page.waitForTimeout(1200);
    }

    onProgress('Concluído.');
    return { success: true };
  } finally {
    await browser.close();
  }
}

module.exports = { fillEmailCampaignContent };
