import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import type { FeasibilityData } from './pdfParser';
import type { AadhaarData } from './aadhaarParser';

function capitalizeEachWord(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function toAllCaps(text: string): string {
  return text.toUpperCase();
}

function getCurrentDateIndian(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchTemplate(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch template: ${url}`);
  return response.arrayBuffer();
}

function replaceAcrossRuns(xml: string, search: string, replace: string): string {
  if (xml.includes(search)) {
    return xml.split(search).join(replace);
  }

  const escapedSearch = escapeXml(search);
  if (xml.includes(escapedSearch)) {
    return xml.split(escapedSearch).join(escapeXml(replace));
  }

  const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let result = xml;
  let paraMatch;

  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const para = paraMatch[0];
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const tElements: { fullMatch: string; text: string }[] = [];
    let tMatch;

    while ((tMatch = tRegex.exec(para)) !== null) {
      tElements.push({ fullMatch: tMatch[0], text: tMatch[1] });
    }

    const fullText = tElements.map(t => t.text).join('');
    const searchIdx = fullText.indexOf(search);
    if (searchIdx === -1) continue;

    const searchEnd = searchIdx + search.length;
    let charPos = 0;
    let modifiedPara = para;
    let firstFound = false;

    for (let i = 0; i < tElements.length; i++) {
      const tStart = charPos;
      const tEnd = charPos + tElements[i].text.length;
      charPos = tEnd;

      if (tEnd <= searchIdx || tStart >= searchEnd) continue;

      if (!firstFound) {
        firstFound = true;
        const before = tElements[i].text.substring(0, Math.max(0, searchIdx - tStart));
        const after = tEnd > searchEnd ? tElements[i].text.substring(searchEnd - tStart) : '';
        const newText = before + replace + after;
        modifiedPara = modifiedPara.replace(tElements[i].fullMatch, `<w:t xml:space="preserve">${newText}</w:t>`);
      } else {
        const overlapStart = Math.max(0, searchIdx - tStart);
        const overlapEnd = Math.min(tElements[i].text.length, searchEnd - tStart);
        const before = tElements[i].text.substring(0, overlapStart);
        const after = tElements[i].text.substring(overlapEnd);
        const remaining = before + after;
        if (remaining) {
          modifiedPara = modifiedPara.replace(tElements[i].fullMatch, `<w:t xml:space="preserve">${remaining}</w:t>`);
        } else {
          modifiedPara = modifiedPara.replace(tElements[i].fullMatch, '<w:t></w:t>');
        }
      }
    }

    if (modifiedPara !== para) {
      result = result.replace(para, modifiedPara);
      return replaceAcrossRuns(result, search, replace);
    }
  }

  return result;
}

function removeParagraphContaining(xml: string, searchText: string): string {
  const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let match;
  while ((match = paraRegex.exec(xml)) !== null) {
    const para = match[0];
    const plainText = para.replace(/<[^>]+>/g, '');
    if (plainText.includes(searchText)) {
      xml = xml.replace(para, '');
      break;
    }
  }
  return xml;
}

function splitAddressIntoLines(address: string, maxCharsPerLine = 26): string[] {
  const words = address.split(/\s+/).filter(w => w);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine && (currentLine + ' ' + word).length > maxCharsPerLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

function insertLineBreaks(xml: string, fullText: string, lines: string[]): string {
  if (lines.length <= 1) return xml;

  const escapedText = escapeXml(fullText);
  const tRegex = new RegExp(
    `<w:t[^>]*>${escapedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<\/w:t>`,
    'g'
  );

  const multiLineXml = lines
    .map((line, i) => {
      if (i === 0) return `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
      return `<w:br/><w:t xml:space="preserve">${escapeXml(line)}</w:t>`;
    })
    .join('');

  return xml.replace(tRegex, multiLineXml);
}

function cleanupDollarSigns(xml: string): string {
  xml = xml.replace(/<w:t[^>]*>\$<\/w:t>/g, '<w:t></w:t>');
  return xml;
}

// ─── QUOTATION GENERATOR ───────────────────────────────────────────────────────

export async function generateQuotation(
  data: FeasibilityData,
  address: string
): Promise<void> {
  const templateBuffer = await fetchTemplate('/templates/quotation_template.docx');
  const zip = await JSZip.loadAsync(templateBuffer);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('Invalid DOCX template');

  let docXml = await docXmlFile.async('string');

  const date = getCurrentDateIndian();
  const nameCaps = toAllCaps(data.name);
  const addressCapitalized = capitalizeEachWord(address);

  docXml = replaceAcrossRuns(docXml, '$13-03-2026', date);
  docXml = replaceAcrossRuns(docXml, '13-03-2026', date);

  docXml = replaceAcrossRuns(docXml, '$PASTE \u2013NAME-DATA-HERE', nameCaps);
  docXml = replaceAcrossRuns(docXml, '$PASTE -NAME-DATA-HERE', nameCaps);
  docXml = replaceAcrossRuns(docXml, 'PASTE \u2013NAME-DATA-HERE', nameCaps);
  docXml = replaceAcrossRuns(docXml, 'PASTE -NAME-DATA-HERE', nameCaps);

  docXml = replaceAcrossRuns(docXml, '$PASTE-ADRESS-DATA-HERE-ONLY', addressCapitalized);
  docXml = replaceAcrossRuns(docXml, 'PASTE-ADRESS-DATA-HERE-ONLY', addressCapitalized);

  docXml = replaceAcrossRuns(docXml, '$PASTE-MOBILE NUMBER -DATA-HERE', data.mobile);
  docXml = replaceAcrossRuns(docXml, '$PASTE-MOBILE NUMBER-DATA-HERE', data.mobile);
  docXml = replaceAcrossRuns(docXml, 'PASTE-MOBILE NUMBER-DATA-HERE', data.mobile);

  docXml = replaceAcrossRuns(docXml, '$PAST APLLICATION NUMBER HERE', data.applicationNumber);
  docXml = replaceAcrossRuns(docXml, 'PAST APLLICATION NUMBER HERE', data.applicationNumber);

  if (data.email && data.email.trim()) {
    docXml = replaceAcrossRuns(docXml, '$PASTE IF IN FEASIBILTY EMAIL IS PRESENT IF NOT REMOVE THIS LINE ASAP', data.email);
    docXml = replaceAcrossRuns(docXml, 'PASTE IF IN FEASIBILTY EMAIL IS PRESENT IF NOT REMOVE THIS LINE ASAP', data.email);
  } else {
    docXml = removeParagraphContaining(docXml, 'PASTE IF IN FEASIBILTY EMAIL IS PRESENT');
    docXml = removeParagraphContaining(docXml, 'E-Mail');
    docXml = removeParagraphContaining(docXml, 'E-mail');
  }

  const addressLines = splitAddressIntoLines(addressCapitalized);
  docXml = insertLineBreaks(docXml, addressCapitalized, addressLines);

  docXml = cleanupDollarSigns(docXml);

  zip.file('word/document.xml', docXml);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  saveAs(blob, 'quotation.docx');
}

// Removes underline formatting (<w:u .../>) from the run containing the first
// occurrence of searchText in the DOCX XML — leaves all other underlines intact.
function removeUnderlineFromFirstOccurrence(xml: string, searchText: string): string {
  const textIdx = xml.indexOf(searchText);
  if (textIdx === -1) return xml;

  // Walk backwards to find the opening <w:r> or <w:r > of the enclosing run
  let runStart = -1;
  for (let i = textIdx; i >= 0; i--) {
    if (xml[i] === '<' && xml.substring(i, i + 4) === '<w:r' &&
        (xml[i + 4] === '>' || xml[i + 4] === ' ')) {
      runStart = i;
      break;
    }
  }
  if (runStart === -1) return xml;

  const runEnd = xml.indexOf('</w:r>', textIdx);
  if (runEnd === -1) return xml;

  const fullRunEnd = runEnd + '</w:r>'.length;
  const runXml = xml.substring(runStart, fullRunEnd);

  // Strip every <w:u .../> or <w:u/> inside this run's rPr
  const cleanedRun = runXml.replace(/<w:u[^>]*\/>/g, '');

  return xml.substring(0, runStart) + cleanedRun + xml.substring(fullRunEnd);
}

// ─── AGREEMENT GENERATOR ───────────────────────────────────────────────────────

export interface AgreementInput {
  name: string;
  address: string;
}

export async function generateAgreement(
  data: AgreementInput,
  address: string
): Promise<void> {
  const templateBuffer = await fetchTemplate('/templates/agreement_template.docx');
  const zip = await JSZip.loadAsync(templateBuffer);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) throw new Error('Invalid DOCX template');

  let docXml = await docXmlFile.async('string');

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = String(now.getFullYear());
  const date = `${dd}-${mm}-${yyyy}`;

  const nameCaps = toAllCaps(data.name);
  const addressCapitalized = capitalizeEachWord(address);
  const addressAllCaps = toAllCaps(address);

  docXml = replaceAcrossRuns(docXml, '19 (Day) 02 (Month) 2026', `${dd} (Day) ${mm} (Month) ${yyyy}`);
  docXml = replaceAcrossRuns(docXml, '19 (Day', `${dd} (Day`);
  docXml = replaceAcrossRuns(docXml, ') 02 (M', `) ${mm} (M`);

  docXml = replaceAcrossRuns(docXml, 'KUNI DEVI', nameCaps);

  docXml = replaceAcrossRuns(docXml, 'SUBADRA VIHAR, PARALAKHEMUNDI', addressCapitalized);
  docXml = replaceAcrossRuns(docXml, ', Gajapati', '');

  docXml = replaceAcrossRuns(docXml, 'Name: PARAMA JYOTI KAIBARTA', `Name: ${nameCaps}`);

  docXml = replaceAcrossRuns(docXml, 'Address: OLATUNGA BALABHADRAPUR', `Address: ${addressAllCaps}`);
  docXml = replaceAcrossRuns(docXml, 'KORKARA DIST BHADRAK', '');
  docXml = replaceAcrossRuns(docXml, 'ODISHA 756115', '');

  const addressLines = splitAddressIntoLines(addressAllCaps);
  docXml = insertLineBreaks(docXml, addressAllCaps, addressLines);

  docXml = replaceAcrossRuns(docXml, 'Date: 09-04-2026', `Date: ${date}`);
  docXml = replaceAcrossRuns(docXml, 'Date: 09-04-2026', `Date: ${date}`);

  // Remove underline from the date and company address (first occurrences only)
  docXml = removeUnderlineFromFirstOccurrence(docXml, '(Day)');
  docXml = removeUnderlineFromFirstOccurrence(docXml, '(Month)');
  docXml = removeUnderlineFromFirstOccurrence(docXml, '(Year)');
  docXml = removeUnderlineFromFirstOccurrence(docXml, 'Plot No');

  docXml = cleanupDollarSigns(docXml);

  zip.file('word/document.xml', docXml);
  const blob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  saveAs(blob, 'agreement.docx');
}
