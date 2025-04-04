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
        
        // Создаем новую строку с номером заказа
        const match = line.match(config.pattern);
        const orderNumber = match ? match[0] : line;
        
        // Проверяем следующую строку на наличие даты
        let date = 'дата не найдена'; // Значение по умолчанию
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const dateMatch = nextLine.match(/(\d{2}\/\d{2}\/\d{2})(?:[-\s\w]*)?/);
          if (dateMatch) {
            date = dateMatch[1];
            i++; // Пропускаем строку с датой
          }
        }
        
        currentRow = [date, orderNumber, 'продукт не найден', '', '', ''];
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
      const now = new Date();
      const currentDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
      currentRow = [currentDate, 'UNKNOWN', 'продукт не найден', '', '', ''];
    }

    // Обработка FB блока
    if (line.startsWith('FB:')) {
      let fbBlock = line;
      let productFound = false;
      i++;
      
      while (i < lines.length && !lines[i].match(/GG|DD|JJ/) && lines[i].trim() !== '') {
        const current = lines[i].trim();
        fbBlock += ' ' + current;

        // Ищем информацию о COD
        const codMatch = current.match(/Cod\s+[\d.,]+\s+ກີບ/);
        if (codMatch) {
          currentRow[4] = codMatch[0];
          // Если перед COD была строка и это не служебная информация, считаем её названием продукта
          if (i > 0) {
            const previousLine = lines[i-1].trim();
            if (previousLine && 
                !previousLine.startsWith('FB:') && 
                !previousLine.includes('ລູກຄ້າຮັບ') &&
                !previousLine.includes('ສາຂາ')) {
              currentRow[2] = previousLine;
              productFound = true;
            }
          }
        }

        i++;
      }
      currentRow[3] = fbBlock;
      
      // Если продукт не был найден
      if (!productFound) {
        currentRow[2] = 'продукт не найден';
      }
      
      continue;
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
