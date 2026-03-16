"use client"

import { Card, CardContent } from "@/components/ui/card"
import { type LucideIcon } from "lucide-react"

interface MetricCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  trend?: number
  iconBg?: string
  iconColor?: string
}

export function MetricCard({ icon: Icon, label, value, trend, iconBg = "bg-zinc-100 dark:bg-zinc-800", iconColor = "text-zinc-700 dark:text-zinc-300" }: MetricCardProps) {
  return (
    <Card className="min-w-[160px]">
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate" title={label}>{label}</p>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold">{value}</p>
              {trend !== undefined && trend !== 0 && (
                <span className={`text-xs font-medium ${trend > 0 ? "text-green-600" : "text-red-600"}`}>
                  {trend > 0 ? "+" : ""}{trend}%
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
