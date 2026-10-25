import { FileText, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceView = "personal" | "builder";

const items = [
  { id: "personal", label: "Personal information", compactLabel: <>Personal<br />info</>, icon: UserRound },
  { id: "builder", label: "Resume builder", compactLabel: <>Resume<br />builder</>, icon: FileText },
] as const;

interface WorkspaceSidebarProps {
  activeView: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  profileName: string;
}

export function WorkspaceSidebar({ activeView, onViewChange, profileName }: WorkspaceSidebarProps) {
  return (
    <aside className="flex w-[76px] shrink-0 flex-col border-r border-border bg-card px-2 py-5 lg:w-56 lg:px-3 lg:py-6">
      <p className="mb-4 hidden px-3 text-xs font-medium uppercase tracking-wider text-muted-foreground lg:block">
        Workspace
      </p>
      <nav aria-label="Workspace sections" className="flex flex-col gap-2">
        {items.map(({ id, label, compactLabel, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-current={activeView === id ? "page" : undefined}
            onClick={() => onViewChange(id)}
            className={cn(
              "flex min-h-16 w-full flex-col items-center justify-center gap-2 rounded-lg border border-transparent px-1 py-3 text-center text-[11px] font-medium leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring lg:min-h-11 lg:flex-row lg:justify-start lg:gap-3 lg:px-3 lg:text-left lg:text-sm",
              activeView === id
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Icon className="size-[18px] shrink-0" aria-hidden="true" />
            <span className="lg:hidden">{compactLabel}</span>
            <span className="hidden lg:inline">{label}</span>
          </button>
        ))}
      </nav>
      <div className="mt-auto hidden border-t border-border px-3 pt-4 lg:block">
        <p className="text-xs text-muted-foreground">Active profile</p>
        <p className="mt-1 truncate text-sm font-medium" title={profileName}>{profileName}</p>
      </div>
    </aside>
  );
}
