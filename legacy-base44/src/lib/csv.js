// Minimal RFC4180 CSV parser used by the import review screen.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        value += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }
  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { header: [], objects: [] };
  const header = rows[0].map((h) => h.trim());
  const objects = rows.slice(1).map((cells) => {
    const obj = {};
    header.forEach((key, index) => {
      obj[key] = cells[index] ?? "";
    });
    return obj;
  });
  return { header, objects };
}