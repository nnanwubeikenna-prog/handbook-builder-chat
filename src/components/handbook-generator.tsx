import { useState, useRef, useCallback } from "react";
import { PdfSidebar } from "./pdf-sidebar";
import { ChatArea } from "./chat-area";
import { AppHeader } from "./app-header";

export interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

export function HandbookGenerator() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      role: "ai",
      content: "Hello! I'm ready to help you create a handbook. Upload a PDF to get started, or ask me anything about handbook creation.",
    },
  ]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onUpload = useCallback((file: File) => {
    setUploadedFile(file);
    console.log("Uploaded file:", file.name);
  }, []);

  const onSendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);

    // Placeholder: simulate AI response after a short delay
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: "This is a placeholder AI response. In a real implementation, this would call your AI backend.",
      };
      setMessages((prev) => [...prev, aiMsg]);
    }, 500);
  }, []);

  const onGenerateHandbook = useCallback(() => {
    console.log("Generate Handbook clicked");
    const aiMsg: Message = {
      id: (Date.now() + 1).toString(),
      role: "ai",
      content: "I've started generating your handbook. This may take a few moments...",
    };
    setMessages((prev) => [...prev, aiMsg]);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type === "application/pdf") {
        onUpload(file);
      }
    },
    [onUpload]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        onUpload(file);
      }
    },
    [onUpload]
  );

  return (
    <div className="flex h-screen w-full bg-background">
      <PdfSidebar
        uploadedFile={uploadedFile}
        isDragging={isDragging}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onFileSelect={handleFileSelect}
        fileInputRef={fileInputRef}
      />
      <div className="flex flex-1 flex-col">
        <AppHeader onGenerateHandbook={onGenerateHandbook} />
        <ChatArea messages={messages} onSendMessage={onSendMessage} />
      </div>
    </div>
  );
}
