import { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  icon,
  actions,
  tabs,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
      <div className="px-4 md:px-8 pt-4 md:pt-6 pb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-6">
        <div className="flex items-start gap-3 min-w-0">
          {icon && <div className="text-2xl mt-0.5 shrink-0">{icon}</div>}
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight truncate">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap sm:shrink-0">{actions}</div>}
      </div>
      {tabs && <div className="px-4 md:px-8 overflow-x-auto">{tabs}</div>}
    </div>
  );
}
