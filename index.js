function processGroupedText(rawText) {
  // Проверка входных данных
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Входной текст должен быть строкой');
  }

  // Вынесем регулярные выражения в константы для лучшей читаемости и производительности
  const COD_PATTERN = /Cod\s+[\d.,]+\s+ກີບ/;
  const LUTEIN_PATTERN = /ລູທີນ\s*\d+/;
  const GG_PATTERN = /GG[^\s]*/;

  try {
    const lines = rawText.split(/\r?\n/).map(line => line.trim());
    const result = [];
    let currentRow = [];
    let i = 0;

    // Форматирование даты
    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;

    while (i < lines.length) {
      const line = lines[i];

      // Обработка GG
      if (line.includes('GG')) {
        if (currentRow.length > 0) {
          result.push(currentRow);
        }
        const match = line.match(GG_PATTERN);
        const orderNumber = match ? match[0] : line;
        currentRow = [date, orderNumber, 'โลชั่นผิวขาว (ขายลูทีน)', '', '', ''];
        i++;
        continue;
      }

      // Обработка FB блока
      if (line.startsWith('FB:')) {
        let fbBlock = line;
        i++;
        
        while (i < lines.length) {
          const current = lines[i].trim();
          
          // Прерываем цикл если строка пустая или начинается новый GG
          if (!current || current.includes('GG')) {
            break;
          }

          fbBlock += ' ' + current;

          // Поиск Cod
          const codMatch = current.match(COD_PATTERN);
          if (codMatch) {
            currentRow[4] = codMatch[0];
          }

          // Поиск Lutein
          const luteinMatch = current.match(LUTEIN_PATTERN);
          if (luteinMatch) {
            currentRow[5] = luteinMatch[0];
          }

          i++;
        }
        
        currentRow[3] = fbBlock; // FB блок всегда должен быть в 4-й колонке
        continue;
      }

      // Обработка отдельных Cod и Lutein вне FB блока
      const codMatch = line.match(COD_PATTERN);
      if (codMatch) {
        currentRow[4] = codMatch[0];
      }

      const luteinMatch = line.match(LUTEIN_PATTERN);
      if (luteinMatch) {
        currentRow[5] = luteinMatch[0];
      }

      i++;
    }

    // Добавляем последнюю строку
    if (currentRow.length > 0) {
      result.push(currentRow);
    }

    return result;

  } catch (error) {
    console.error('Ошибка при обработке текста:', error);
    throw error;
  }
} 
