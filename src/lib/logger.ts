type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  context?: string
  data?: Record<string, unknown>
  timestamp: string
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel]
}

function formatEntry(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    entry.context ? `[${entry.context}]` : '',
    entry.message,
  ].filter(Boolean)

  if (entry.data && Object.keys(entry.data).length > 0) {
    return `${parts.join(' ')} ${JSON.stringify(entry.data)}`
  }
  return parts.join(' ')
}

function log(level: LogLevel, context: string, message: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return

  const entry: LogEntry = {
    level,
    message,
    context,
    data,
    timestamp: new Date().toISOString(),
  }

  const formatted = formatEntry(entry)

  switch (level) {
    case 'error':
      console.error(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    default:
      console.log(formatted)
  }
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => log('debug', context, message, data),
    info: (message: string, data?: Record<string, unknown>) => log('info', context, message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('warn', context, message, data),
    error: (message: string, data?: Record<string, unknown>) => log('error', context, message, data),
  }
}
