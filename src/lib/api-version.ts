import { NextRequest, NextResponse } from "next/server"

export const CURRENT_API_VERSION = "v1"
export const SUPPORTED_VERSIONS = ["v1"] as const

export type ApiVersion = (typeof SUPPORTED_VERSIONS)[number]

/**
 * Extract API version from request headers or query params.
 * Supports:
 *   - Header: X-API-Version: v1
 *   - Query: ?api_version=v1
 *   - Default: current version
 */
export function getApiVersion(req: NextRequest): ApiVersion {
  const headerVersion = req.headers.get("x-api-version")
  const queryVersion = req.nextUrl.searchParams.get("api_version")
  const version = headerVersion || queryVersion || CURRENT_API_VERSION

  if (SUPPORTED_VERSIONS.includes(version as ApiVersion)) {
    return version as ApiVersion
  }

  return CURRENT_API_VERSION
}

/**
 * Add API version info to response headers.
 */
export function withVersionHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-API-Version", CURRENT_API_VERSION)
  response.headers.set("X-API-Supported-Versions", SUPPORTED_VERSIONS.join(", "))
  return response
}

/**
 * Returns 400 if an unsupported API version is explicitly requested.
 */
export function validateApiVersion(req: NextRequest): NextResponse | null {
  const headerVersion = req.headers.get("x-api-version")
  const queryVersion = req.nextUrl.searchParams.get("api_version")
  const requested = headerVersion || queryVersion

  if (requested && !SUPPORTED_VERSIONS.includes(requested as ApiVersion)) {
    return NextResponse.json(
      {
        error: `Unsupported API version: ${requested}`,
        supported: SUPPORTED_VERSIONS,
        current: CURRENT_API_VERSION,
      },
      { status: 400 }
    )
  }

  return null
}
