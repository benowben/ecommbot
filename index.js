const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

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
app.post('/webhook', (req, res) => {
  const events = req.body.events;
  if (events) {
    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        const rawText = event.message.text;

        // логируем оригинал
        const log = `[${new Date().toISOString()}] GROUP: ${event.source.groupId} USER: ${event.source.userId} TEXT: ${rawText}\n`;
        fs.appendFileSync('messages.log', log);

        // обрабатываем и выводим в лог Render
        const grouped = processGroupedText(rawText);
        console.log('[TRANSFORMED]');
        grouped.forEach((row, index) => {
          console.log(`${index + 1}: ${row.join(' | ')}`);
        });
      }
    });
  }
  res.sendStatus(200);
});

// === ДЕФОЛТНАЯ СТРАНИЦА ===
app.get('/', (req, res) => res.send('LINE bot is running'));

// === ЗАПУСК ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
