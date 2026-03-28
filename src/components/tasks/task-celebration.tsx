"use client"

import { useEffect, useState, useCallback } from "react"

interface Particle {
  id: number
  x: number
  y: number
  color: string
  size: number
  velocityX: number
  velocityY: number
  rotation: number
  rotationSpeed: number
  opacity: number
  shape: "circle" | "square" | "star"
}

const COLORS = [
  "#22c55e", "#10b981", "#06b6d4", "#3b82f6",
  "#8b5cf6", "#ec4899", "#f97316", "#eab308",
]

const SHAPES: Particle["shape"][] = ["circle", "square", "star"]

function createParticles(x: number, y: number, count = 24): Particle[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5
    const speed = 2 + Math.random() * 4
    return {
      id: i,
      x,
      y,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 4 + Math.random() * 4,
      velocityX: Math.cos(angle) * speed,
      velocityY: Math.sin(angle) * speed - 2,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 15,
      opacity: 1,
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
    }
  })
}

function StarSVG({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

export function TaskCelebration({
  trigger,
  originRef,
}: {
  trigger: number
  originRef?: React.RefObject<HTMLElement | null>
}) {
  const [particles, setParticles] = useState<Particle[]>([])
  const [show, setShow] = useState(false)

  const burst = useCallback(() => {
    const rect = originRef?.current?.getBoundingClientRect()
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
    setParticles(createParticles(x, y))
    setShow(true)
  }, [originRef])

  useEffect(() => {
    if (trigger > 0) burst()
  }, [trigger, burst])

  useEffect(() => {
    if (!show) return
    let frame: number
    const animate = () => {
      setParticles((prev) => {
        const next = prev
          .map((p) => ({
            ...p,
            x: p.x + p.velocityX,
            y: p.y + p.velocityY,
            velocityY: p.velocityY + 0.12,
            velocityX: p.velocityX * 0.99,
            rotation: p.rotation + p.rotationSpeed,
            opacity: p.opacity - 0.015,
          }))
          .filter((p) => p.opacity > 0)
        if (next.length === 0) {
          setShow(false)
          return []
        }
        return next
      })
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [show])

  if (!show || particles.length === 0) return null

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute"
          style={{
            left: p.x,
            top: p.y,
            opacity: p.opacity,
            transform: `rotate(${p.rotation}deg)`,
            willChange: "transform, opacity",
          }}
        >
          {p.shape === "circle" && (
            <div
              className="rounded-full"
              style={{ width: p.size, height: p.size, backgroundColor: p.color }}
            />
          )}
          {p.shape === "square" && (
            <div
              className="rounded-sm"
              style={{ width: p.size, height: p.size, backgroundColor: p.color }}
            />
          )}
          {p.shape === "star" && <StarSVG size={p.size + 2} color={p.color} />}
        </div>
      ))}
    </div>
  )
}

/**
 * Animated checkbox that shows a satisfying fill animation on completion.
 */
export function AnimatedCheckbox({
  checked,
  onChange,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  const [animating, setAnimating] = useState(false)

  const handleClick = () => {
    if (!checked) {
      setAnimating(true)
      setTimeout(() => setAnimating(false), 400)
    }
    onChange(!checked)
  }

  return (
    <button
      onClick={handleClick}
      className={className}
      aria-checked={checked}
      role="checkbox"
    >
      <div
        className={`relative h-4 w-4 rounded-full border-2 transition-all duration-200 ${
          checked
            ? "bg-green-500 border-green-500 scale-100"
            : "border-muted-foreground/40 hover:border-muted-foreground scale-100"
        } ${animating ? "scale-125" : ""}`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          className={`absolute inset-0 h-4 w-4 transition-all duration-200 ${
            checked ? "opacity-100 scale-100" : "opacity-0 scale-75"
          }`}
        >
          <path
            d="M4.5 8.5L7 11L11.5 5.5"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </button>
  )
}
