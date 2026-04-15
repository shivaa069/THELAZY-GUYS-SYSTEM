import { jsPDF } from 'jspdf';

export interface ScannedPage {
  id: string;
  originalFile: File;
  previewUrl: string;
  processedUrl: string;
  cropArea?: { x: number; y: number; w: number; h: number };
}

/**
 * Process a single image: enhance for document quality.
 * Returns a processed data URL.
 */
export async function processDocumentImage(
  file: File,
  cropArea?: { x: number; y: number; w: number; h: number }
): Promise<string> {
  const img = await loadImage(file);
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;

  if (cropArea) {
    canvas.width = cropArea.w;
    canvas.height = cropArea.h;
    ctx.drawImage(img, cropArea.x, cropArea.y, cropArea.w, cropArea.h, 0, 0, cropArea.w, cropArea.h);
  } else {
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
  }

  // Enhancement pipeline
  applyGrayscale(canvas, ctx);
  applyContrastAndSharpening(canvas, ctx);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function applyGrayscale(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = gray;
  }
  ctx.putImageData(imageData, 0, 0);
}

function applyContrastAndSharpening(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  const w = canvas.width;
  const h = canvas.height;

  // Contrast enhancement (adaptive threshold-like)
  // Calculate histogram for auto-levels
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] < min) min = d[i];
    if (d[i] > max) max = d[i];
  }
  
  const range = max - min || 1;
  for (let i = 0; i < d.length; i += 4) {
    let val = ((d[i] - min) / range) * 255;
    // Extra contrast push
    val = ((val - 128) * 1.3) + 128;
    val = Math.max(0, Math.min(255, val));
    d[i] = d[i + 1] = d[i + 2] = val;
  }

  // Simple unsharp mask (sharpen)
  const copy = new Uint8ClampedArray(d);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const center = copy[idx];
      const neighbors = (
        copy[((y - 1) * w + x) * 4] +
        copy[((y + 1) * w + x) * 4] +
        copy[(y * w + x - 1) * 4] +
        copy[(y * w + x + 1) * 4]
      ) / 4;
      const sharpened = center + (center - neighbors) * 0.5;
      d[idx] = d[idx + 1] = d[idx + 2] = Math.max(0, Math.min(255, sharpened));
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Generate a clean PDF from processed images.
 */
export async function generateScannedPDF(processedUrls: string[]): Promise<void> {
  if (processedUrls.length === 0) throw new Error('No images to process');

  // Determine page size from first image
  const firstImg = await loadImageFromUrl(processedUrls[0]);
  const isPortrait = firstImg.height >= firstImg.width;
  
  const pdf = new jsPDF({
    orientation: isPortrait ? 'portrait' : 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  for (let i = 0; i < processedUrls.length; i++) {
    if (i > 0) pdf.addPage();

    const img = await loadImageFromUrl(processedUrls[i]);
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    
    const imgAspect = img.width / img.height;
    const pageAspect = pageW / pageH;
    
    let drawW: number, drawH: number, drawX: number, drawY: number;
    
    if (imgAspect > pageAspect) {
      drawW = pageW;
      drawH = pageW / imgAspect;
      drawX = 0;
      drawY = (pageH - drawH) / 2;
    } else {
      drawH = pageH;
      drawW = pageH * imgAspect;
      drawX = (pageW - drawW) / 2;
      drawY = 0;
    }
    
    pdf.addImage(processedUrls[i], 'JPEG', drawX, drawY, drawW, drawH);
  }

  pdf.save('scanned_document.pdf');
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
