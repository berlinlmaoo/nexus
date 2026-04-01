"use client"

import React, { Component, ErrorInfo, ReactNode } from "react"
import { AlertTriangle, RefreshCcw } from "lucide-react"
import { Button } from "./button"

interface Props {
  children?: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  }

  public static getDerivedStateFromError(_: Error): State {
    return { hasError: true }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo)
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center py-20 px-6 text-center bg-surface-container-low/30 rounded-[2rem] border border-dashed border-on-surface-variant/10">
          <div className="h-16 w-16 rounded-3xl bg-red-50 flex items-center justify-center text-red-600 mb-6">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <h2 className="text-xl font-headline font-black text-on-surface tracking-tight mb-2">Intelligence Node Failure</h2>
          <p className="text-sm text-on-surface-variant/60 font-medium max-w-xs mb-8">
            The requested module encountered a runtime exception during execution.
          </p>
          <Button 
            onClick={() => this.setState({ hasError: false })}
            className="h-12 px-6 bg-primary text-primary-foreground rounded-xl font-black text-xs uppercase tracking-widest"
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Restart Module
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
