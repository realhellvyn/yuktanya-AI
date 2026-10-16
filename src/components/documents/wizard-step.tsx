import type { Step } from "@/lib/documents/wizard";
import { formatDateId, formatIdr } from "@/lib/documents/format";

type Props = {
  step: Step;
  documentId: string;
  revision: number;
  action: (formData: FormData) => Promise<void>;
  value?: string | number;
  error?: string;
  backHref?: string;
};

function display(step: Step, value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  if (step.field.kind === "idr") return formatIdr(Number(value));
  if (step.field.kind === "date") return formatDateId(String(value));
  return String(value);
}

export function WizardStep({ step, documentId, revision, action, value, error, backHref }: Props) {
  const f = step.field;
  const id = `field-${f.key}`;
  const describedBy = [`${id}-help`, error ? `${id}-error` : ""].filter(Boolean).join(" ");
  const shared = { id, name: "value", "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, defaultValue: display(step, value) };
  const box = "mt-2 block min-h-12 w-full rounded-xl border border-slate-400 bg-white px-4 py-2 text-lg";
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="documentId" value={documentId} />
      <input type="hidden" name="revision" value={revision} />
      <input type="hidden" name="fieldKey" value={f.key} />
      <input type="hidden" name="stepIndex" value={step.index} />
      <div>
        <label htmlFor={id} className="block text-xl font-bold leading-snug text-navy">
          {f.label} <span className="text-base font-normal text-muted">({f.required ? "Wajib" : "Opsional"})</span>
        </label>
        {f.example && <p className="mt-1 text-muted">{f.example}</p>}
        {f.kind === "longtext" ? (
          <textarea {...shared} rows={5} maxLength={2000} className={box} />
        ) : f.kind === "choice" ? (
          <select {...shared} className={box}>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input {...shared} type="text" inputMode={f.kind === "idr" || f.kind === "integer" ? "numeric" : "text"} maxLength={200} className={box} />
        )}
        {error && <p id={`${id}-error`} role="alert" className="mt-2 font-semibold text-danger">{error}</p>}
      </div>
      <details id={`${id}-help`} className="rounded-xl border border-line bg-slate-50 p-3">
        <summary className="cursor-pointer font-medium">Mengapa informasi ini diperlukan?</summary>
        <p className="mt-2">{f.help}</p>
      </details>
      <div className="flex items-center gap-4">
        {backHref && <a href={backHref} className="inline-flex min-h-12 items-center rounded-xl border border-slate-400 bg-white px-5 font-semibold hover:bg-slate-50">Kembali</a>}
        <button type="submit" className="min-h-[52px] flex-1 rounded-xl bg-brand px-6 text-lg font-semibold text-white hover:bg-brand-dark">Lanjut</button>
      </div>
    </form>
  );
}
