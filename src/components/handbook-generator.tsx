import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FileText, Plus, ArrowLeft, Send, Check, Loader2, Trash2 } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  steps?: Step[];
}

interface Step {
  label: string;
  status: "done" | "active" | "pending";
}

interface PdfDoc {
  id: string;
  name: string;
  uploadedAt: Date;
  progress: number; // 0-100
  messages: Message[];
}

const HANDBOOK_STEPS = [
  "Reading documents",
  "Building knowledge graph",
  "Extracting key concepts",
  "Writing section 1 of 10",
  "Writing section 2 of 10",
  "Writing section 3 of 10",
  "Writing section 4 of 10",
  "Writing section 5 of 10",
  "Formatting handbook",
  "Finalizing output",
];

export function HandbookGenerator() {
  const [pdfs, setPdfs] = useState<PdfDoc[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onUpload = useCallback((file: File) => {
    const id = crypto.randomUUID();
    const doc: PdfDoc = {
      id,
      name: file.name,
      uploadedAt: new Date(),
      progress: 0,
      messages: [],
    };
    setPdfs((prev) => [doc, ...prev]);

    // simulate upload progress
    let p = 0;
    const interval = setInterval(() => {
      p += 10 + Math.random() * 15;
      if (p >= 100) {
        p = 100;
        clearInterval(interval);
        setPdfs((prev) => prev.map((d) => (d.id === id ? { ...d, progress: 100 } : d)));
        setTimeout(() => setActiveId(id), 400);
      } else {
        setPdfs((prev) => prev.map((d) => (d.id === id ? { ...d, progress: p } : d)));
      }
    }, 180);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = "";
  };

  const triggerFilePicker = () => fileInputRef.current?.click();

  const activeDoc = pdfs.find((d) => d.id === activeId) ?? null;

  const updateDoc = useCallback((id: string, updater: (d: PdfDoc) => PdfDoc) => {
    setPdfs((prev) => prev.map((d) => (d.id === id ? updater(d) : d)));
  }, []);

  const onDeletePDF = useCallback((pdfId: string) => {
    console.log("onDeletePDF", pdfId);
    setPdfs((prev) => prev.filter((d) => d.id !== pdfId));
  }, []);

  return (
    <div className="h-screen w-full bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileInput}
        className="hidden"
      />
      {activeDoc ? (
        <ChatScreen
          doc={activeDoc}
          onBack={() => setActiveId(null)}
          updateDoc={updateDoc}
        />
      ) : (
        <HomeScreen pdfs={pdfs} onPick={triggerFilePicker} onOpen={setActiveId} onDelete={onDeletePDF} />
      )}
    </div>
  );
}

/* -------------------- HOME -------------------- */

function HomeScreen({
  pdfs,
  onPick,
  onOpen,
}: {
  pdfs: PdfDoc[];
  onPick: () => void;
  onOpen: (id: string) => void;
}) {
  const isEmpty = pdfs.length === 0;

  if (isEmpty) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <button
          onClick={onPick}
          className="group flex flex-col items-center gap-4 rounded-2xl px-8 py-10 transition-colors hover:bg-muted/60"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform group-hover:scale-105">
            <Upload className="h-7 w-7" />
          </div>
          <p className="text-base font-medium text-foreground">
            Upload a PDF to get started
          </p>
          <p className="text-sm text-muted-foreground">PDF files only</p>
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Handbook Generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {pdfs.length} document{pdfs.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto pb-24">
        {pdfs.map((doc) => (
          <PdfCard key={doc.id} doc={doc} onClick={() => doc.progress >= 100 && onOpen(doc.id)} />
        ))}
      </div>

      <button
        onClick={onPick}
        aria-label="Upload another PDF"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
      >
        <Plus className="h-6 w-6" />
      </button>
    </div>
  );
}

function PdfCard({ doc, onClick }: { doc: PdfDoc; onClick: () => void }) {
  const uploading = doc.progress < 100;
  return (
    <button
      onClick={onClick}
      disabled={uploading}
      className="group flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 disabled:cursor-default disabled:hover:border-border disabled:hover:bg-card"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{doc.name}</p>
        {uploading ? (
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${doc.progress}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {Math.round(doc.progress)}%
            </span>
          </div>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Uploaded {formatDate(doc.uploadedAt)}
          </p>
        )}
      </div>
      {!uploading && (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600">
          <Check className="h-4 w-4" />
        </div>
      )}
    </button>
  );
}

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/* -------------------- CHAT -------------------- */

function ChatScreen({
  doc,
  onBack,
  updateDoc,
}: {
  doc: PdfDoc;
  onBack: () => void;
  updateDoc: (id: string, updater: (d: PdfDoc) => PdfDoc) => void;
}) {
  const [input, setInput] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [doc.id]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [doc.messages]);

  const appendMessage = (msg: Message) => {
    updateDoc(doc.id, (d) => ({ ...d, messages: [...d.messages, msg] }));
  };

  const onGenerateHandbook = (triggerMsgId: string) => {
    // Initialize steps
    const initialSteps: Step[] = HANDBOOK_STEPS.map((label, i) => ({
      label: i === 0 ? `${label}...` : label,
      status: i === 0 ? "active" : "pending",
    }));
    const aiId = crypto.randomUUID();
    updateDoc(doc.id, (d) => ({
      ...d,
      messages: [
        ...d.messages,
        { id: aiId, role: "ai", content: "Generating your handbook...", steps: initialSteps },
      ],
    }));

    // Animate steps
    let i = 0;
    const tick = () => {
      i++;
      updateDoc(doc.id, (d) => ({
        ...d,
        messages: d.messages.map((m) => {
          if (m.id !== aiId || !m.steps) return m;
          const steps = m.steps.map((s, idx) => {
            if (idx < i) return { ...s, status: "done" as const, label: HANDBOOK_STEPS[idx] };
            if (idx === i)
              return { ...s, status: "active" as const, label: `${HANDBOOK_STEPS[idx]}...` };
            return { ...s, status: "pending" as const, label: HANDBOOK_STEPS[idx] };
          });
          return { ...m, steps };
        }),
      }));
      if (i < HANDBOOK_STEPS.length) {
        setTimeout(tick, 800);
      } else {
        updateDoc(doc.id, (d) => ({
          ...d,
          messages: d.messages.map((m) =>
            m.id === aiId ? { ...m, content: "Your handbook is ready." } : m,
          ),
        }));
      }
    };
    setTimeout(tick, 800);
    void triggerMsgId;
  };

  const onSendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    appendMessage(userMsg);

    const lower = trimmed.toLowerCase();
    if (lower.includes("handbook") || lower.includes("generate")) {
      setTimeout(() => onGenerateHandbook(userMsg.id), 300);
    } else {
      setTimeout(() => {
        appendMessage({
          id: crypto.randomUUID(),
          role: "ai",
          content:
            "I can answer questions about this PDF or generate a full handbook. Try saying \"generate handbook\".",
        });
      }, 400);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSendMessage(input);
    setInput("");
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <p className="truncate text-sm font-medium">{doc.name}</p>
        </div>
        <button
          onClick={onBack}
          aria-label="Back to home"
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      </header>

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {doc.messages.length === 0 && (
            <div className="mt-8 text-center text-sm text-muted-foreground">
              Ask anything about <span className="text-foreground">{doc.name}</span>, or type
              "generate handbook" to begin.
            </div>
          )}
          {doc.messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border bg-background px-4 py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message..."
            className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  if (msg.steps) {
    return (
      <div className="flex justify-start">
        <div className="w-full max-w-[85%] rounded-2xl border border-border bg-muted/40 px-4 py-3">
          <p className="mb-3 text-sm font-medium text-foreground">{msg.content}</p>
          <ul className="flex flex-col gap-2">
            {msg.steps.map((step, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {step.status === "done" && (
                  <Check className="h-4 w-4 shrink-0 text-green-600" />
                )}
                {step.status === "active" && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                )}
                {step.status === "pending" && (
                  <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                )}
                <span
                  className={
                    step.status === "pending"
                      ? "text-muted-foreground"
                      : step.status === "active"
                        ? "text-foreground"
                        : "text-foreground/80"
                  }
                >
                  {step.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {msg.content}
      </div>
    </div>
  );
}
