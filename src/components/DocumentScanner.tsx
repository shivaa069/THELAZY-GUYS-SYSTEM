import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, X, CheckCircle2, Loader2, RotateCcw, ScanLine, FileText, Download,
  Sun as SunIcon, Contrast, Image as ImageIcon, Eye, ZoomIn, Move,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  type ScanPage, type CropCorners, type EnhancementMode, type ScanSettings,
  DEFAULT_SETTINGS, detectDocumentEdges, processPage, generateScannedPDF,
  drawCornersOverlay, loadImageFromFile,
} from '@/utils/documentScanner';

interface DocumentScannerProps {}

type ScanStep = 'upload' | 'crop' | 'enhance' | 'export';

const DocumentScanner = (_props: DocumentScannerProps) => {
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [activePage, setActivePage] = useState<number>(0);
  const [step, setStep] = useState<ScanStep>('upload');
  const [isDetecting, setIsDetecting] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedUrls, setProcessedUrls] = useState<string[]>([]);
  const [draggingCorner, setDraggingCorner] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentPage = pages[activePage];

  // ─── File Handling ───
  const handleFiles = useCallback(async (files: FileList) => {
    const maxFiles = 10 - pages.length;
    const newPages: ScanPage[] = [];

    for (let i = 0; i < Math.min(files.length, maxFiles); i++) {
      const file = files[i];
      if (!file.type.startsWith('image/')) continue;
      const img = await loadImageFromFile(file);
      newPages.push({
        id: crypto.randomUUID(),
        file,
        originalUrl: URL.createObjectURL(file),
        settings: { ...DEFAULT_SETTINGS },
        naturalWidth: img.width,
        naturalHeight: img.height,
      });
    }

    if (newPages.length === 0) {
      toast.error('Please upload image files');
      return;
    }

    setPages(prev => [...prev, ...newPages]);
    setProcessedUrls([]);
    toast.success(`${newPages.length} image(s) added`);

    if (pages.length === 0) {
      // Auto-detect edges for first image
      setStep('crop');
      setIsDetecting(true);
      try {
        const corners = await detectDocumentEdges(newPages[0].file);
        if (corners) {
          newPages[0].corners = corners;
          setPages([...newPages]);
        }
      } catch (e) {
        console.error('Edge detection failed:', e);
      }
      setIsDetecting(false);
    }
  }, [pages.length]);

  const removePage = (idx: number) => {
    setPages(prev => prev.filter((_, i) => i !== idx));
    setProcessedUrls([]);
    if (activePage >= pages.length - 1 && activePage > 0) {
      setActivePage(activePage - 1);
    }
    if (pages.length <= 1) {
      setStep('upload');
    }
  };

  // ─── Auto-detect edges when switching pages ───
  const detectEdgesForPage = useCallback(async (pageIdx: number) => {
    const page = pages[pageIdx];
    if (!page || page.corners) return;
    setIsDetecting(true);
    try {
      const corners = await detectDocumentEdges(page.file);
      if (corners) {
        setPages(prev => prev.map((p, i) => i === pageIdx ? { ...p, corners } : p));
      }
    } catch (e) {
      console.error('Edge detection failed:', e);
    }
    setIsDetecting(false);
  }, [pages]);

  useEffect(() => {
    if (step === 'crop' && currentPage && !currentPage.corners) {
      detectEdgesForPage(activePage);
    }
  }, [activePage, step, currentPage, detectEdgesForPage]);

  // ─── Draw corners overlay ───
  useEffect(() => {
    if (step !== 'crop' || !currentPage?.corners || !canvasRef.current || !imageRef.current) return;

    const canvas = canvasRef.current;
    const img = imageRef.current;
    
    const updateOverlay = () => {
      canvas.width = img.clientWidth;
      canvas.height = img.clientHeight;
      const ctx = canvas.getContext('2d')!;
      drawCornersOverlay(ctx, currentPage.corners!, canvas.width, canvas.height, currentPage.naturalWidth, currentPage.naturalHeight);
    };

    if (img.complete) updateOverlay();
    img.onload = updateOverlay;
    
    const observer = new ResizeObserver(updateOverlay);
    observer.observe(img);
    return () => observer.disconnect();
  }, [step, currentPage, currentPage?.corners]);

  // ─── Corner Dragging ───
  const getCornerAtPoint = (clientX: number, clientY: number): string | null => {
    if (!canvasRef.current || !currentPage?.corners) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const scaleX = canvasRef.current.width / currentPage.naturalWidth;
    const scaleY = canvasRef.current.height / currentPage.naturalHeight;
    const threshold = 20;

    const cornerMap: Record<string, { x: number; y: number }> = {
      topLeft: { x: currentPage.corners.topLeft.x * scaleX, y: currentPage.corners.topLeft.y * scaleY },
      topRight: { x: currentPage.corners.topRight.x * scaleX, y: currentPage.corners.topRight.y * scaleY },
      bottomRight: { x: currentPage.corners.bottomRight.x * scaleX, y: currentPage.corners.bottomRight.y * scaleY },
      bottomLeft: { x: currentPage.corners.bottomLeft.x * scaleX, y: currentPage.corners.bottomLeft.y * scaleY },
    };

    for (const [key, pt] of Object.entries(cornerMap)) {
      if (Math.hypot(x - pt.x, y - pt.y) < threshold) return key;
    }
    return null;
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const corner = getCornerAtPoint(e.clientX, e.clientY);
    if (corner) {
      setDraggingCorner(corner);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingCorner || !canvasRef.current || !currentPage?.corners) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = currentPage.naturalWidth / canvasRef.current.width;
    const scaleY = currentPage.naturalHeight / canvasRef.current.height;

    const newCorners = { ...currentPage.corners };
    newCorners[draggingCorner as keyof CropCorners] = {
      x: Math.max(0, Math.min(currentPage.naturalWidth, x * scaleX)),
      y: Math.max(0, Math.min(currentPage.naturalHeight, y * scaleY)),
    };

    setPages(prev => prev.map((p, i) => i === activePage ? { ...p, corners: newCorners } : p));
  };

  const handlePointerUp = () => {
    setDraggingCorner(null);
  };

  // ─── Settings Controls ───
  const updateSetting = <K extends keyof ScanSettings>(key: K, value: ScanSettings[K]) => {
    setPages(prev => prev.map((p, i) =>
      i === activePage ? { ...p, settings: { ...p.settings, [key]: value } } : p
    ));
    setProcessedUrls([]);
  };

  const resetSettings = () => {
    setPages(prev => prev.map((p, i) =>
      i === activePage ? { ...p, settings: { ...DEFAULT_SETTINGS } } : p
    ));
  };

  // ─── Processing ───
  const processAllPages = async () => {
    setIsProcessing(true);
    try {
      const urls: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        toast.info(`Processing page ${i + 1} of ${pages.length}...`);
        const url = await processPage(pages[i]);
        urls.push(url);
        setPages(prev => prev.map((p, j) => j === i ? { ...p, processedUrl: url } : p));
      }
      setProcessedUrls(urls);
      setStep('export');
      toast.success('All pages processed!');
    } catch (err) {
      console.error(err);
      toast.error('Processing failed');
    }
    setIsProcessing(false);
  };

  const exportPDF = async () => {
    if (processedUrls.length === 0) {
      toast.error('Please process pages first');
      return;
    }
    try {
      await generateScannedPDF(processedUrls);
      toast.success('PDF exported!');
    } catch (err) {
      console.error(err);
      toast.error('PDF export failed');
    }
  };

  // ─── Render ───
  return (
    <div className="space-y-6">
      {/* Step Navigation */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {(['upload', 'crop', 'enhance', 'export'] as ScanStep[]).map((s, idx) => {
          const labels = ['Upload', 'Crop & Detect', 'Enhance', 'Export PDF'];
          const icons = [Upload, Move, Contrast, FileText];
          const Icon = icons[idx];
          const isActive = s === step;
          const isComplete = (s === 'upload' && pages.length > 0) ||
            (s === 'crop' && pages.every(p => p.corners)) ||
            (s === 'enhance' && processedUrls.length > 0) ||
            (s === 'export' && processedUrls.length > 0);

          return (
            <button
              key={s}
              onClick={() => {
                if (s === 'upload' || pages.length > 0) setStep(s);
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-display font-semibold transition-all whitespace-nowrap
                ${isActive
                  ? 'bg-primary/10 text-primary border-2 border-primary'
                  : isComplete
                    ? 'bg-success/10 text-success border border-success/30'
                    : 'bg-muted text-muted-foreground border border-border'}`}
            >
              {isComplete && !isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
              {labels[idx]}
            </button>
          );
        })}
      </div>

      {/* STEP 1: Upload */}
      {step === 'upload' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
        >
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">1</span>
            <h3 className="font-display font-semibold text-foreground">Upload Document Images</h3>
            <span className="ml-auto text-xs text-muted-foreground">{pages.length}/10</span>
          </div>

          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all border-border hover:border-primary/50"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
            />
            <div className="flex flex-col items-center gap-2">
              <ImageIcon className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Drag & drop images (up to 10), or <span className="text-primary font-medium">browse</span>
              </p>
              <p className="text-xs text-muted-foreground">JPG, PNG — will be scanned and converted to PDF</p>
            </div>
          </div>

          {/* Thumbnails */}
          {pages.length > 0 && (
            <>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
                {pages.map((page, idx) => (
                  <div key={page.id} className="relative group rounded-lg overflow-hidden border border-border aspect-[3/4]">
                    <img src={page.originalUrl} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={(e) => { e.stopPropagation(); removePage(idx); }}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded-full bg-destructive flex items-center justify-center"
                    >
                      <X className="w-3 h-3 text-destructive-foreground" />
                    </button>
                    <span className="absolute bottom-1 left-1 text-[10px] bg-foreground/70 text-background px-1.5 py-0.5 rounded font-display font-bold">
                      {idx + 1}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => setStep('crop')}
                  className="flex-1 bg-gradient-solar hover:opacity-90 text-primary-foreground font-display font-semibold shadow-glow"
                >
                  <ScanLine className="w-4 h-4 mr-2" /> Continue to Crop
                </Button>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}
                  disabled={pages.length >= 10} className="text-xs">
                  <Upload className="w-3.5 h-3.5 mr-1" /> Add More
                </Button>
              </div>
            </>
          )}
        </motion.div>
      )}

      {/* STEP 2: Crop & Corner Adjustment */}
      {step === 'crop' && currentPage && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
        >
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">2</span>
            <h3 className="font-display font-semibold text-foreground">Adjust Document Edges</h3>
            <span className="ml-auto text-xs text-muted-foreground">Page {activePage + 1}/{pages.length}</span>
          </div>

          <p className="text-xs text-muted-foreground">
            <Move className="w-3 h-3 inline mr-1" />
            Drag the corner handles to precisely crop the document. Auto-detection runs first.
          </p>

          {isDetecting ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Detecting document edges...</p>
            </div>
          ) : (
            <div ref={containerRef} className="relative inline-block w-full">
              <img
                ref={imageRef}
                src={currentPage.originalUrl}
                alt="Document"
                className="w-full rounded-lg"
                draggable={false}
              />
              <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 w-full h-full cursor-crosshair rounded-lg"
                style={{ touchAction: 'none' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
            </div>
          )}

          {/* Page selector */}
          {pages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto py-2">
              {pages.map((page, idx) => (
                <button
                  key={page.id}
                  onClick={() => setActivePage(idx)}
                  className={`flex-shrink-0 w-14 h-18 rounded-lg overflow-hidden border-2 transition-all
                    ${idx === activePage ? 'border-primary shadow-glow' : 'border-border'}`}
                >
                  <img src={page.originalUrl} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => detectEdgesForPage(activePage)} className="text-xs">
              <ZoomIn className="w-3.5 h-3.5 mr-1" /> Re-detect
            </Button>
            <Button
              onClick={() => setStep('enhance')}
              className="flex-1 bg-gradient-solar hover:opacity-90 text-primary-foreground font-display font-semibold shadow-glow"
            >
              Continue to Enhance
            </Button>
          </div>
        </motion.div>
      )}

      {/* STEP 3: Enhancement Controls */}
      {step === 'enhance' && currentPage && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
        >
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">3</span>
            <h3 className="font-display font-semibold text-foreground">Enhancement Controls</h3>
            <span className="ml-auto text-xs text-muted-foreground">Page {activePage + 1}/{pages.length}</span>
          </div>

          {/* Enhancement Mode */}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground font-medium">Mode</label>
            <div className="flex gap-2">
              {([
                { key: 'color' as EnhancementMode, label: 'Color', icon: ImageIcon },
                { key: 'grayscale' as EnhancementMode, label: 'Grayscale', icon: Eye },
                { key: 'bw' as EnhancementMode, label: 'B&W Document', icon: FileText },
              ]).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => updateSetting('mode', key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-display font-semibold border transition-all
                    ${currentPage.settings.mode === key
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted text-muted-foreground hover:border-primary/40'}`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <SunIcon className="w-3 h-3" /> Brightness: {currentPage.settings.brightness}
              </label>
              <input
                type="range"
                min="-100"
                max="100"
                value={currentPage.settings.brightness}
                onChange={(e) => updateSetting('brightness', Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                <Contrast className="w-3 h-3" /> Contrast: {currentPage.settings.contrast}
              </label>
              <input
                type="range"
                min="-100"
                max="100"
                value={currentPage.settings.contrast}
                onChange={(e) => updateSetting('contrast', Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>

          {/* Rotation & Sharpen */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs text-muted-foreground font-medium">Rotate:</label>
            {[0, 90, 180, 270].map(deg => (
              <button
                key={deg}
                onClick={() => updateSetting('rotation', deg)}
                className={`px-3 py-1.5 rounded-lg text-xs font-display font-semibold border transition-all
                  ${currentPage.settings.rotation === deg
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground'}`}
              >
                {deg}°
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => updateSetting('sharpen', !currentPage.settings.sharpen)}
              className={`px-3 py-1.5 rounded-lg text-xs font-display font-semibold border transition-all
                ${currentPage.settings.sharpen
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground'}`}
            >
              Sharpen {currentPage.settings.sharpen ? 'ON' : 'OFF'}
            </button>
            <Button variant="outline" size="sm" onClick={resetSettings} className="text-xs">
              <RotateCcw className="w-3 h-3 mr-1" /> Reset
            </Button>
          </div>

          {/* Page selector */}
          {pages.length > 1 && (
            <div className="flex gap-2 overflow-x-auto py-2">
              {pages.map((page, idx) => (
                <button
                  key={page.id}
                  onClick={() => setActivePage(idx)}
                  className={`flex-shrink-0 w-14 h-18 rounded-lg overflow-hidden border-2 transition-all
                    ${idx === activePage ? 'border-primary shadow-glow' : 'border-border'}`}
                >
                  <img src={page.processedUrl || page.originalUrl} alt={`Page ${idx + 1}`} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}

          <Button
            onClick={processAllPages}
            disabled={isProcessing}
            className="w-full h-12 text-base font-display font-semibold bg-gradient-solar hover:opacity-90 text-primary-foreground shadow-glow"
          >
            {isProcessing ? (
              <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Processing...</>
            ) : (
              <><ScanLine className="w-5 h-5 mr-2" /> Process All Pages</>
            )}
          </Button>
        </motion.div>
      )}

      {/* STEP 4: Export */}
      {step === 'export' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-card space-y-4"
        >
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-gradient-solar flex items-center justify-center text-primary-foreground text-sm font-bold font-display">4</span>
            <h3 className="font-display font-semibold text-foreground">Export Scanned PDF</h3>
          </div>

          {/* Preview processed pages */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {processedUrls.map((url, idx) => (
              <div key={idx} className="rounded-lg overflow-hidden border border-border aspect-[3/4]">
                <img src={url} alt={`Processed ${idx + 1}`} className="w-full h-full object-cover" />
              </div>
            ))}
          </div>

          <Button
            onClick={exportPDF}
            className="w-full h-12 text-base font-display font-semibold bg-gradient-solar hover:opacity-90 text-primary-foreground shadow-glow"
          >
            <Download className="w-5 h-5 mr-2" /> Download Scanned PDF
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setStep('enhance')} className="text-xs">
              ← Back to Enhance
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setPages([]);
              setProcessedUrls([]);
              setStep('upload');
              setActivePage(0);
            }} className="text-xs">
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Start Over
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default DocumentScanner;
