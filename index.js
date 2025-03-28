console.log('=== BOT STARTED ===');
const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

// === АВТОРИЗАЦИЯ GOOGLE SHEETS ===
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// === ФУНКЦИЯ ЗАПИСИ В ТАБЛИЦУ ===
async function appendToSheet(rowData) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const spreadsheetId = '1jlk8TlKaVbySVw6j--9fOp2dWEN0I7O5QEYHrOWnL3c'; // ← ID из таблицы
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'A1',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [rowData]
    }
  });
}

// === ФУНКЦИЯ ОБРАБОТКИ ТЕКСТА ===
function processGroupedText(rawText) {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
  const result = [];
  let row = [];
  let fbBlock = '';
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.includes('GG')) {
      if (row.length > 0) result.push(row);
      row = [line];
      i++;
      continue;
    }

    if (line.startsWith('FB:')) {
      fbBlock = line;
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('GG')) {
        fbBlock += ' ' + lines[i].trim();
        i++;
      }
      row.push(fbBlock);
      fbBlock = '';
      continue;
    }

    row.push(line);
    i++;
  }

  if (row.length > 0) result.push(row);
  return result;
}

// === ВЕБХУК ===
app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  if (events) {
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const rawText = event.message.text;

        // логируем оригинал
        const log = `[${new Date().toISOString()}] GROUP: ${event.source.groupId} USER: ${event.source.userId} TEXT: ${rawText}\n`;
        fs.appendFileSync('messages.log', log);

        // обрабатываем
        const grouped = processGroupedText(rawText);
        console.log('[TRANSFORMED]');
        for (let index = 0; index < grouped.length; index++) {
          const row = grouped[index];
          console.log(`${index + 1}: ${row.join(' | ')}`);
          try {
            await appendToSheet(row);
          } catch (err) {
            console.error('Ошибка при записи в Google Sheets:', err);
          }
        }
      }
    }
  }
  res.sendStatus(200);
});

// === ДЕФОЛТНАЯ СТРАНИЦА ===
app.get('/', (req, res) => res.send('LINE bot is running'));

// === ЗАПУСК ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
