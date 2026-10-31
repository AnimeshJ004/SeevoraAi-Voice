'use strict';

const zlib = require('zlib');

/**
 * Universal High-Fidelity Document Text & Structure Extractor for AI Assistant
 * Supports: .docx, .doc, .xlsx, .xls, .pdf, .txt, .csv, .json, .tsv, .md, .xml, .html
 * Preserves paragraphs, headings, bullet lists, markdown tables, and metadata.
 */

function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCharCode(parseInt(n, 10)); } catch (_) { return ''; }
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCharCode(parseInt(h, 16)); } catch (_) { return ''; }
    });
}

/**
 * Robust ZIP entry extractor (PKZip format).
 * Prioritizes Central Directory for 100% reliability with streamed/data-descriptor DOCX & XLSX files,
 * with graceful fallback to Local File Headers.
 */
function readZipEntries(buf) {
  const entries = new Map();
  if (!Buffer.isBuffer(buf) || buf.length < 22) return entries;

  // 1. Scan Central Directory (always accurate, even with Data Descriptors)
  try {
    let eocdOffset = -1;
    const maxSearch = Math.min(buf.length - 22, 65557);
    for (let i = buf.length - 22; i >= buf.length - maxSearch; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset !== -1) {
      const cdOffset = buf.readUInt32LE(eocdOffset + 16);
      const cdEntriesCount = buf.readUInt16LE(eocdOffset + 10);
      let p = cdOffset;
      for (let i = 0; i < cdEntriesCount && p < eocdOffset; i++) {
        if (buf.readUInt32LE(p) !== 0x02014b50) break;
        const compMethod = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const uncompSize = buf.readUInt32LE(p + 24);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const commentLen = buf.readUInt16LE(p + 32);
        const localHeaderOffset = buf.readUInt32LE(p + 42);
        const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

        if (localHeaderOffset < buf.length - 30 && buf.readUInt32LE(localHeaderOffset) === 0x04034b50) {
          const locNameLen = buf.readUInt16LE(localHeaderOffset + 26);
          const locExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
          const dataStart = localHeaderOffset + 30 + locNameLen + locExtraLen;
          if (dataStart + compSize <= buf.length) {
            entries.set(name, {
              compMethod,
              compSize,
              uncompSize,
              data: buf.slice(dataStart, dataStart + compSize)
            });
          }
        }
        p += 46 + nameLen + extraLen + commentLen;
      }
    }
  } catch (_) {}

  // 2. Fallback: Local File Headers (if Central Directory was missing or corrupted)
  if (entries.size === 0) {
    try {
      let offset = 0;
      while (offset < buf.length - 30) {
        if (buf.readUInt32LE(offset) === 0x04034b50) {
          const compMethod = buf.readUInt16LE(offset + 8);
          let compSize = buf.readUInt32LE(offset + 18);
          const nameLen = buf.readUInt16LE(offset + 26);
          const extraLen = buf.readUInt16LE(offset + 28);
          const fileName = buf.toString('utf8', offset + 30, offset + 30 + nameLen);
          const dataStart = offset + 30 + nameLen + extraLen;

          if (compSize === 0) {
            // Data descriptor bit was set, scan for next signature
            let nextSig = -1;
            for (let j = dataStart + 4; j < buf.length - 4; j++) {
              const sig = buf.readUInt32LE(j);
              if (sig === 0x04034b50 || sig === 0x02014b50 || sig === 0x08074b50) {
                nextSig = j;
                break;
              }
            }
            if (nextSig !== -1) compSize = nextSig - dataStart;
          }

          if (compSize > 0 && dataStart + compSize <= buf.length) {
            entries.set(fileName, {
              compMethod,
              compSize,
              data: buf.slice(dataStart, dataStart + compSize)
            });
          }
          offset = dataStart + Math.max(compSize, 1);
        } else {
          offset++;
        }
      }
    } catch (_) {}
  }

  return entries;
}

function decompressZipEntry(entry) {
  if (!entry || !entry.data) return null;
  try {
    if (entry.compMethod === 8) {
      return zlib.inflateRawSync(entry.data);
    } else if (entry.compMethod === 0) {
      return entry.data;
    }
  } catch (_) {
    try {
      return zlib.inflateSync(entry.data);
    } catch (__) {}
  }
  return null;
}

/**
 * Transforms Word XML into richly formatted Markdown (preserving headings, tables, bullets, and paragraphs)
 */
function wordXmlToFormattedMarkdown(xml) {
  if (!xml) return '';

  // 1. Transform tables into clean Markdown table rows
  let clean = xml.replace(/<w:tbl[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const rows = [];
    const trMatches = tbl.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    for (const tr of trMatches) {
      const tcMatches = tr.match(/<w:tc[\s\S]*?<\/w:tc>/g) || [];
      const cells = tcMatches.map((tc) => {
        const textParts = [];
        const tMatches = tc.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
        for (const tm of tMatches) {
          const m = tm.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
          if (m) textParts.push(decodeXmlEntities(m[1]));
        }
        return textParts.join('').trim().replace(/\r?\n/g, ' ');
      });
      if (cells.some((c) => c.length > 0)) {
        rows.push('| ' + cells.join(' | ') + ' |');
      }
    }
    return rows.length ? '\n\n' + rows.join('\n') + '\n\n' : '';
  });

  // 2. Format paragraphs, headings, bullet points, tabs, and line breaks
  clean = clean.replace(/<w:p[\s\S]*?<\/w:p>/g, (p) => {
    let prefix = '';
    if (/<w:pStyle\s+w:val=\"(?:Title|Subtitle|Heading1)\"/i.test(p)) {
      prefix = '\n### ';
    } else if (/<w:pStyle\s+w:val=\"Heading[2345]\"/i.test(p)) {
      prefix = '\n#### ';
    } else if (/<w:numPr/i.test(p)) {
      prefix = '- ';
    }

    // Line breaks inside paragraph
    p = p.replace(/<w:br[^>]*\/>|<w:cr[^>]*\/>/g, '\n');
    p = p.replace(/<w:tab[^>]*\/>/g, '\t');

    const parts = [];
    const tMatches = p.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [];
    for (const tm of tMatches) {
      const m = tm.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
      if (m) parts.push(decodeXmlEntities(m[1]));
    }
    const paraText = parts.join('');
    if (!paraText.trim()) return '';
    return prefix + paraText + '\n';
  });

  // 3. Fallback tag cleanup
  return clean
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * High-fidelity DOCX extractor
 */
function parseDocx(buf) {
  try {
    const entries = readZipEntries(buf);
    const sections = [];

    // Document Body
    const mainDocEntry = entries.get('word/document.xml') || entries.get('word/document2.xml');
    if (mainDocEntry) {
      const xmlBuf = decompressZipEntry(mainDocEntry);
      if (xmlBuf) {
        const text = wordXmlToFormattedMarkdown(xmlBuf.toString('utf8'));
        if (text) sections.push(text);
      }
    }

    // Headers & Footers
    for (const [name, entry] of entries) {
      if (name.startsWith('word/header') || name.startsWith('word/footer') || name === 'word/footnotes.xml') {
        const xmlBuf = decompressZipEntry(entry);
        if (xmlBuf) {
          const text = wordXmlToFormattedMarkdown(xmlBuf.toString('utf8'));
          if (text && text.length > 5 && !sections.includes(text)) {
            sections.push(`[${name.replace('word/', '')}]: ${text}`);
          }
        }
      }
    }

    if (sections.length > 0) {
      return sections.join('\n\n');
    }

    // Fallback: raw scan for <w:t> tags anywhere in buffer
    const raw = buf.toString('utf8');
    const matches = raw.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
    if (matches.length > 0) {
      return matches.map((m) => decodeXmlEntities(m.replace(/<[^>]+>/g, ''))).join(' ');
    }
  } catch (_) {}
  return '';
}

/**
 * High-fidelity XLSX extractor
 */
function parseXlsx(buf) {
  try {
    const entries = readZipEntries(buf);
    // 1. Parse shared strings lookup table
    const sharedStrings = [];
    const ssEntry = entries.get('xl/sharedStrings.xml');
    if (ssEntry) {
      const ssBuf = decompressZipEntry(ssEntry);
      if (ssBuf) {
        const xml = ssBuf.toString('utf8');
        const siMatches = xml.match(/<si[\s\S]*?<\/si>/g) || [];
        for (const si of siMatches) {
          const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
          const str = tMatches.map((m) => {
            const inner = m.match(/<t[^>]*>([\s\S]*?)<\/t>/);
            return inner ? decodeXmlEntities(inner[1]) : '';
          }).join('');
          sharedStrings.push(str.trim());
        }
      }
    }

    // 2. Parse worksheets
    const sheetTexts = [];
    for (const [name, entry] of entries) {
      if (name.startsWith('xl/worksheets/sheet') && name.endsWith('.xml')) {
        const sBuf = decompressZipEntry(entry);
        if (!sBuf) continue;
        const xml = sBuf.toString('utf8');
        const rows = [];
        const rowMatches = xml.match(/<row[\s\S]*?<\/row>/g) || [];
        for (const row of rowMatches) {
          const cells = [];
          const cMatches = row.match(/<c[\s\S]*?<\/c>|<c[^\/>]*\/>/g) || [];
          for (const c of cMatches) {
            const isShared = /t="s"/i.test(c);
            const valMatch = c.match(/<v>([\s\S]*?)<\/v>/);
            let val = valMatch ? valMatch[1].trim() : '';
            if (isShared && val !== '') {
              const idx = parseInt(val, 10);
              val = sharedStrings[idx] || val;
            }
            cells.push(val);
          }
          if (cells.some((v) => v.length > 0)) {
            rows.push('| ' + cells.join(' | ') + ' |');
          }
        }
        if (rows.length) {
          sheetTexts.push(rows.join('\n'));
        }
      }
    }

    if (sheetTexts.length > 0) {
      return sheetTexts.join('\n\n---\n\n');
    }

    // Fallback: return shared strings joined
    if (sharedStrings.length > 0) {
      return sharedStrings.join(' | ');
    }
  } catch (_) {}
  return '';
}

/**
 * High-fidelity PDF text extractor
 */
function parsePdf(buf) {
  try {
    const raw = buf.toString('binary');
    const extracted = [];

    // Scan all PDF object streams
    const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
    let match;
    while ((match = streamRegex.exec(raw)) !== null) {
      const streamBytes = Buffer.from(match[1], 'binary');
      let textChunk = '';

      // Decompress flate stream
      try {
        textChunk = zlib.inflateSync(streamBytes).toString('utf8');
      } catch (_) {
        try {
          textChunk = zlib.inflateRawSync(streamBytes).toString('utf8');
        } catch (__) {
          textChunk = streamBytes.toString('utf8');
        }
      }

      // Extract text from (text) Tj
      const tjMatches = textChunk.match(/\(([^)]+)\)\s*Tj/g) || [];
      tjMatches.forEach((t) => {
        const m = t.match(/\(([^)]+)\)/);
        if (m && m[1]) extracted.push(m[1]);
      });

      // Extract text from [(text) 20 (more)] TJ
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

    // Fallback: search for readable text inside parentheses
    const textMatches = raw.match(/\(([\w\s.,;:!?@#%&*()_+\-=/\"'\\[\]{}]{3,})\)/g) || [];
    return textMatches.map((t) => t.replace(/[()]/g, '')).join(' ');
  } catch (_) {}
  return '';
}

/**
 * Parses legacy Word .doc files (CFBF, RTF, HTML disguised as .doc)
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

  // Case 3: Binary Word Compound File
  const textBlocks = [];
  const asciiMatches = utf8.match(/[\w\s.,;:!?@#%&*()_+\-=/\"'\\[\]{}]{5,}/g) || [];
  asciiMatches.forEach((p) => {
    const clean = p.trim();
    if (clean.length > 6 && !clean.startsWith('Normal.') && !clean.includes('Microsoft Word') && !clean.includes('Root Entry') && !clean.includes('WordDocument') && !clean.includes('CompObj')) {
      textBlocks.push(clean);
    }
  });

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

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function cleanExtractedText(text) {
  if (!text) return '';
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 40000); // Expanded up to 40,000 characters for complete document retention
}

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
    if (rawStr.includes('<html') || rawStr.includes('<!DOCTYPE') || rawStr.includes('<table')) {
      return cleanExtractedText(stripHtml(rawStr));
    }
    return cleanExtractedText(rawStr);
  } catch (err) {
    try {
      return cleanExtractedText(Buffer.from(att.dataUrl.split(',')[1] || '', 'base64').toString('utf8'));
    } catch (_) {
      return att.textContent || '';
    }
  }
}

module.exports = {
  extractTextFromAttachment,
  cleanExtractedText,
  parseDoc,
  parseDocx,
  parseXlsx,
  parsePdf
};
