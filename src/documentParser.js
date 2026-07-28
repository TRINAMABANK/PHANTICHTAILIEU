import * as pdfjsLib from 'pdfjs-dist';
import mammoth from 'mammoth';
import JSZip from 'jszip';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

/**
 * Format bytes to human readable format (e.g., 2.4 MB)
 */
export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Parse uploaded files (.pdf, .docx, .doc, .pptx, .ppt, .txt, .md)
 */
export async function parseDocumentFile(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  let textContent = '';
  let formatLabel = extension.toUpperCase();

  try {
    if (extension === 'pdf') {
      textContent = await parsePDF(file);
      formatLabel = 'PDF';
    } else if (extension === 'docx') {
      textContent = await parseDocx(file);
      formatLabel = 'Word (DOCX)';
    } else if (extension === 'doc') {
      textContent = await parseBinaryDocOrPpt(file);
      formatLabel = 'Word (DOC)';
    } else if (extension === 'pptx') {
      textContent = await parsePptx(file);
      formatLabel = 'PowerPoint (PPTX)';
    } else if (extension === 'ppt') {
      textContent = await parseBinaryDocOrPpt(file);
      formatLabel = 'PowerPoint (PPT)';
    } else if (extension === 'txt' || extension === 'md') {
      textContent = await parseTextFile(file);
      formatLabel = extension === 'md' ? 'Markdown' : 'TXT';
    } else {
      throw new Error(`Định dạng file .${extension} chưa được hỗ trợ.`);
    }

    if (!textContent || textContent.trim().length === 0) {
      textContent = `(Tài liệu ${file.name} không trích xuất được chữ hoặc là file quét ảnh)`;
    }

    return {
      id: 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      name: file.name,
      size: file.size,
      sizeFormatted: formatBytes(file.size),
      extension: extension,
      formatLabel: formatLabel,
      content: textContent,
      uploadedAt: new Date().toISOString()
    };
  } catch (err) {
    console.error(`Lỗi đọc file ${file.name}:`, err);
    throw err;
  }
}

/**
 * Extract text from PDF using PDF.js
 */
async function parsePDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    if (pageText.trim()) {
      fullText += `[Trang ${i}]\n${pageText}\n\n`;
    }
  }

  return fullText.trim();
}

/**
 * Extract text from DOCX using Mammoth or XML fallback
 */
async function parseDocx(file) {
  const arrayBuffer = await file.arrayBuffer();
  try {
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    if (result.value && result.value.trim().length > 0) {
      return result.value.trim();
    }
  } catch (e) {
    console.warn('Mammoth parsing failed, falling back to JSZip xml parser:', e);
  }

  // Fallback to unzipping document.xml directly
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file('word/document.xml')?.async('text');
  if (docXml) {
    return extractTextFromXML(docXml);
  }
  return '';
}

/**
 * Extract text from PPTX files using JSZip to parse slide XMLs
 */
async function parsePptx(file) {
  const arrayBuffer = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  let slideTexts = [];
  const slideFiles = [];

  zip.forEach((relativePath) => {
    if (relativePath.startsWith('ppt/slides/slide') && relativePath.endsWith('.xml')) {
      slideFiles.push(relativePath);
    }
  });

  slideFiles.sort((a, b) => {
    const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
    const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
    return numA - numB;
  });

  for (let i = 0; i < slideFiles.length; i++) {
    const slideXml = await zip.file(slideFiles[i]).async('text');
    const text = extractTextFromXML(slideXml);
    if (text.trim()) {
      slideTexts.push(`[Slide ${i + 1}]\n${text}`);
    }
  }

  return slideTexts.join('\n\n');
}

/**
 * Extract printable text strings from XML (<a:t> or <w:t> tags)
 */
function extractTextFromXML(xmlStr) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
  const textNodes = xmlDoc.getElementsByTagName('*');
  let result = [];

  for (let i = 0; i < textNodes.length; i++) {
    const node = textNodes[i];
    if (node.nodeName.endsWith(':t') || node.nodeName === 't') {
      if (node.textContent && node.textContent.trim()) {
        result.push(node.textContent.trim());
      }
    }
  }

  if (result.length > 0) {
    return result.join(' ');
  }

  return xmlStr.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse binary legacy files (.doc, .ppt) by extracting printable text strings
 */
async function parseBinaryDocOrPpt(file) {
  const arrayBuffer = await file.arrayBuffer();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const rawString = decoder.decode(arrayBuffer);

  const matches = rawString.match(/[\p{L}\p{N}\s,.?!:;'"()/-]{4,}/gu);
  if (matches && matches.length > 0) {
    const cleanLines = matches
      .map(s => s.trim())
      .filter(s => s.length > 5 && !s.includes('\x00') && !s.startsWith('Root Entry'));
    return cleanLines.join('\n');
  }

  return `(Tài liệu nhị phân ${file.name})`;
}

/**
 * Extract plain text
 */
function parseTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file);
  });
}
