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
  // Проверка входных данных
  if (!rawText) {
    console.log('Получен пустой текст');
    return { GG: [], DD: [], JJ: [], OTHER: [] };
  }

  try {
    // Разбиваем текст на строки и убираем лишние пробелы
    const lines = rawText.split(/\r?\n/).map(line => line?.trim() || '').filter(Boolean);
    
    // Инициализируем объект для хранения сгруппированных заказов
    const result = { GG: [], DD: [], JJ: [], OTHER: [] };
    
    let currentRow = [];
    let i = 0;
    let currentType = null;

    while (i < lines.length) {
      const line = lines[i];
      
      // Поиск типа заказа
      let foundType = false;
      for (const [type, config] of Object.entries(ORDER_TYPES)) {
        if (type === 'OTHER') continue;
        
        if (config.pattern && line.match(config.pattern)) {
          // Сохраняем предыдущий заказ
          if (currentRow.length > 0 && currentType) {
            result[currentType].push([...currentRow]);
          }
          
          // Обработка номера заказа
          const match = line.match(config.pattern);
          const orderNumber = match ? match[0] : 'номер не найден';
          
          // Обработка даты
          let date = 'дата не найдена';
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const dateMatch = nextLine?.match(/(\d{2}\/\d{2}\/\d{2})(?:[-\s\w]*)?/);
            if (dateMatch) {
              date = dateMatch[1];
              i++;
            }
          }
          
          // Инициализация новой строки
          currentRow = [
            date,
            orderNumber,
            config.productName || 'продукт не найден',
            'FB инфо не найдена',
            'cod не найден',
            ''
          ];
          currentType = type;
          foundType = true;
          break;
        }
      }

      if (foundType) {
        i++;
        continue;
      }

      // Обработка OTHER типа
      if (currentRow.length === 0 && line) {
        currentType = 'OTHER';
        const now = new Date();
        const currentDate = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
        currentRow = [currentDate, 'UNKNOWN', line, 'FB инфо не найдена', 'cod не найден', ''];
      }

      // Обработка FB блока
      if (line.startsWith('FB:')) {
        let fbBlock = line;
        let productFound = false;
        let codFound = false;
        i++;
        
        // Сбор FB информации
        while (i < lines.length) {
          const current = lines[i]?.trim();
          if (!current || current.match(/GG|DD|JJ/)) break;
          
          fbBlock += ' ' + current;

          // Поиск COD
          const codMatch = current.match(/Cod\s+[\d.,]+\s+ກີບ/);
          if (codMatch) {
            currentRow[4] = codMatch[0];
            codFound = true;
            
            // Поиск продукта перед COD
            if (i > 0) {
              const previousLine = lines[i-1]?.trim();
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

        // Обновление FB информации
        if (fbBlock.trim() !== 'FB:') {
          currentRow[3] = fbBlock;
        }
        
        // Проверка наличия данных
        if (!productFound && currentType !== 'OTHER') {
          currentRow[2] = 'продукт не найден';
        }
        if (!codFound) {
          currentRow[4] = 'cod не найден';
        }
        
        continue;
      }

      i++;
    }

    // Добавление последнего заказа
    if (currentRow.length > 0 && currentType) {
      result[currentType].push([...currentRow]);
    }

    return result;

  } catch (error) {
    console.error('Ошибка при обработке текста:', error);
    return { GG: [], DD: [], JJ: [], OTHER: [] };
  }
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
