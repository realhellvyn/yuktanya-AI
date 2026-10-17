import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(13,27,42,0.05)] md:p-6", className)} {...rest} />;
}

export function PageHeading({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-2">
        <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight text-navy md:text-4xl">{title}</h1>
        {lead && <p className="max-w-2xl text-lg text-muted">{lead}</p>}
      </div>
      {actions}
    </header>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-strong bg-surface p-8 text-center">
      <p className="text-xl font-semibold text-navy">{title}</p>
      {text && <p className="mx-auto mt-2 max-w-md text-muted">{text}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
