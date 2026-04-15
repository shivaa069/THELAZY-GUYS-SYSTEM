# SriKunj DocGen — Solar Document Automation

## Overview
A React/TypeScript web application that automates solar document generation. Users upload an Aadhaar card (image) or a Solar Feasibility Report (PDF), the app extracts relevant data client-side, and generates professional Quotation and Agreement DOCX files from templates.

## Tech Stack
- **Frontend:** React 18 + TypeScript
- **Build Tool:** Vite
- **Styling:** Tailwind CSS + shadcn/ui (Radix UI primitives)
- **Routing:** React Router DOM v6
- **State:** TanStack Query v5
- **Animations:** Framer Motion
- **Document Generation:** JSZip + file-saver (DOCX template fill)
- **PDF Parsing:** pdfjs-dist
- **QR Decoding:** jsQR (for Aadhaar QR codes)

## Project Structure
```
src/
  App.tsx              # Root app with routing
  main.tsx             # Entry point
  pages/
    Index.tsx          # Main dashboard (upload, extract, generate)
    NotFound.tsx       # 404 page
  components/          # shadcn/ui components + app-specific components
  utils/
    pdfParser.ts       # Extract data from feasibility report PDFs
    aadhaarParser.ts   # Extract data from Aadhaar QR codes
    docxGenerator.ts   # Fill DOCX templates and trigger download
  hooks/               # Custom React hooks
  lib/                 # Utility functions (cn, etc.)
public/
  templates/
    agreement_template.docx
    quotation_template.docx
```

## Running the App
- **Dev:** `npm run dev` (runs on port 5000)
- **Build:** `npm run build`
- **Preview:** `npm run preview`
- **Tests:** `npm run test`

## Key Notes
- All document processing is done entirely client-side (no backend required)
- DOCX generation uses find-and-replace on XML inside zipped .docx templates
- Aadhaar parsing reads QR code from image files
- Feasibility report parsing reads text from PDF pages
- Migrated from Lovable to Replit — removed `lovable-tagger` plugin from Vite config
