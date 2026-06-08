import { FileText, Upload, X } from "lucide-react";

interface PdfSidebarProps {
  uploadedFile: File | null;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export function PdfSidebar({
  uploadedFile,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  fileInputRef,
}: PdfSidebarProps) {
  return (
    <aside className="flex w-80 flex-col border-r border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-5 py-4">
        <FileText className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold text-foreground">Handbook Generator</h2>
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-foreground">
            Source Document
          </label>
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            className={`
              flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed
              p-8 transition-colors
              ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border bg-background hover:bg-muted/50"
              }
            `}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
              <Upload className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="text-sm text-foreground">
                {isDragging ? "Drop PDF here" : "Drag & drop a PDF"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">or</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              onChange={onFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Browse files
            </button>
          </div>
        </div>

        {uploadedFile && (
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {uploadedFile.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <button
                onClick={() => {
                  /* placeholder for remove */
                }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
