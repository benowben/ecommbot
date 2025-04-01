// Добавим в начало файла проверку всех необходимых переменных окружения
const requiredEnvVars = {
  LOGTAIL_TOKEN: process.env.LOGTAIL_TOKEN,
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
  GG_SPREADSHEET_ID: process.env.GG_SPREADSHEET_ID,
  DD_SPREADSHEET_ID: process.env.DD_SPREADSHEET_ID,
  JJ_SPREADSHEET_ID: process.env.JJ_SPREADSHEET_ID,
  OTHER_SPREADSHEET_ID: process.env.OTHER_SPREADSHEET_ID
};

for (const [name, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    throw new Error(`Отсутствует ${name} в переменных окружения`);
  }
}

// Инициализация логирования
const { Logtail } = require("@logtail/node");
if (!process.env.LOGTAIL_TOKEN) {
  throw new Error('Отсутствует LOGTAIL_TOKEN в переменных окружения');
}
const logtail = new Logtail(process.env.LOGTAIL_TOKEN);

// Основные зависимости
const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');

// Инициализация Express
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
    // Логируем успешную запись
    await logtail.info('Успешная запись в таблицу', {
      spreadsheetId,
      rowData,
      action: 'append_success'
    });
  } catch (error) {
    // Логируем ошибку
    await logtail.error('Ошибка при записи в таблицу', {
      spreadsheetId,
      rowData,
      error: error.message,
      action: 'append_error'
    });
    console.error(`Ошибка при записи в таблицу ${spreadsheetId}:`, error);
    throw error;
  }
}

// === ФУНКЦИЯ ОБРАБОТКИ ТЕКСТА ===
function processGroupedText(rawText) {
  const lines = rawText.split(/\r?\n/).map(line => line.trim());
  const result = {
    GG: [],
    DD: [],
    JJ: [],
    OTHER: []
  };
  
  let currentRow = [];
  let i = 0;
  let currentType = null;

  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;

  while (i < lines.length) {
    const line = lines[i];

    // Определяем тип заказа
    let foundType = false;
    for (const [type, config] of Object.entries(ORDER_TYPES)) {
      if (type === 'OTHER') continue;
      
      if (line.match(config.pattern)) {
        if (currentRow.length > 0 && currentType) {
          result[currentType].push(currentRow);
        }
        
        const match = line.match(config.pattern);
        const orderNumber = match ? match[0] : line;
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

    // Если это начало нового блока текста и не найден известный тип заказа
    if (currentRow.length === 0 && line.trim() !== '') {
      currentType = 'OTHER';
      currentRow = [date, 'UNKNOWN', line, '', '', ''];
    }

    // Обработка FB блока и другой информации
    if (line.startsWith('FB:')) {
      let fbBlock = line;
      i++;
      while (i < lines.length && !lines[i].match(/GG|DD|JJ/) && lines[i].trim() !== '') {
        const current = lines[i].trim();
        fbBlock += ' ' + current;

        const codMatch = current.match(/Cod\s+[\d.,]+\s+ກີບ/);
        if (codMatch) {
          currentRow[4] = codMatch[0];
        }

        const luteinMatch = current.match(/ລູທີນ\s*\d+/);
        if (luteinMatch) {
          currentRow[5] = luteinMatch[0];
        }

        i++;
      }
      currentRow[3] = fbBlock;
      continue;
    }

    // Обработка COD и Lutein вне FB блока
    if (/Cod\s+[\d.,]+\s+ກີບ/.test(line)) {
      currentRow[4] = line.match(/Cod\s+[\d.,]+\s+ກີບ/)[0];
    }

    const luteinMatch = line.match(/ລູທີນ\s*\d+/);
    if (luteinMatch) {
      currentRow[5] = luteinMatch[0];
    }

    i++;
  }

  // Добавляем последнюю строку
  if (currentRow.length > 0 && currentType) {
    result[currentType].push(currentRow);
  }

  return result;
}

// === ВЕБХУК ===
app.post('/webhook', async (req, res) => {
  try {
    const events = req.body.events;
    if (events) {
      for (const event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
          const rawText = event.message.text;
          
          // Логируем входящее сообщение
          const logMessage = {
            timestamp: new Date().toISOString(),
            groupId: event.source.groupId,
            userId: event.source.userId,
            text: rawText
          };
          
          // Записываем в файл
          fs.appendFileSync('messages.log', JSON.stringify(logMessage) + '\n');
          console.log(logMessage);
          
          // Логируем в Logtail
          await logtail.info('Получено новое сообщение', {
            ...logMessage,
            action: 'message_received'
          });

          const groupedByType = processGroupedText(rawText);
          
          // Обрабатываем каждый тип заказов
          for (const [type, orders] of Object.entries(groupedByType)) {
            if (orders.length === 0) continue;

            // Логируем начало обработки типа
            await logtail.info(`Начало обработки заказов типа ${type}`, {
              type,
              ordersCount: orders.length,
              action: 'processing_start'
            });

            console.log(`[TRANSFORMED ${type}]`);
            for (const row of orders) {
              console.log(`${type}: ${row.join(' | ')}`);
              try {
                await appendToSheet(row, ORDER_TYPES[type].spreadsheetId);
              } catch (err) {
                // Ошибка уже залогирована в appendToSheet
                console.error(`Ошибка при записи ${type} в Google Sheets`, err);
              }
            }

            // Логируем завершение обработки типа
            await logtail.info(`Завершение обработки заказов типа ${type}`, {
              type,
              ordersCount: orders.length,
              action: 'processing_complete'
            });
          }
        }
      }
    }
    res.sendStatus(200);
  } catch (error) {
    // Логируем критическую ошибку
    await logtail.error('Критическая ошибка в webhook', {
      error: error.message,
      stack: error.stack,
      action: 'webhook_error'
    });
    console.error('Критическая ошибка в webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// === ДЕФОЛТНАЯ СТРАНИЦА ===
app.get('/', (req, res) => res.send('LINE bot is running'));

// === ЗАПУСК ===
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server listening on ${PORT}`);
  logtail.info('Сервер запущен', {
    port: PORT,
    action: 'server_start'
  });
});

// Обработка ошибок сервера
server.on('error', async (error) => {
  await logtail.error('Ошибка сервера', {
    error: error.message,
    stack: error.stack,
    action: 'server_error'
  });
  console.error('Server error:', error);
  process.exit(1);
});
