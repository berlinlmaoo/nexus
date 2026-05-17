"use client";

import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { FormField, FormFieldCondition } from "./form-builder";

interface FormBranding {
  logoUrl?: string;
  primaryColor?: string;
  backgroundColor?: string;
  headerImage?: string;
}

interface TaskListOption {
  id: string;
  name: string;
}

interface FormPublicProps {
  formId: string;
  formName: string;
  formDescription?: string | null;
  fields: FormField[];
  branding?: FormBranding | null;
  taskLists?: TaskListOption[];
}

function evaluateCondition(
  condition: FormFieldCondition,
  formValues: Record<string, unknown>
): boolean {
  const rawValue = formValues[condition.fieldId];
  const values = Array.isArray(rawValue)
    ? rawValue.map((item) => String(item))
    : [String(rawValue ?? "")];
  const fieldValue = values.join(", ");

  switch (condition.operator) {
    case "equals":
      return values.includes(condition.value);
    case "not_equals":
      return !values.includes(condition.value);
    case "contains":
      return fieldValue.toLowerCase().includes(condition.value.toLowerCase());
    case "is_empty":
      return !fieldValue;
    case "is_not_empty":
      return !!fieldValue;
    default:
      return true;
  }
}

function isRupiahField(field: FormField) {
  if (field.type !== "number") return false;
  return /\b(harga|biaya|nominal|budget|amount|total|nilai|price|cost)\b/i.test(field.name);
}

function getAttachmentFieldKey(fieldId: string) {
  return `attachment:${fieldId}`;
}

function cleanNumericInput(value: string) {
  return value.replace(/[^\d]/g, "");
}

function formatRupiah(value: unknown) {
  const digits = cleanNumericInput(String(value ?? ""));
  if (!digits) return "";
  return `Rp ${Number(digits).toLocaleString("id-ID")}`;
}

function getBranchDepth(field: FormField, fieldsById: Map<string, FormField>, trail = new Set<string>()): number {
  if (!field.showIf?.fieldId || trail.has(field.id)) return 0;
  const parent = fieldsById.get(field.showIf.fieldId);
  if (!parent) return 1;
  trail.add(field.id);
  return 1 + getBranchDepth(parent, fieldsById, trail);
}

export function FormPublic({
  formId,
  formName,
  formDescription,
  fields,
  branding,
  taskLists = [],
}: FormPublicProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const normalizedFields = useMemo(() => {
    const sectionOptions = taskLists.map((taskList) => taskList.name);
    if (sectionOptions.length === 0) return fields;

    return fields.map((field) =>
      field.mapping?.target === "task_list"
        ? { ...field, type: "dropdown" as const, options: sectionOptions }
        : field
    );
  }, [fields, taskLists]);

  const visibleFields = useMemo(() => {
    return normalizedFields.filter((field) => {
      if (!field.showIf) return true;
      return evaluateCondition(field.showIf, formValues);
    });
  }, [normalizedFields, formValues]);

  const fieldsById = useMemo(() => {
    return new Map(normalizedFields.map((field) => [field.id, field]));
  }, [normalizedFields]);

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
    for (const field of visibleFields) {
      if (field.required) {
        const value = formValues[field.id];
        if (
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
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
      const serializableValues: Record<string, unknown> = {};
      const payload = new FormData();

      for (const field of visibleFields) {
        const value = formValues[field.id];
        if (field.type === "file" && value instanceof File) {
          serializableValues[field.id] = value.name;
          payload.append(`file:${field.id}`, value);
        } else {
          serializableValues[field.id] = value ?? "";
        }

        const attachment = formValues[getAttachmentFieldKey(field.id)];
        if (field.attachmentEnabled && attachment instanceof File) {
          serializableValues[getAttachmentFieldKey(field.id)] = attachment.name;
          payload.append(`attachment:${field.id}`, attachment);
        }
      }

      payload.append("data", JSON.stringify(serializableValues));

      const res = await fetch(`/api/forms/${formId}/submit`, {
        method: "POST",
        body: payload,
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
      <div className="flex min-h-[100svh] items-center justify-center bg-zinc-50 p-4">
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

  const bgColor = branding?.backgroundColor || undefined;
  const primaryColor = branding?.primaryColor || undefined;

  return (
    <div
      className="mobile-scroll-area flex min-h-[100svh] items-center justify-center overflow-y-auto bg-zinc-50 p-4"
      style={bgColor ? { backgroundColor: bgColor } : undefined}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-8 shadow-sm"
      >
        {branding?.headerImage && (
          <div className="-mx-8 -mt-8 mb-6 overflow-hidden rounded-t-xl">
            <img
              src={branding.headerImage}
              alt=""
              className="h-32 w-full object-cover"
            />
          </div>
        )}

        {branding?.logoUrl && (
          <img
            src={branding.logoUrl}
            alt="Logo"
            className="mb-4 h-10 object-contain"
          />
        )}

        <h1
          className="text-2xl font-semibold text-zinc-900"
          style={primaryColor ? { color: primaryColor } : undefined}
        >
          {formName}
        </h1>
        {formDescription && (
          <p className="mt-1 text-sm text-zinc-500">{formDescription}</p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {visibleFields.map((field) => {
            const branchDepth = getBranchDepth(field, fieldsById);

            return (
            <motion.div
              key={field.id}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex gap-2"
            >
              {branchDepth > 0 && (
                <div
                  className="flex shrink-0 justify-end gap-1 pt-1"
                  style={{ width: branchDepth * 14 }}
                  aria-hidden="true"
                >
                  {Array.from({ length: branchDepth }).map((_, index) => (
                    <div
                      key={`${field.id}-branch-line-${index}`}
                      className={cn(
                        "min-h-full w-px rounded-full",
                        index === branchDepth - 1 ? "bg-zinc-900/35" : "bg-zinc-200"
                      )}
                    />
                  ))}
                </div>
              )}
              <div className={cn("min-w-0 flex-1 space-y-1.5", branchDepth > 0 && "rounded-lg bg-zinc-50/50 p-3")}>
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

                {field.attachmentEnabled && field.type !== "file" && (
                  <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3">
                    <label
                      htmlFor={`${field.id}-attachment`}
                      className="mb-2 block text-xs font-medium text-zinc-500"
                    >
                      Add attachment for {field.name} (optional)
                    </label>
                    <Input
                      id={`${field.id}-attachment`}
                      type="file"
                      accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        handleChange(getAttachmentFieldKey(field.id), file ?? "");
                      }}
                    />
                  </div>
                )}

                {errors[field.id] && (
                  <p className="flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="h-3 w-3" />
                    {errors[field.id]}
                  </p>
                )}
              </div>
            </motion.div>
            );
          })}

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
              "inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              !primaryColor &&
                "bg-zinc-900 hover:bg-zinc-800 focus-visible:ring-zinc-900"
            )}
            style={
              primaryColor
                ? { backgroundColor: primaryColor }
                : undefined
            }
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
      if (isRupiahField(field)) {
        return (
          <Input
            id={field.id}
            type="text"
            inputMode="numeric"
            placeholder="Rp 0"
            value={formatRupiah(value)}
            onChange={(e) => onChange(field.id, cleanNumericInput(e.target.value))}
          />
        );
      }

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
          {field.options?.filter(Boolean).map((opt, optionIndex) => (
            <option key={`${opt}-${optionIndex}`} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case "multi_select": {
      const selectedValues = Array.isArray(value) ? value.map((item) => String(item)) : [];
      return (
        <div className="space-y-2 rounded-md border border-input bg-background p-3">
          {field.options?.filter(Boolean).map((opt, optionIndex) => {
            const isChecked = selectedValues.includes(opt);
            return (
              <label key={`${opt}-${optionIndex}`} className="flex items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    const nextValues = e.target.checked
                      ? [...selectedValues, opt]
                      : selectedValues.filter((item) => item !== opt);
                    onChange(field.id, nextValues);
                  }}
                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                {opt}
              </label>
            );
          })}
        </div>
      );
    }

    case "file":
      return (
        <Input
          id={field.id}
          type="file"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            onChange(field.id, file ?? "");
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
