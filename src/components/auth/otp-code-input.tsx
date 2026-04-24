"use client"

import type React from "react"
import { useEffect, useRef } from "react"

interface OtpCodeInputProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
}

const OTP_LENGTH = 6

function toDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, OTP_LENGTH)
}

export function OtpCodeInput({
  value,
  onChange,
  disabled = false,
  autoFocus = false,
}: OtpCodeInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const digits = Array.from({ length: OTP_LENGTH }, (_, index) => value[index] ?? "")

  useEffect(() => {
    if (!autoFocus || disabled) return
    refs.current[0]?.focus()
  }, [autoFocus, disabled])

  function focusIndex(index: number) {
    refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, index))]?.focus()
  }

  function applyValue(nextValue: string, focusTarget?: number) {
    const normalized = toDigits(nextValue)
    onChange(normalized)
    if (typeof focusTarget === "number") {
      window.requestAnimationFrame(() => focusIndex(focusTarget))
    }
  }

  function handleChange(index: number, rawValue: string) {
    const normalized = toDigits(rawValue)

    if (normalized.length > 1) {
      applyValue(
        `${value.slice(0, index)}${normalized}${value.slice(index + normalized.length)}`,
        Math.min(OTP_LENGTH - 1, index + normalized.length)
      )
      return
    }

    const nextChars = [...digits]
    nextChars[index] = normalized
    applyValue(nextChars.join(""), normalized ? index + 1 : index)
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      if (digits[index]) {
        const nextChars = [...digits]
        nextChars[index] = ""
        applyValue(nextChars.join(""), index)
        event.preventDefault()
        return
      }

      if (index > 0) {
        const nextChars = [...digits]
        nextChars[index - 1] = ""
        applyValue(nextChars.join(""), index - 1)
        event.preventDefault()
      }
      return
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault()
      focusIndex(index - 1)
      return
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      focusIndex(index + 1)
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const pasted = toDigits(event.clipboardData.getData("text"))
    if (!pasted) return
    applyValue(pasted, Math.min(OTP_LENGTH - 1, pasted.length))
  }

  return (
    <div className="flex items-center justify-between gap-2 sm:gap-3">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={OTP_LENGTH}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          className="h-14 w-full rounded-2xl border-none bg-surface-container-low text-center text-xl font-black tracking-[0.18em] text-primary outline-none transition-all focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-60 sm:h-16 sm:text-2xl"
          aria-label={`OTP digit ${index + 1}`}
        />
      ))}
    </div>
  )
}
