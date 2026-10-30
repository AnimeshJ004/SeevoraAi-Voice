'use strict';

const zlib = require('zlib');

/**
 * Universal document text extractor for AI Assistant
 * Supports: .txt, .csv, .json, .tsv, .md, .xml, .html, .doc, .docx, .pdf, .xls, .xlsx
 */

function extractTextFromAttachment(att) {
  if (!att) return '';

  // 1. Direct text content if provided by client
  if (att.textContent && typeof att.textContent === 'string' && att.textContent.trim().length > 10) {
    return cleanExtractedText(att.textContent);
  }

  // 2. Decode from base64 dataUrl
  const dataUrl = att.dataUrl || '';
  if (!dataUrl) return (att.textContent || '').trim();

  try {
    const commaIdx = dataUrl.indexOf(',');
    const b64 = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    const buf = Buffer.from(b64, 'base64');
    if (!buf || !buf.length) return '';

    const name = (att.name || '').toLowerCase();
    const type = (att.type || '').toLowerCase();

    // DOCX format (PKZip with word/document.xml)
    if (name.endsWith('.docx') || type.includes('officedocument.wordprocessingml')) {
      const docxText = parseDocx(buf);
      if (docxText && docxText.length > 10) return cleanExtractedText(docxText);
    }

    // XLSX format (PKZip with xl/sharedStrings.xml)
    if (name.endsWith('.xlsx') || type.includes('officedocument.spreadsheetml')) {
      const xlsxText = parseXlsx(buf);
      if (xlsxText && xlsxText.length > 10) return cleanExtractedText(xlsxText);
    }

    // PDF format
    if (name.endsWith('.pdf') || type.includes('pdf')) {
      const pdfText = parsePdf(buf);
      if (pdfText && pdfText.length > 10) return cleanExtractedText(pdfText);
    }

    // DOC format (HTML, RTF, XML, or binary compound)
    if (name.endsWith('.doc') || type.includes('msword')) {
      const docText = parseDoc(buf);
      if (docText && docText.length > 10) return cleanExtractedText(docText);
    }

    // Plain text / CSV / JSON / Code / XML / HTML / Markdown
    const rawStr = buf.toString('utf8');
    // If it looks like HTML, strip tags
    if (rawStr.includes('<html') || rawStr.includes('<!DOCTYPE') || rawStr.includes('<table')) {
      return cleanExtractedText(stripHtml(rawStr));
    }
    return cleanExtractedText(rawStr);
  } catch (err) {
    // Fallback: try raw string
    try {
      return cleanExtractedText(Buffer.from(att.dataUrl.split(',')[1] || '', 'base64').toString('utf8'));
    } catch (_) {
      return att.textContent || '';
    }
  }
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

/**
 * Pure Node.js DOCX extractor (reads word/document.xml from PKZip)
 */
function parseDocx(buf) {
  try {
    let offset = 0;
    while (offset < buf.length - 30) {
      if (buf.readUInt32LE(offset) === 0x04034b50) {
        const compMethod = buf.readUInt16LE(offset + 8);
        const compSize = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const fileName = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
        const dataStart = offset + 30 + nameLen + extraLen;

        if (fileName === 'word/document.xml') {
          const compData = buf.slice(dataStart, dataStart + compSize);
          let xml = '';
          if (compMethod === 8) {
            xml = zlib.inflateRawSync(compData).toString('utf8');
          } else {
            xml = compData.toString('utf8');
          }
          const matches = xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
          const text = matches.map((m) => m.replace(/<[^>]+>/g, '')).join(' ');
          return text;
        }
        offset = dataStart + compSize;
      } else {
        offset++;
      }
    }
  } catch (_) {}
  return '';
}

/**
 * Pure Node.js XLSX extractor (reads xl/sharedStrings.xml)
 */
function parseXlsx(buf) {
  try {
    let offset = 0;
    while (offset < buf.length - 30) {
      if (buf.readUInt32LE(offset) === 0x04034b50) {
        const compMethod = buf.readUInt16LE(offset + 8);
        const compSize = buf.readUInt32LE(offset + 18);
        const nameLen = buf.readUInt16LE(offset + 26);
        const extraLen = buf.readUInt16LE(offset + 28);
        const fileName = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
        const dataStart = offset + 30 + nameLen + extraLen;

        if (fileName === 'xl/sharedStrings.xml') {
          const compData = buf.slice(dataStart, dataStart + compSize);
          let xml = '';
          if (compMethod === 8) {
            xml = zlib.inflateRawSync(compData).toString('utf8');
          } else {
            xml = compData.toString('utf8');
          }
          const matches = xml.match(/<t[^>]*>([^<]*)<\/t>/g) || [];
          return matches.map((m) => m.replace(/<[^>]+>/g, '')).join(' | ');
        }
        offset = dataStart + compSize;
      } else {
        offset++;
      }
    }
  } catch (_) {}
  return '';
}

/**
 * Parses legacy Word .doc files
 * Many enterprise tools generate HTML, RTF, or XML saved as .doc
 * If binary CFBF Word, extracts textual streams and strings.
 */
function parseDoc(buf) {
  const utf8 = buf.toString('utf8');

  // Case 1: HTML disguised as .doc
  if (utf8.includes('<html') || utf8.includes('<!DOCTYPE') || utf8.includes('<table') || utf8.includes('<body')) {
    return stripHtml(utf8);
  }

  // Case 2: RTF format
  if (utf8.startsWith('{\\rtf')) {
    return utf8
      .replace(/\\[a-zA-Z]+(-?\d+)?\s?/g, ' ')
      .replace(/[{}\\\r\n]/g, ' ');
  }

  // Case 3: Binary Word Compound File - extract readable paragraphs
  const textBlocks = [];

  // Extract clean ASCII paragraphs
  const asciiMatches = utf8.match(/[\w\s.,;:!?@#%&*()_+\-=/\"'\\[\]{}]{5,}/g) || [];
  asciiMatches.forEach((p) => {
    const clean = p.trim();
    if (clean.length > 6 && !clean.startsWith('Normal.') && !clean.includes('Microsoft Word') && !clean.includes('Root Entry') && !clean.includes('WordDocument') && !clean.includes('CompObj')) {
      textBlocks.push(clean);
    }
  });

  // Extract clean UTF-16LE paragraphs (Word often stores text in 16-bit unicode)
  try {
    const u16 = buf.toString('utf16le');
    const u16Matches = u16.match(/[\w\s.,;:!?@#%&*()_+\-=/\"'\\[\]{}]{5,}/g) || [];
    u16Matches.forEach((p) => {
      const clean = p.trim();
      if (clean.length > 6 && !clean.startsWith('Normal.') && !clean.includes('Microsoft Word') && !clean.includes('Root Entry') && !clean.includes('WordDocument')) {
        textBlocks.push(clean);
      }
    });
  } catch (_) {}

  // Deduplicate and join
  const seen = new Set();
  const unique = [];
  textBlocks.forEach((b) => {
    if (!seen.has(b)) {
      seen.add(b);
      unique.push(b);
    }
  });

  return unique.join('\n');
}

/**
 * Pure Node.js PDF text extractor
 */
function parsePdf(buf) {
  const raw = buf.toString('binary');
  let extracted = [];

  // Look for PDF streams
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match;
  while ((match = streamRegex.exec(raw)) !== null) {
    const streamBytes = Buffer.from(match[1], 'binary');
    let textChunk = '';

    // Try uncompressing flate stream
    try {
      const decompressed = zlib.inflateSync(streamBytes);
      textChunk = decompressed.toString('utf8');
    } catch (_) {
      try {
        const decompressed = zlib.inflateRawSync(streamBytes);
        textChunk = decompressed.toString('utf8');
      } catch (__) {
        textChunk = streamBytes.toString('utf8');
      }
    }

    // Extract text in PDF parentheses e.g. (Hello World) Tj or [(Hello) 20 (World)] TJ
    const tjMatches = textChunk.match(/\(([^)]+)\)\s*Tj/g) || [];
    tjMatches.forEach((t) => {
      const m = t.match(/\(([^)]+)\)/);
      if (m && m[1]) extracted.push(m[1]);
    });

    const tjArrayMatches = textChunk.match(/\[([^\]]+)\]\s*TJ/g) || [];
    tjArrayMatches.forEach((arr) => {
      const inner = arr.match(/\(([^)]+)\)/g) || [];
      const line = inner.map((s) => s.replace(/[()]/g, '')).join('');
      if (line) extracted.push(line);
    });
  }

  if (extracted.length) {
    return extracted.join(' ');
  }

  // Fallback: search for readable text inside the PDF
  const textMatches = raw.match(/\(([\w\s.,;:!?@#%&*()_+\-=/\"'\\[\]{}]{3,})\)/g) || [];
  return textMatches.map((t) => t.replace(/[()]/g, '')).join(' ');
}

function cleanExtractedText(text) {
  if (!text) return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 15000); // 15,000 char maximum to guarantee LLM context window safety
}

module.exports = {
  extractTextFromAttachment,
  cleanExtractedText,
  parseDoc,
  parseDocx,
  parseXlsx,
  parsePdf
};

