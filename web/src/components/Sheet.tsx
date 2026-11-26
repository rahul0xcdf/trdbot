"use client";
import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";

/** Bottom sheet on mobile (vaul). */
export function Sheet({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode }) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Drawer.Content className="pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[88dvh] max-w-2xl rounded-t-2xl border border-line-strong bg-surface outline-none">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />
          <div className="flex items-center justify-between px-4 pt-3 pb-2">
            <Drawer.Title className="eyebrow">{title}</Drawer.Title>
            <button onClick={() => onOpenChange(false)} className="press rounded-full p-1 text-dim hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <Drawer.Description className="sr-only">{title}</Drawer.Description>
          <div className="overflow-y-auto px-4 pb-6">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
