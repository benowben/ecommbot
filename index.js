// const { Logtail } = require("@logtail/node");
// const logtail = new Logtail(process.env.LOGTAIL_TOKEN);

const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const app = express();
app.use(express.json());

// === КОНСТАНТЫ ===
const ORDER_TYPES = {
  GG: {
    pattern: /GG[^\s]*/,
    spreadsheetId: process.env.GG_SPREADSHEET_ID,
    productName: 'โลชั่นผิวขาว (ขายลูทีน)'
  },
  DD: {
    pattern: /DD[^\s]*/,
    spreadsheetId: process.env.DD_SPREADSHEET_ID,
    productName: 'Product DD'
  },
  JJ: {
    pattern: /JJ[^\s]*/,
    spreadsheetId: process.env.JJ_SPREADSHEET_ID,
    productName: 'Product JJ'
  },
  OTHER: {
    spreadsheetId: process.env.OTHER_SPREADSHEET_ID
  }
};

// === АВТОРИЗАЦИЯ GOOGLE SHEETS ===
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

// === ФУНКЦИЯ ЗАПИСИ В ТАБЛИЦУ ===
async function appendToSheet(rowData, spreadsheetId) {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'A1',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [rowData]
      }
    });
  } catch (error) {
    console.error(`Ошибка при записи в таблицу ${spreadsheetId}:`, error);
    throw error;
  }
}

// === ФУНКЦИЯ ОБРАБОТКИ ТЕКСТА ===
// Функция обрабатывает входящий текст и группирует заказы по типам (GG, DD, JJ, OTHER)
function processGroupedText(rawText) {
  // Разбиваем текст на строки и убираем лишние пробелы
  const lines = rawText.split(/\r?\n/).map(line => line.trim());
  
  // Инициализируем объект для хранения сгруппированных заказов
  const result = {
    GG: [],
    DD: [],
    JJ: [],
    OTHER: []
  };
  
  // Переменные для отслеживания текущей обрабатываемой строки
  let currentRow = [];  // Текущая строка данных
  let i = 0;           // Индекс текущей строки в массиве
  let currentType = null; // Текущий тип заказа (GG/DD/JJ/OTHER)

  // Обрабатываем каждую строку входного текста
  while (i < lines.length) {
    const line = lines[i];

    // Определяем тип заказа по шаблонам из ORDER_TYPES
    let foundType = false;
    for (const [type, config] of Object.entries(ORDER_TYPES)) {
      if (type === 'OTHER') continue; // Пропускаем тип OTHER, он обрабатывается отдельно
      
      if (line.match(config.pattern)) {
        // Если есть незавершенная строка, добавляем её в результат
        if (currentRow.length > 0 && currentType) {
          result[currentType].push(currentRow);
        }
        
        // Ищем дату в формате DD/MM/YY, возможно с дополнительным текстом после даты
        const dateMatch = line.match(/(\d{2}\/\d{2}\/\d{2})(?:[-\s\w]*)?/);
        const date = dateMatch ? dateMatch[1] : '';
        
        // Создаем новую строку с номером заказа
        const match = line.match(config.pattern);
        const orderNumber = match ? match[0] : line;
        // Формат строки: [дата, номер заказа, название продукта, FB информация, COD, количество Lutein]
        currentRow = [date, orderNumber, config.productName, '', '', ''];
        currentType = type;
        foundType = true;
        break;
      }
    }

    if (foundType) {
      i++;
      continue;
    }

    // Обработка неизвестного типа заказа
    if (currentRow.length === 0 && line.trim() !== '') {
      currentType = 'OTHER';
      currentRow = [date, 'UNKNOWN', line, '', '', ''];
    }

    // Обработка FB блока (информация о Facebook заказе)
    if (line.startsWith('FB:')) {
      let fbBlock = line;
      i++;
      // Собираем весь FB блок до следующего заказа или пустой строки
      while (i < lines.length && !lines[i].match(/GG|DD|JJ/) && lines[i].trim() !== '') {
        const current = lines[i].trim();
        fbBlock += ' ' + current;

        // Ищем информацию о COD (наложенный платеж)
        const codMatch = current.match(/Cod\s+[\d.,]+\s+ກີບ/);
        if (codMatch) {
          currentRow[4] = codMatch[0];
        }

        // Ищем информацию о количестве Lutein
        const luteinMatch = current.match(/ລູທີນ\s*\d+/);
        if (luteinMatch) {
          currentRow[5] = luteinMatch[0];
        }

        i++;
      }
      currentRow[3] = fbBlock;
      continue;
    }

    // Обработка COD и Lutein информации вне FB блока
    if (/Cod\s+[\d.,]+\s+ກີບ/.test(line)) {
      currentRow[4] = line.match(/Cod\s+[\d.,]+\s+ກີບ/)[0];
    }

    const luteinMatch = line.match(/ລູທີນ\s*\d+/);
    if (luteinMatch) {
      currentRow[5] = luteinMatch[0];
    }

    i++;
  }

  // Добавляем последнюю необработанную строку в результат
  if (currentRow.length > 0 && currentType) {
    result[currentType].push(currentRow);
  }

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

        const groupedByType = processGroupedText(rawText);
        
        // Обрабатываем каждый тип заказов
        for (const [type, orders] of Object.entries(groupedByType)) {
          if (orders.length === 0) continue;

          console.log(`[TRANSFORMED ${type}]`);
          for (const row of orders) {
            console.log(`${type}: ${row.join(' | ')}`);
            try {
              await appendToSheet(row, ORDER_TYPES[type].spreadsheetId);
            } catch (err) {
              console.error(`Ошибка при записи ${type} в Google Sheets`, err);
            }
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
