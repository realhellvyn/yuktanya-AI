import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Tinggi minimal 48px (utama 52px) sesuai DESIGN_SYSTEM; fokus terlihat; tidak bergantung warna saja.
const base =
  "inline-flex items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition-colors disabled:opacity-60";
const VARIANTS = {
  primary: "min-h-[52px] bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "min-h-12 border border-border-strong bg-surface text-heading hover:bg-subtle",
  quiet: "min-h-12 px-3 text-link underline underline-offset-4 hover:text-primary-hover",
} as const;
export type ButtonVariant = keyof typeof VARIANTS;

export const buttonClass = (variant: ButtonVariant = "primary", extra?: string) => cn(base, VARIANTS[variant], extra);

export function ButtonLink({ href, variant = "primary", className, children, ...rest }: { href: string; variant?: ButtonVariant; className?: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  return <Link href={href} className={buttonClass(variant, className)} {...rest}>{children}</Link>;
}

export function Button({ variant = "primary", className, ...rest }: { variant?: ButtonVariant } & ComponentProps<"button">) {
  return <button className={buttonClass(variant, className)} {...rest} />;
}
