"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { FormField } from "./form-builder";

interface FormPublicProps {
  formId: string;
  formName: string;
  formDescription?: string | null;
  fields: FormField[];
}

export function FormPublic({
  formId,
  formName,
  formDescription,
  fields,
}: FormPublicProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function handleChange(fieldId: string, value: unknown) {
    setFormValues((prev) => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[fieldId];
        return next;
      });
    }
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required) {
        const value = formValues[field.id];
        if (value === undefined || value === null || value === "") {
          newErrors[field.id] = `${field.name} is required`;
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/forms/${formId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: formValues }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to submit form");
      }

      setIsSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isSubmitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm"
        >
          <CheckCircle2 className="mx-auto h-12 w-12 text-zinc-800" />
          <h2 className="mt-4 text-2xl font-semibold text-zinc-900">
            Thank you!
          </h2>
          <p className="mt-2 text-sm text-zinc-500">
            Your submission has been received successfully.
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        <h1 className="text-2xl font-semibold text-zinc-900">{formName}</h1>
        {formDescription && (
          <p className="mt-1 text-sm text-zinc-500">{formDescription}</p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <label
                htmlFor={field.id}
                className="block text-sm font-medium text-zinc-700"
              >
                {field.name}
                {field.required && (
                  <span className="ml-0.5 text-red-500">*</span>
                )}
              </label>

              {renderField(field, formValues[field.id], handleChange)}

              {errors[field.id] && (
                <p className="flex items-center gap-1 text-xs text-red-500">
                  <AlertCircle className="h-3 w-3" />
                  {errors[field.id]}
                </p>
              )}
            </div>
          ))}

          {submitError && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {submitError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                Submit
              </>
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function renderField(
  field: FormField,
  value: unknown,
  onChange: (fieldId: string, value: unknown) => void
) {
  const baseSelectClass =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

  switch (field.type) {
    case "text":
      return (
        <Input
          id={field.id}
          type="text"
          placeholder={`Enter ${field.name}`}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case "email":
      return (
        <Input
          id={field.id}
          type="email"
          placeholder={`Enter ${field.name}`}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case "number":
      return (
        <Input
          id={field.id}
          type="number"
          placeholder={`Enter ${field.name}`}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case "date":
      return (
        <Input
          id={field.id}
          type="date"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      );

    case "textarea":
      return (
        <textarea
          id={field.id}
          placeholder={`Enter ${field.name}`}
          rows={4}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#18181B] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        />
      );

    case "dropdown":
      return (
        <select
          id={field.id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
          className={baseSelectClass}
        >
          <option value="">Select an option</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case "file":
      return (
        <Input
          id={field.id}
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            onChange(field.id, file?.name ?? "");
          }}
        />
      );

    case "checkbox":
      return (
        <div className="flex items-center gap-2">
          <input
            id={field.id}
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(field.id, e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
          />
          <span className="text-sm text-zinc-600">{field.name}</span>
        </div>
      );

    default:
      return null;
  }
}
