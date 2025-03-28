// const { Logtail } = require("@logtail/node");
// const logtail = new Logtail(process.env.LOGTAIL_TOKEN);

const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

// === АВТОРИЗАЦИЯ GOOGLE SHEETS ===
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// === ФУНКЦИЯ ЗАПИСИ В ТАБЛИЦУ ===
async function appendToSheet(rowData) {
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
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
// Функция принимает сырой текст и преобразует его в структурированный массив данных
function processGroupedText(rawText) {
  // Разбиваем входной текст на строки, удаляем пробелы в начале и конце каждой строки
  const lines = rawText.split(/\r?\n/).map(line => line.trim());
  
  // Массив для хранения всех обработанных строк
  const result = [];
  // Текущая обрабатываемая строка (массив с данными)
  let row = [];
  // Индекс для перемещения по строкам
  let i = 0;

  // Формируем текущую дату в формате дд/мм/гг
  const now = new Date();
  const date = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear().toString().slice(-2)}`;

  // Обрабатываем каждую строку входного текста
  while (i < lines.length) {
    const line = lines[i];

    // Если находим строку с GG (новый заказ)
    if (line.includes('GG')) {
      // Если текущая строка не пуста, добавляем её в результат
      if (row.length > 0) result.push(row);
      
      // Извлекаем номер заказа (GG + цифры)
      const match = line.match(/GG[^\s]*/);
      const orderNumber = match ? match[0] : line;
      
      // Создаем новую строку с 6 колонками:
      // [0] - дата
      // [1] - номер заказа
      // [2] - название товара (фиксированное)
      // [3] - FB текст (будет заполнен позже)
      // [4] - COD информация
      // [5] - информация о Lutein
      row = [date, orderNumber, 'โลชั่นผิวขาว (ขายลูทีน)', '', '', ''];
      i++;
      continue;
    }

    // Если находим FB блок (информация о заказе)
    if (line.startsWith('FB:')) {
      let fbBlock = line;
      i++;
      // Собираем весь FB блок до пустой строки или нового GG
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('GG')) {
        const current = lines[i].trim();
        fbBlock += ' ' + current;

        // Ищем информацию о COD (наложенный платеж)
        const codMatch = current.match(/Cod\s+[\d.,]+\s+ກີບ/);
        if (codMatch) {
          row[4] = codMatch[0]; // Сохраняем в 5-ю колонку
        }

        // Ищем информацию о Lutein
        const luteinMatch = current.match(/ລູທີນ\s*\d+/);
        if (luteinMatch) {
          row[5] = luteinMatch[0]; // Сохраняем в 6-ю колонку
        }

        i++;
      }
      // Сохраняем весь FB блок в 4-ю колонку (индекс 3)
      row[3] = fbBlock;
      continue;
    }

    // Если находим COD информацию вне FB блока
    if (/Cod\s+[\d.,]+\s+ກີບ/.test(line)) {
      row[4] = line.match(/Cod\s+[\d.,]+\s+ກີບ/)[0];
    }

    // Если находим Lutein информацию вне FB блока
    const luteinMatch = line.match(/ລູທີນ\s*\d+/);
    if (luteinMatch) {
      row[5] = luteinMatch[0];
    }

    i++;
  }

  // Добавляем последнюю обработанную строку в результат
  if (row.length > 0) result.push(row);
  
  // Возвращаем массив обработанных строк
  return result;
}

// === ВЕБХУК ===
app.post('/webhook', async (req, res) => {
  const events = req.body.events;
  if (events) {
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const rawText = event.message.text;
        const log = `[${new Date().toISOString()}] GROUP: ${event.source.groupId} USER: ${event.source.userId} TEXT: ${rawText}`;
        fs.appendFileSync('messages.log', log + '\n');
        console.log(log);

        const grouped = processGroupedText(rawText);
        console.log('[TRANSFORMED]');
        for (let index = 0; index < grouped.length; index++) {
          const row = grouped[index];
          const line = `${index + 1}: ${row.join(' | ')}`;
          console.log(line);
          try {
            await appendToSheet(row);
          } catch (err) {
            console.error("Ошибка при записи в Google Sheets", err);
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
app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
});
