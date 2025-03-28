// === ФУНКЦИЯ ОБРАБОТКИ ТЕКСТА ===
function processGroupedText(rawText) {
  const lines = rawText.split(/\r?\n/).map(line => line.trim());
  const result = [];
  let row = [];
  let i = 0;

  // дата в формате дд/мм/гг
  const now = new Date();
  const date = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear().toString().slice(-2)}`;

  while (i < lines.length) {
    const line = lines[i];

    if (line.includes('GG')) {
      if (row.length > 0) result.push(row);
      const match = line.match(/GG[^\s]*/);
      const orderNumber = match ? match[0] : line;
      row = [date, orderNumber, 'โลชั่นผิวขาว (ขายลูทีน)', '', '', ''];
      i++;
      continue;
    }

    if (line.startsWith('FB:')) {
      let fbBlock = line;
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].includes('GG')) {
        const current = lines[i].trim();
        fbBlock += ' ' + current;

        const codMatch = current.match(/Cod\s+[\d.,]+\s+ກີບ/);
        if (codMatch) {
          row[4] = codMatch[0];
        }

        const luteinMatch = current.match(/ລູທີນ\s*\d+/);
        if (luteinMatch) {
          row[5] = luteinMatch[0];
        }

        i++;
      }
      row.push(fbBlock);
      continue;
    }

    if (/Cod\s+[\d.,]+\s+ກີບ/.test(line)) {
      row[4] = line.match(/Cod\s+[\d.,]+\s+ກີບ/)[0];
    }

    const luteinMatch = line.match(/ລູທີນ\s*\d+/);
    if (luteinMatch) {
      row[5] = luteinMatch[0];
    }

    i++;
  }

  if (row.length > 0) result.push(row);
  return result;
}
