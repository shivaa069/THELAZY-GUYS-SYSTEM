import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

export interface FeasibilityData {
  name: string;
  mobile: string;
  email: string;
  applicationNumber: string;
}

function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')   // normalize spaces
    .replace(/\n/g, ' ')
    .trim();
}

export async function extractFeasibilityData(file: File): Promise<FeasibilityData> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();

  const fullText = cleanText(
    (textContent.items as any[])
      .map((item) => item.str)
      .join(' ')
  );

  // 🔹 NAME (more flexible)
  let name = '';
  const nameMatch = fullText.match(
    /Name\s*of\s*Applicant\s*[:\-]?\s*(.+?)(?=\s*(Mobile|Email|Application|Date))/i
  );
  if (nameMatch) {
    name = nameMatch[1].trim();
  }

  // fallback
  if (!name) {
    const alt = fullText.match(/Sh\/Smt\.?\s*([A-Za-z\s]+)/i);
    if (alt) name = alt[1].trim();
  }

  // 🔹 MOBILE
  let mobile = '';
  const mobileMatch = fullText.match(
    /(Mobile\s*No\.?|Mob\.?)\s*[:\-]?\s*(\d{10})/i
  );
  if (mobileMatch) {
    mobile = mobileMatch[2];
  }

  // 🔹 EMAIL
  let email = '';
  const emailMatch = fullText.match(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,})/i
  );
  if (emailMatch) {
    email = emailMatch[1];
  }

  // 🔹 APPLICATION NUMBER
  let applicationNumber = '';
  const appMatch = fullText.match(
    /(Application\s*Reference\s*Number|Ref\s*No\.?)\s*[:\-]?\s*(NP-[A-Z0-9-]+)/i
  );
  if (appMatch) {
    applicationNumber = appMatch[2];
  } else {
    const fallback = fullText.match(/NP-[A-Z0-9-]+/);
    if (fallback) applicationNumber = fallback[0];
  }

  return {
    name,
    mobile,
    email,
    applicationNumber,
  };
}