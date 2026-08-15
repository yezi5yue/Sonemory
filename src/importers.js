/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UNCOMPRESSED_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 10000;
const decoder = new TextDecoder("utf-8");

function decodeXml(value = "") {
  return String(value)
    .replace(/_x000D_/gi, "\n")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function attribute(xml, name) {
  return xml.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"))?.[1] ?? "";
}

function columnIndex(reference = "A1") {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return result - 1;
}

function normalizeZipPath(value) {
  const parts = [];
  for (const part of String(value).replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function findZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  const earliest = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("无法读取 XLSX：文件不是有效的 Excel 工作簿。");
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("无法读取 XLSX：压缩目录已损坏。");
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = normalizeZipPath(decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)));
    entries.set(name, { compression, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { bytes, view, entries };
}

async function readZipText(zip, name) {
  const entry = zip.entries.get(normalizeZipPath(name));
  if (!entry) return "";
  if (entry.uncompressedSize > MAX_UNCOMPRESSED_ENTRY_BYTES) {
    throw new Error("XLSX 工作表解压后过大，请拆分为较小文件后再导入。");
  }
  const { view, bytes } = zip;
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("无法读取 XLSX：工作表数据已损坏。");
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);
  if (entry.compression === 0) return decoder.decode(compressed);
  if (entry.compression !== 8) throw new Error("该 XLSX 使用了当前浏览器不支持的压缩格式。");
  if (!globalThis.DecompressionStream) throw new Error("当前浏览器不支持 XLSX 解压，请改用最新版 Edge/Chrome 或 CSV 文件。");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const decompressed = await new Response(stream).arrayBuffer();
  if (entry.uncompressedSize && decompressed.byteLength !== entry.uncompressedSize) {
    throw new Error("无法读取 XLSX：解压后的工作表大小不正确。");
  }
  return decoder.decode(decompressed);
}

function firstSheetInfo(workbookXml, relationshipsXml, entries) {
  const sheetTag = workbookXml.match(/<(?:\w+:)?sheet\b[^>]*>/i)?.[0] ?? "";
  const sheetName = decodeXml(attribute(sheetTag, "name")) || "Sheet1";
  const relationshipId = attribute(sheetTag, "r:id");
  const relationships = [...relationshipsXml.matchAll(/<(?:\w+:)?Relationship\b[^>]*>/gi)];
  const relationship = relationships.find((match) => attribute(match[0], "Id") === relationshipId)?.[0] ?? "";
  const target = attribute(relationship, "Target");
  if (target) {
    const resolved = normalizeZipPath(target.startsWith("/") ? target.slice(1) : `xl/${target}`);
    if (entries.has(resolved)) return { sheetName, sheetPath: resolved };
  }
  const fallback = [...entries.keys()].filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort()[0];
  if (!fallback) throw new Error("XLSX 中没有可读取的工作表。");
  return { sheetName, sheetPath: fallback };
}

function sharedStringsFromXml(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi)].map((match) =>
    [...match[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)]
      .map((part) => decodeXml(part[1]))
      .join("")
  );
}

function rowsFromSheetXml(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<(?:\w+:)?row\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?row>/gi)) {
    if (rows.length >= MAX_ROWS + 1) throw new Error(`单个文件最多支持 ${MAX_ROWS} 行学习内容。`);
    const row = [];
    const rowBody = rowMatch[2].replace(/<((?:\w+:)?c)\b([^>]*)\/>/gi, "<$1$2></$1>");
    for (const cellMatch of rowBody.matchAll(/<(?:\w+:)?c\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?c>/gi)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const type = attribute(attrs, "t");
      const reference = attribute(attrs, "r") || `A${rows.length + 1}`;
      const valueXml = body.match(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i)?.[1] ?? "";
      let value;
      if (type === "s") value = sharedStrings[Number(valueXml)] ?? "";
      else if (type === "inlineStr") {
        value = [...body.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi)].map((part) => decodeXml(part[1])).join("");
      } else if (type === "b") value = valueXml === "1" ? "TRUE" : "FALSE";
      else value = decodeXml(valueXml);
      row[columnIndex(reference)] = value;
    }
    while (row.length && !String(row.at(-1) ?? "").trim()) row.pop();
    if (row.some((value) => String(value ?? "").trim())) rows.push(row.map((value) => String(value ?? "")));
  }
  if (!rows.length) throw new Error("XLSX 的第一个工作表没有可导入内容。");
  return rows;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function xlsxToRows(buffer) {
  const zip = findZipEntries(buffer);
  const workbookXml = await readZipText(zip, "xl/workbook.xml");
  const relationshipsXml = await readZipText(zip, "xl/_rels/workbook.xml.rels");
  if (!workbookXml) throw new Error("无法读取 XLSX：缺少工作簿定义。");
  const { sheetName, sheetPath } = firstSheetInfo(workbookXml, relationshipsXml, zip.entries);
  const [sheetXml, sharedStringsXml] = await Promise.all([
    readZipText(zip, sheetPath),
    readZipText(zip, "xl/sharedStrings.xml")
  ]);
  return { sheetName, rows: rowsFromSheetXml(sheetXml, sharedStringsFromXml(sharedStringsXml)) };
}

export async function importedFileToCsv(file) {
  if (!file) throw new Error("请选择 CSV 或 XLSX 文件。");
  if (file.size > MAX_FILE_BYTES) throw new Error("导入文件不能超过 10 MB。");
  const name = String(file.name ?? "").toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const csv = (await file.text()).replace(/^\uFEFF/, "");
    const rowCount = Math.max(0, csv.split(/\r?\n/).filter(Boolean).length - 1);
    if (rowCount > MAX_ROWS) throw new Error(`单个文件最多支持 ${MAX_ROWS} 行学习内容。`);
    return { csv, format: "CSV", sheetName: "", rowCount };
  }
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    const { sheetName, rows } = await xlsxToRows(await file.arrayBuffer());
    return { csv: rowsToCsv(rows), format: "XLSX", sheetName, rowCount: Math.max(0, rows.length - 1) };
  }
  throw new Error("仅支持 .csv 或 .xlsx 文件；旧版 .xls 请先另存为 .xlsx。");
}
