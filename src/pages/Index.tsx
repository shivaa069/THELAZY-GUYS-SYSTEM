import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileText, Download, Sun, CheckCircle2, AlertCircle, Loader2, Zap, Edit3, CreditCard, FileSearch, ScanLine, X, RotateCcw, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { extractFeasibilityData, type FeasibilityData } from '@/utils/pdfParser';
import { extractAadhaarData, type AadhaarData } from '@/utils/aadhaarParser';
import { generateQuotation, generateAgreement } from '@/utils/docxGenerator';
import { processDocumentImage, generateScannedPDF } from '@/utils/documentScanner';

type InputMode = 'aadhaar' | 'feasibility' | 'scanner';

interface ScannerImage {
  id: string;
  file: File;
  previewUrl: string;
  processedUrl?: string;
}

const Index = () => {
  const [mode, setMode] = useState<InputMode>('feasibility');

  // Feasibility state
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [extractedData, setExtractedData] = useState<FeasibilityData | null>(null);
  const [editedData, setEditedData] = useState<FeasibilityData | null>(null);

  // Aadhaar state
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null);
  const [editedAadhaar, setEditedAadhaar] = useState<AadhaarData | null>(null);
  const [aadhaarStatus, setAadhaarStatus] = useState<string>('');

  // Scanner state
  const [scanImages, setScanImages] = useState<ScannerImage[]>([]);
  const [isProcessingScans, setIsProcessingScans] = useState(false);
  const [scansProcessed, setScansProcessed] = useState(false);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Common state
  const [address, setAddress] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const resetAll = () => {
    setPdfFile(null);
    setExtractedData(null);
    setEditedData(null);
    setAadhaarFile(null);
    setEditedAadhaar(null);
    setAadhaarStatus('');
    setScanImages([]);
    setScansProcessed(false);
    setAddress('');
    setGenerated(false);
  };

  const handleModeSwitch = (newMode: InputMode) => {
    if (newMode !== mode) {
      resetAll();
      setMode(newMode);
    }
  };

  // ─── Feasibility handlers ───
  const handleFeasibilitySelect = useCallback(async (file: File) => {
    if (file.type !== 'application/pdf') { toast.error('Please upload a PDF file'); return; }
    setPdfFile(file);
    setExtractedData(null);
    setEditedData(null);
    setGenerated(false);
    setIsExtracting(true);
    try {
      const data = await extractFeasibilityData(file);
      setExtractedData(data);
      setEditedData({ ...data });
      if (!data.name || !data.applicationNumber) toast.warning('Some fields could not be extracted. Please edit below.');
      else toast.success('Data extracted! You can edit fields before generating.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to parse PDF. Please check the file.');
    } finally {
      setIsExtracting(false);
    }
  }, []);

  // ─── Aadhaar handlers ───
  const handleAadhaarSelect = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please upload an image file (JPG, PNG, etc.)'); return; }
    setAadhaarFile(file);
    setEditedAadhaar(null);
    setAadhaarStatus('');
    setGenerated(false);
    setIsExtracting(true);
    try {
      const data = await extractAadhaarData(file, (msg) => setAadhaarStatus(msg));
      setEditedAadhaar({ ...data });
      setAddress(data.address || '');
      if (data.extractionMethod === 'ocr') {
        toast.info('QR not detected — extracted via OCR. Please verify the data.');
      } else if (!data.name) {
        toast.warning('Name could not be extracted. Please enter manually.');
      } else {
        toast.success('Aadhaar data extracted via QR! Review and edit.');
      }
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Failed to extract data from image.');
    } finally {
      setIsExtracting(false);
      setAadhaarStatus('');
    }
  }, []);

  // ─── Scanner handlers ───
  const handleScannerFiles = useCallback((files: FileList) => {
    const newImages: ScannerImage[] = [];
    const maxFiles = 10 - scanImages.length;
    for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      newImages.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }
    if (newImages.length === 0) { toast.error('Please upload image files'); return; }
    setScanImages(prev => [...prev, ...newImages]);
    setScansProcessed(false);
    toast.success(`${newImages.length} image(s) added`);
  }, [scanImages.length]);

  const removeScanImage = (id: string) => {
    setScanImages(prev => prev.filter(img => img.id !== id));
    setScansProcessed(false);
  };

  const processAndGeneratePDF = async () => {
    if (scanImages.length === 0) { toast.error('Please add images first'); return; }
    setIsProcessingScans(true);
    try {
      const processedUrls: string[] = [];
      for (let i = 0; i < scanImages.length; i++) {
        toast.info(`Processing image ${i + 1} of ${scanImages.length}...`);
        const url = await processDocumentImage(scanImages[i].file);
        processedUrls.push(url);
        setScanImages(prev =>
          prev.map(img => img.id === scanImages[i].id ? { ...img, processedUrl: url } : img)
        );
      }
      await generateScannedPDF(processedUrls);
      setScansProcessed(true);
      toast.success('Scanned PDF generated!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to generate scanned PDF');
    } finally {
      setIsProcessingScans(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (mode === 'scanner') {
      handleScannerFiles(e.dataTransfer.files);
      return;
    }
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (mode === 'aadhaar') handleAadhaarSelect(file);
    else handleFeasibilitySelect(file);
  }, [mode, handleAadhaarSelect, handleFeasibilitySelect, handleScannerFiles]);

  const updateFeasibilityField = (field: keyof FeasibilityData, value: string) => {
    setEditedData(prev => prev ? { ...prev, [field]: value } : null);
  };

  const updateAadhaarField = (field: keyof AadhaarData, value: string) => {
    setEditedAadhaar(prev => prev ? { ...prev, [field]: value } : null);
    if (field === 'address') setAddress(value);
  };

  // ─── Generate (Mode 1 & 2) ───
  const handleGenerate = async () => {
    if (mode === 'feasibility') {
      if (!editedData || !address.trim()) { toast.error('Please upload a PDF and enter the address'); return; }
      if (!editedData.name.trim()) { toast.error('Name is required'); return; }
      setIsGenerating(true);
      try {
        await generateQuotation(editedData, address);
        await new Promise(r => setTimeout(r, 500));
        await generateAgreement({ name: editedData.name, address }, address);
        setGenerated(true);
        toast.success('Quotation & Agreement generated!');
      } catch (err) {
        console.error(err);
        toast.error('Failed to generate documents');
      } finally {
        setIsGenerating(false);
      }
    } else if (mode === 'aadhaar') {
      if (!editedAadhaar || !address.trim()) { toast.error('Please upload Aadhaar and ensure address is filled'); return; }
      if (!editedAadhaar.name.trim()) { toast.error('Name is required'); return; }
      setIsGenerating(true);
      try {
        await generateAgreement({ name: editedAadhaar.name, address: editedAadhaar.address }, address);
        setGenerated(true);
        toast.success('Agreement generated!');
      } catch (err) {
        console.error(err);
        toast.error('Failed to generate agreement');
      } finally {
        setIsGenerating(false);
      }
    }
  };

  const hasData = mode === 'feasibility' ? !!editedData : mode === 'aadhaar' ? !!editedAadhaar : scanImages.length > 0;
  const stepOffset = hasData ? 1 : 0;

  return (
    <div className="min-h-screen bg-background" style={{ background: 'var(--gradient-bg)' }}>
      {/* Header */}
      <header className="border-b border-border/50 backdrop-blur-sm bg-background/80 sticky top-0 z-10">
        <div className="container max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-solar flex items-center justify-center shadow-glow">
            <Sun className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-foreground">lazyguys-system</h1>
            <p className="text-xs text-muted-foreground">Solar Document Automation</p>
          </div>
        </div>
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center space-y-2 pb-4">
          <h2 className="font-display text-3xl font-bold">
            Generate Documents <span className="text-gradient-solar">Instantly</span>
          </h2>
          <p className="text-muted-foreground max-w-md mx-auto">
            Upload Aadhaar, feasibility report, or scan documents.
          </p>
        </motion.div>

        {/* Mode Toggle — 3 buttons */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
          className="flex flex-wrap gap-2 justify-center"
        >
          {([
            { key: 'aadhaar' as InputMode, icon: CreditCard, label: 'Aadhaar' },
            { key: 'feasibility' as InputMode, icon: FileSearch, label: 'Feasibility' },
            { key: 'scanner' as InputMode, icon: ScanLine, label: 'Doc Scanner' },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => handleModeSwitch(key)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 font-display font-semibold text-sm transition-all
                ${mode === key
                  ? 'border-primary bg-primary/10 text-primary shadow-glow'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/40'}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </motion.div>

        {/* Mode indicator */}
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center text-xs text-muted-foreground">
          {mode === 'aadhaar'
            ? '🔵 Aadhaar Mode — Agreement only (QR + OCR fallback)'
            : mode === 'feasibility'
            ? '🟢 Feasibility Mode — Quotation + Agreement'
            : '🟣 Scanner Mode — Process images into clean PDF'}
        </motion.p>

        {/* ═══════════════════════ MODES 1 & 2 ═══════════════════════ */}
        {mode !== 'scanner' && (
          <>
            {/* Step 1: Upload */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
            >
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">1</span>
                <h3 className="font-display font-semibold text-foreground">
                  {mode === 'aadhaar' ? 'Upload Aadhaar Card Image' : 'Upload Feasibility Report'}
                </h3>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
                  ${dragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50'}
                  ${(mode === 'aadhaar' ? aadhaarFile : pdfFile) ? 'border-primary/30 bg-primary/5' : ''}`}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                <input
                  id="file-input"
                  type="file"
                  accept={mode === 'aadhaar' ? 'image/*' : '.pdf'}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (mode === 'aadhaar') handleAadhaarSelect(file);
                    else handleFeasibilitySelect(file);
                  }}
                />
                {isExtracting ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-sm text-muted-foreground">
                      {aadhaarStatus || (mode === 'aadhaar' ? 'Scanning QR code...' : 'Extracting data...')}
                    </p>
                  </div>
                ) : (mode === 'aadhaar' ? aadhaarFile : pdfFile) ? (
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 className="w-8 h-8 text-success" />
                    <p className="text-sm font-medium text-foreground">
                      {(mode === 'aadhaar' ? aadhaarFile : pdfFile)?.name}
                    </p>
                    <p className="text-xs text-muted-foreground">Click to replace</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {mode === 'aadhaar'
                        ? <>Drag & drop Aadhaar image, or <span className="text-primary font-medium">browse</span></>
                        : <>Drag & drop feasibility PDF, or <span className="text-primary font-medium">browse</span></>}
                    </p>
                  </div>
                )}
              </div>

              {/* Aadhaar extraction method badge */}
              {mode === 'aadhaar' && editedAadhaar?.extractionMethod && (
                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                  ${editedAadhaar.extractionMethod === 'qr'
                    ? 'bg-success/10 text-success'
                    : 'bg-accent/20 text-accent-foreground'}`}>
                  {editedAadhaar.extractionMethod === 'qr' ? '✅ Extracted via QR Code' : '🔤 Extracted via OCR (verify data)'}
                </div>
              )}
            </motion.div>

            {/* Step 2: Editable Extracted Data */}
            <AnimatePresence>
              {mode === 'feasibility' && editedData && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">2</span>
                    <h3 className="font-display font-semibold text-foreground">Review & Edit Extracted Data</h3>
                    <Edit3 className="w-4 h-4 text-muted-foreground ml-auto" />
                  </div>
                  <p className="text-xs text-muted-foreground">Fields are pre-filled from the PDF. Edit any field before generating.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="f-name" className="text-xs text-muted-foreground">Name *</Label>
                      <Input id="f-name" value={editedData.name} onChange={(e) => updateFeasibilityField('name', e.target.value)} placeholder="Consumer name" className="bg-background border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-mobile" className="text-xs text-muted-foreground">Mobile</Label>
                      <Input id="f-mobile" value={editedData.mobile} onChange={(e) => updateFeasibilityField('mobile', e.target.value)} placeholder="Mobile number" className="bg-background border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-email" className="text-xs text-muted-foreground">Email</Label>
                      <Input id="f-email" value={editedData.email} onChange={(e) => updateFeasibilityField('email', e.target.value)} placeholder="Email (leave empty to remove)" className="bg-background border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="f-appno" className="text-xs text-muted-foreground">Application No.</Label>
                      <Input id="f-appno" value={editedData.applicationNumber} onChange={(e) => updateFeasibilityField('applicationNumber', e.target.value)} placeholder="e.g. NP-XXXXX00-000000" className="bg-background border-border" />
                    </div>
                  </div>
                  {(!editedData.name || !editedData.applicationNumber) && (
                    <div className="flex items-center gap-2 text-destructive text-xs">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Some required fields are missing.</span>
                    </div>
                  )}
                </motion.div>
              )}

              {mode === 'aadhaar' && editedAadhaar && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                  className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">2</span>
                    <h3 className="font-display font-semibold text-foreground">Review & Edit Aadhaar Data</h3>
                    <Edit3 className="w-4 h-4 text-muted-foreground ml-auto" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Fields extracted from {editedAadhaar.extractionMethod === 'qr' ? 'QR code' : 'OCR'}. Edit before generating agreement.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="a-name" className="text-xs text-muted-foreground">Name *</Label>
                      <Input id="a-name" value={editedAadhaar.name} onChange={(e) => updateAadhaarField('name', e.target.value)} placeholder="Full name" className="bg-background border-border" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="a-address" className="text-xs text-muted-foreground">Address *</Label>
                      <Input id="a-address" value={editedAadhaar.address} onChange={(e) => updateAadhaarField('address', e.target.value)} placeholder="Full address" className="bg-background border-border" />
                    </div>
                    {editedAadhaar.dob && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Date of Birth</Label>
                        <Input value={editedAadhaar.dob} disabled className="bg-muted border-border opacity-60" />
                      </div>
                    )}
                    {editedAadhaar.gender && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Gender</Label>
                        <Input value={editedAadhaar.gender} disabled className="bg-muted border-border opacity-60" />
                      </div>
                    )}
                  </div>
                  {!editedAadhaar.name && (
                    <div className="flex items-center gap-2 text-destructive text-xs">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Name is required.</span>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Address (Feasibility mode) */}
            {mode === 'feasibility' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
              >
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">{2 + stepOffset}</span>
                  <h3 className="font-display font-semibold text-foreground">Enter Address</h3>
                </div>
                <Input
                  placeholder="e.g. dhepaguDa rayagada odisha 765026"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="bg-background border-border focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Address will be auto-formatted. <strong>Capitalize Each Word</strong> for Quotation, <strong>ALL CAPS</strong> for Agreement.
                </p>
              </motion.div>
            )}

            {/* Generate */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
            >
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">
                  {mode === 'feasibility' ? 3 + stepOffset : 2 + stepOffset}
                </span>
                <h3 className="font-display font-semibold text-foreground">
                  {mode === 'aadhaar' ? 'Generate Agreement' : 'Generate Documents'}
                </h3>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={!hasData || (mode === 'feasibility' && !address.trim()) || (mode === 'aadhaar' && !address.trim()) || isGenerating}
                className="w-full h-12 text-base font-display font-semibold bg-gradient-solar hover:opacity-90 text-primary-foreground shadow-glow transition-all"
              >
                {isGenerating ? (
                  <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Generating...</>
                ) : generated ? (
                  <><CheckCircle2 className="w-5 h-5 mr-2" /> Generated! Click to regenerate</>
                ) : (
                  <><Zap className="w-5 h-5 mr-2" /> {mode === 'aadhaar' ? 'Generate Agreement' : 'Generate Quotation & Agreement'}</>
                )}
              </Button>

              <AnimatePresence>
                {generated && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row gap-3">
                    {mode === 'feasibility' && (
                      <div className="flex-1 rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
                        <FileText className="w-5 h-5 text-primary" />
                        <div>
                          <p className="text-sm font-medium text-foreground">quotation.docx</p>
                          <p className="text-xs text-muted-foreground">Downloaded</p>
                        </div>
                        <Download className="w-4 h-4 text-primary ml-auto" />
                      </div>
                    )}
                    <div className="flex-1 rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-center gap-3">
                      <FileText className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-foreground">agreement.docx</p>
                        <p className="text-xs text-muted-foreground">Downloaded</p>
                      </div>
                      <Download className="w-4 h-4 text-primary ml-auto" />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </>
        )}

        {/* ═══════════════════════ MODE 3: DOCUMENT SCANNER ═══════════════════════ */}
        {mode === 'scanner' && (
          <>
            {/* Step 1: Upload images */}
            <motion.div
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
            >
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">1</span>
                <h3 className="font-display font-semibold text-foreground">Upload Document Images</h3>
                <span className="ml-auto text-xs text-muted-foreground">{scanImages.length}/10</span>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
                  ${dragOver ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50'}`}
                onClick={() => scanInputRef.current?.click()}
              >
                <input
                  ref={scanInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) handleScannerFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="flex flex-col items-center gap-2">
                  <ImageIcon className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Drag & drop images (up to 10), or <span className="text-primary font-medium">browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground">JPG, PNG — will be enhanced and converted to PDF</p>
                </div>
              </div>

              {/* Image previews */}
              {scanImages.length > 0 && (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {scanImages.map((img, idx) => (
                    <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border aspect-[3/4]">
                      <img
                        src={img.processedUrl || img.previewUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-foreground/0 group-hover:bg-foreground/40 transition-all flex items-center justify-center">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeScanImage(img.id); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity w-8 h-8 rounded-full bg-destructive flex items-center justify-center"
                        >
                          <X className="w-4 h-4 text-destructive-foreground" />
                        </button>
                      </div>
                      <span className="absolute bottom-1 left-1 text-[10px] bg-foreground/70 text-background px-1.5 py-0.5 rounded font-display font-bold">
                        {idx + 1}
                      </span>
                      {img.processedUrl && (
                        <span className="absolute top-1 right-1">
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Step 2: Process & Generate PDF */}
            {scanImages.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
              >
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">2</span>
                  <h3 className="font-display font-semibold text-foreground">Process & Generate PDF</h3>
                </div>

                <p className="text-xs text-muted-foreground">
                  Images will be enhanced (grayscale, contrast boost, sharpening) and combined into a clean PDF.
                </p>

                <Button
                  onClick={processAndGeneratePDF}
                  disabled={isProcessingScans || scanImages.length === 0}
                  className="w-full h-12 text-base font-display font-semibold bg-gradient-solar hover:opacity-90 text-primary-foreground shadow-glow transition-all"
                >
                  {isProcessingScans ? (
                    <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
                  ) : scansProcessed ? (
                    <><CheckCircle2 className="w-5 h-5 mr-2" /> PDF Generated! Click to regenerate</>
                  ) : (
                    <><ScanLine className="w-5 h-5 mr-2" /> Enhance & Generate PDF</>
                  )}
                </Button>

                {scansProcessed && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-center gap-3"
                  >
                    <FileText className="w-5 h-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium text-foreground">scanned_document.pdf</p>
                      <p className="text-xs text-muted-foreground">Downloaded</p>
                    </div>
                    <Download className="w-4 h-4 text-primary ml-auto" />
                  </motion.div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setScanImages([]); setScansProcessed(false); }}
                    className="text-xs">
                    <RotateCcw className="w-3.5 h-3.5 mr-1" /> Clear All
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => scanInputRef.current?.click()}
                    disabled={scanImages.length >= 10} className="text-xs">
                    <Upload className="w-3.5 h-3.5 mr-1" /> Add More
                  </Button>
                </div>
              </motion.div>
            )}
          </>
        )}

        <p className="text-center text-xs text-muted-foreground pb-8">
          lazyguys-system · Solar Document Automation Tool
        </p>
      </main>
    </div>
  );
};

export default Index;
