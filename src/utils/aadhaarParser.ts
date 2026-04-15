import jsQR from 'jsqr';
import Tesseract from 'tesseract.js';

export interface AadhaarData {
  name: string;
  address: string;
  dob?: string;
  gender?: string;
  extractionMethod?: 'qr' | 'ocr';
}

/**
 * Preprocess image for better OCR accuracy:
 * grayscale, contrast boost, noise reduction
 */
function preprocessImage(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Convert to grayscale + contrast boost
  for (let i = 0; i < data.length; i += 4) {
    let gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    
    // Contrast stretch (1.5x)
    gray = ((gray - 128) * 1.5) + 128;
    gray = Math.max(0, Math.min(255, gray));
    
    // Threshold for noise reduction (binarize if close to black/white)
    if (gray < 80) gray = 0;
    else if (gray > 180) gray = 255;
    
    data[i] = data[i + 1] = data[i + 2] = gray;
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Decode QR code from an Aadhaar card image.
 */
async function decodeQRFromImage(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const attempts = [
        { w: img.width, h: img.height },
        { w: img.width * 2, h: img.height * 2 },
        { w: Math.max(img.width, 1200), h: Math.max(img.height, 800) },
      ];

      for (const { w, h } of attempts) {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (code?.data) {
          resolve(code.data);
          return;
        }
      }
      resolve(null);
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Parse Aadhaar QR data (XML or text-based formats).
 */
function parseAadhaarQRData(rawData: string): AadhaarData {
  // Format 1: XML-based QR
  if (rawData.includes('<PrintLetterBarcodeData') || rawData.includes('uid=')) {
    const getName = rawData.match(/name="([^"]+)"/i);
    const getGender = rawData.match(/gender="([^"]+)"/i);
    const getDob = rawData.match(/(?:dob|yob)="([^"]+)"/i);
    const getHouse = rawData.match(/house="([^"]+)"/i);
    const getStreet = rawData.match(/street="([^"]+)"/i);
    const getLm = rawData.match(/lm="([^"]+)"/i);
    const getLoc = rawData.match(/loc="([^"]+)"/i);
    const getVtc = rawData.match(/vtc="([^"]+)"/i);
    const getDist = rawData.match(/dist="([^"]+)"/i);
    const getState = rawData.match(/state="([^"]+)"/i);
    const getPc = rawData.match(/pc="([^"]+)"/i);
    const getPo = rawData.match(/po="([^"]+)"/i);

    const addressParts = [
      getHouse?.[1], getStreet?.[1], getLm?.[1], getLoc?.[1],
      getPo?.[1], getVtc?.[1], getDist?.[1], getState?.[1], getPc?.[1],
    ].filter(Boolean);

    return {
      name: getName?.[1] || '',
      address: addressParts.join(', '),
      dob: getDob?.[1] || undefined,
      gender: getGender?.[1] || undefined,
      extractionMethod: 'qr',
    };
  }

  // Format 2: Newer text-delimited QR
  const lines = rawData.split(/[\n\r]+/).filter(l => l.trim());
  if (lines.length >= 4) {
    let name = '';
    let address = '';
    let dob: string | undefined;
    let gender: string | undefined;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d{2}[\/-]\d{2}[\/-]\d{4}$/.test(trimmed) || /^\d{4}$/.test(trimmed)) { dob = trimmed; continue; }
      if (/^(M|F|Male|Female|T|Transgender)$/i.test(trimmed)) { gender = trimmed; continue; }
      if (/^\d{6}$/.test(trimmed)) { address = address ? address + ' ' + trimmed : trimmed; continue; }
      if (/^\d{12}$/.test(trimmed)) continue;
      if (/^\d{16}$/.test(trimmed)) continue;
      if (!name && trimmed.length > 1) { name = trimmed; continue; }
      address = address ? address + ', ' + trimmed : trimmed;
    }

    if (name) return { name, address, dob, gender, extractionMethod: 'qr' };
  }

  // Format 3: Comma/pipe separated
  const parts = rawData.split(/[|,]/).map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { name: parts[0], address: parts.slice(1).join(', '), extractionMethod: 'qr' };
  }

  return { name: rawData.substring(0, 100), address: '', extractionMethod: 'qr' };
}

/**
 * OCR fallback: Extract name & address from Aadhaar image using Tesseract.js
 */
async function extractViaOCR(
  file: File,
  onStatus?: (msg: string) => void
): Promise<AadhaarData> {
  onStatus?.('Preprocessing image for OCR...');

  // Create preprocessed canvas
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const canvas = document.createElement('canvas');
  const scale = Math.max(1, 2000 / Math.max(img.width, img.height));
  canvas.width = img.width * scale;
  canvas.height = img.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  preprocessImage(canvas, ctx);

  onStatus?.('Running OCR (this may take a moment)...');

  const blob = await new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => resolve(b!), 'image/png');
  });

  const { data } = await Tesseract.recognize(blob, 'eng+hin', {
    logger: (m) => {
      if (m.status === 'recognizing text' && m.progress) {
        onStatus?.(`OCR Progress: ${Math.round(m.progress * 100)}%`);
      }
    },
  });

  const text = data.text;
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 1);

  let name = '';
  let address = '';
  let dob: string | undefined;
  let gender: string | undefined;

  for (const line of lines) {
    // Skip noise lines
    if (/^(government|भारत|india|aadhaar|unique|authority|enrol|vid|help)/i.test(line)) continue;
    if (/\d{4}\s?\d{4}\s?\d{4}/.test(line)) continue; // UID
    
    // DOB
    const dobMatch = line.match(/(\d{2}[\/-]\d{2}[\/-]\d{4})/);
    if (dobMatch) { dob = dobMatch[1]; continue; }
    
    // Gender
    if (/\b(male|female|पुरुष|महिला|transgender)\b/i.test(line)) {
      const gm = line.match(/\b(male|female|transgender|पुरुष|महिला)\b/i);
      if (gm) gender = gm[1];
      continue;
    }
    
    // Name: first substantial text line with mostly letters
    if (!name && /^[A-Za-z\s]{3,}$/.test(line) && !/^(address|father|husband|mother|son|daughter|dob|date)/i.test(line)) {
      name = line;
      continue;
    }
    
    // Address: lines with location patterns
    if (line.match(/\d{6}/) || /\b(dist|state|village|town|city|po|ps|ward|block|nagar|pur|guda|street|road|lane)\b/i.test(line)) {
      address = address ? address + ', ' + line : line;
    }
  }

  // If no structured address found, grab lines after name
  if (!address && name) {
    const nameIdx = lines.findIndex(l => l === name);
    if (nameIdx >= 0) {
      const addrLines = lines.slice(nameIdx + 1).filter(l =>
        !/^(government|भारत|india|aadhaar|unique|authority|enrol|vid|help|\d{4}\s?\d{4}\s?\d{4})/i.test(l)
      ).slice(0, 4);
      address = addrLines.join(', ');
    }
  }

  return { name, address, dob, gender, extractionMethod: 'ocr' };
}

/**
 * Main: Extract Aadhaar data — QR first, OCR fallback.
 */
export async function extractAadhaarData(
  file: File,
  onStatus?: (msg: string) => void
): Promise<AadhaarData> {
  onStatus?.('Scanning for QR code...');
  const qrData = await decodeQRFromImage(file);
  
  if (qrData) {
    onStatus?.('QR code detected!');
    return parseAadhaarQRData(qrData);
  }

  onStatus?.('QR not detected, switching to text parsing...');
  return extractViaOCR(file, onStatus);
}
