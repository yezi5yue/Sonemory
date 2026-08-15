const REQUIRED_ITEM_FIELDS = ["word", "meaning"];

export function stableId(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function splitList(value = "") {
  return String(value)
    .split(/[|；;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }

  if (quoted) throw new Error("CSV 中存在没有闭合的引号。");
  if (field.length || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some(Boolean));
}

function splitPipeRow(value) {
  const fields = String(value).split("|").map((field) => field.trim());
  if (!fields[0]) fields.shift();
  if (!fields.at(-1)) fields.pop();
  return fields;
}

function normalizePastedRows(rows) {
  return rows.map((row) => {
    if (row.length === 1 && row[0].includes("|")) return splitPipeRow(row[0]);
    return row;
  });
}

export function packFromCsv(text, metadata) {
  const rows = normalizePastedRows(parseCsv(text));
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一条单词记录。");

  const headers = rows[0].map((header) => header.trim());
  const requiredHeaders = ["word", "meaning"];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`缺少必需列：${missing.join(", ")}`);

  const items = rows.slice(1).map((values, index) => {
    const raw = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const word = raw.word.trim();
    return {
      id: raw.id?.trim() || `${stableId(`${metadata.title}:${word}`)}-${index + 1}`,
      word,
      meaning: raw.meaning.trim(),
      partOfSpeech: raw.partOfSpeech?.trim() || "未标注",
      unit: raw.unit?.trim() || "未分组",
      chunks: splitList(raw.chunks),
      aliases: splitList(raw.aliases),
      note: raw.note?.trim() || "",
      locale: raw.locale?.trim() || metadata.locale || "en-US"
    };
  });

  return validatePack({
    schemaVersion: 1,
    id: `pack-${stableId(`${metadata.title}:${metadata.edition}:${items.length}`)}`,
    title: metadata.title,
    locale: metadata.locale || "en-US",
    source: {
      publisher: metadata.publisher,
      edition: metadata.edition,
      reference: metadata.reference
    },
    importedAt: new Date().toISOString(),
    items
  });
}

export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") throw new Error("词表格式无效。");
  if (!String(pack.title ?? "").trim()) errors.push("需要填写资料名称");
  if (!String(pack.source?.publisher ?? "").trim()) errors.push("需要填写发布机构或出版社");
  if (!String(pack.source?.edition ?? "").trim()) errors.push("需要填写版本或版次");
  if (!Array.isArray(pack.items) || !pack.items.length) errors.push("词表中没有单词");

  const seen = new Set();
  for (const [index, item] of (pack.items ?? []).entries()) {
    for (const field of REQUIRED_ITEM_FIELDS) {
      if (!String(item[field] ?? "").trim()) errors.push(`第${index + 1}行缺少${field}`);
    }
    const wordKey = String(item.word ?? "").trim().toLowerCase();
    if (seen.has(wordKey)) errors.push(`单词重复：${item.word}`);
    seen.add(wordKey);
  }

  if (errors.length) throw new Error(errors.slice(0, 6).join("；"));
  return structuredClone(pack);
}

