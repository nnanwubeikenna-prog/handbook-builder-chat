import { BookOpen } from "lucide-react";

interface AppHeaderProps {
  onGenerateHandbook: () => void;
}

export function AppHeader({ onGenerateHandbook }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-6">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Chat</span>
      </div>
      <button
        onClick={onGenerateHandbook}
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
      >
        <BookOpen className="h-4 w-4" />
        Generate Handbook
      </button>
    </header>
  );
}
