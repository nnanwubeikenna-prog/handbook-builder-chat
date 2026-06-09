import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, FileText, Plus, ArrowLeft, Send, Check, Loader2, Trash2 } from "lucide-react";

export interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
  steps?: Step[];
  streaming?: boolean;
}

interface Step {
  label: string;
  status: "done" | "active" | "pending";
}

interface PdfDoc {
  id: string;
  name: string;
  uploadedAt: Date;
  progress: number;
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

  // Load previously uploaded PDFs from Supabase on startup
  useEffect(() => {
    fetch("/api/pdfs")
      .then((r) => r.json())
      .then((data: { pdf_id: string; pdf_name: string; created_at: string | null }[]) => {
        const loaded: PdfDoc[] = data.map((item) => ({
          id: item.pdf_id,
          name: item.pdf_name,
          uploadedAt: item.created_at ? new Date(item.created_at) : new Date(),
          progress: 100,
          messages: [],
        }));
        setPdfs(loaded);
      })
      .catch(() => {
        // Supabase not configured yet — start with empty list
      });
  }, []);

  const onUpload = useCallback(async (file: File) => {
    const tempId = crypto.randomUUID();
    const doc: PdfDoc = {
      id: tempId,
      name: file.name,
      uploadedAt: new Date(),
      progress: 0,
      messages: [],
    };
    setPdfs((prev) => [doc, ...prev]);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.min(90, Math.round((e.loaded / e.total) * 90));
        setPdfs((prev) => prev.map((d) => (d.id === tempId ? { ...d, progress: pct } : d)));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText) as { pdf_id: string; name: string; chunk_count: number };
        setPdfs((prev) =>
          prev.map((d) =>
            d.id === tempId ? { ...d, id: data.pdf_id, progress: 100 } : d
          )
        );
        setTimeout(() => setActiveId(data.pdf_id), 400);
      } else {
        setPdfs((prev) => prev.filter((d) => d.id !== tempId));
        alert(`Upload failed: ${xhr.responseText}`);
      }
    };

    xhr.onerror = () => {
      setPdfs((prev) => prev.filter((d) => d.id !== tempId));
      alert("Upload failed: network error");
    };

    xhr.send(formData);
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

  const onDeletePDF = useCallback(async (pdfId: string) => {
    try {
      await fetch(`/api/pdf/${pdfId}`, { method: "DELETE" });
    } catch {
      // best-effort — remove from UI regardless
    }
    setPdfs((prev) => prev.filter((d) => d.id !== pdfId));
    if (activeId === pdfId) setActiveId(null);
  }, [activeId]);

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
  onDelete,
}: {
  pdfs: PdfDoc[];
  onPick: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
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
          <PdfCard
            key={doc.id}
            doc={doc}
            onClick={() => doc.progress >= 100 && onOpen(doc.id)}
            onDelete={() => onDelete(doc.id)}
          />
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

function PdfCard({ doc, onClick, onDelete }: { doc: PdfDoc; onClick: () => void; onDelete: () => void }) {
  const uploading = doc.progress < 100;
  return (
    <div
      onClick={uploading ? undefined : onClick}
      className={`group relative flex w-full items-center gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors ${
        uploading ? "" : "cursor-pointer hover:border-primary/40 hover:bg-muted/40"
      }`}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <FileText className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1 pr-8">
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
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label="Delete PDF"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-red-500 transition-colors hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
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
  const [busy, setBusy] = useState(false);
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

  const updateLastAiMessage = (docId: string, msgId: string, content: string, streaming: boolean) => {
    updateDoc(docId, (d) => ({
      ...d,
      messages: d.messages.map((m) =>
        m.id === msgId ? { ...m, content, streaming } : m
      ),
    }));
  };

  const onGenerateHandbook = async (pdfId: string) => {
    const aiId = crypto.randomUUID();

    // Show the animated steps panel while we wait for the backend to start
    const initialSteps: Step[] = HANDBOOK_STEPS.map((label, i) => ({
      label: i === 0 ? `${label}...` : label,
      status: i === 0 ? "active" : "pending",
    }));
    updateDoc(pdfId, (d) => ({
      ...d,
      messages: [
        ...d.messages,
        { id: aiId, role: "ai", content: "Generating your handbook...", steps: initialSteps },
      ],
    }));

    let stepIdx = 0;
    const stepInterval = setInterval(() => {
      stepIdx++;
      if (stepIdx >= HANDBOOK_STEPS.length) { clearInterval(stepInterval); return; }
      updateDoc(pdfId, (d) => ({
        ...d,
        messages: d.messages.map((m) => {
          if (m.id !== aiId || !m.steps) return m;
          const steps = m.steps.map((s, idx) => {
            if (idx < stepIdx) return { ...s, status: "done" as const, label: HANDBOOK_STEPS[idx] };
            if (idx === stepIdx) return { ...s, status: "active" as const, label: `${HANDBOOK_STEPS[idx]}...` };
            return { ...s, status: "pending" as const, label: HANDBOOK_STEPS[idx] };
          });
          return { ...m, steps };
        }),
      }));
    }, 1500);

    try {
      const res = await fetch("/api/handbook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_id: pdfId }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Handbook request failed: ${res.statusText}`);
      }

      // Response headers received — switch the message from steps to streaming text
      clearInterval(stepInterval);
      updateDoc(pdfId, (d) => ({
        ...d,
        messages: d.messages.map((m) =>
          m.id === aiId ? { ...m, content: "", steps: undefined, streaming: true } : m
        ),
      }));

      // Read the plain-text stream and append each chunk as it arrives
      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        // Append chunk directly via functional updater — no stale-closure risk
        updateDoc(pdfId, (d) => ({
          ...d,
          messages: d.messages.map((m) =>
            m.id === aiId ? { ...m, content: m.content + chunk, streaming: true } : m
          ),
        }));
      }

      // Mark streaming done
      updateDoc(pdfId, (d) => ({
        ...d,
        messages: d.messages.map((m) =>
          m.id === aiId ? { ...m, streaming: false } : m
        ),
      }));
    } catch (err) {
      clearInterval(stepInterval);
      const errMsg = err instanceof Error ? err.message : "Failed to generate handbook.";
      updateDoc(pdfId, (d) => ({
        ...d,
        messages: d.messages.map((m) =>
          m.id === aiId ? { ...m, content: `Error: ${errMsg}`, steps: undefined, streaming: false } : m
        ),
      }));
    }
  };

  const onSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: trimmed };
    appendMessage(userMsg);
    setBusy(true);

    const lower = trimmed.toLowerCase();
    if (lower.includes("handbook") || lower.includes("generate")) {
      await onGenerateHandbook(doc.id);
    } else {
      const aiId = crypto.randomUUID();
      appendMessage({ id: aiId, role: "ai", content: "", streaming: true });
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pdf_id: doc.id, message: trimmed }),
        });
        if (!res.ok) throw new Error(`Chat failed: ${res.statusText}`);
        const data = (await res.json()) as { reply: string };
        updateLastAiMessage(doc.id, aiId, data.reply, false);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Something went wrong.";
        updateLastAiMessage(doc.id, aiId, `Error: ${errMsg}`, false);
      }
    }

    setBusy(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSendMessage(input);
    setInput("");
  };

  return (
    <div className="flex h-full w-full flex-col">
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
          {busy && doc.messages[doc.messages.length - 1]?.role === "user" && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-muted px-4 py-2.5">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-background px-4 py-3">
        <form onSubmit={handleSubmit} className="mx-auto flex max-w-2xl items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message..."
            disabled={busy}
            className="flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
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
                {step.status === "done" && <Check className="h-4 w-4 shrink-0 text-green-600" />}
                {step.status === "active" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />}
                {step.status === "pending" && <span className="h-4 w-4 shrink-0 rounded-full border border-border" />}
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
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {msg.content}
        {msg.streaming && (
          <span className="ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-current opacity-70" />
        )}
      </div>
    </div>
  );
}
