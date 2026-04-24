type ReverseGeocodeResult = {
  displayName: string | null
}

function getReverseGeocodeUserAgent() {
  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "https://nexus.local"
  const host = (() => {
    try {
      return new URL(baseUrl).host
    } catch {
      return "nexus.local"
    }
  })()

  return `NEXUS Attendance (${host})`
}

export async function reverseGeocodeCoordinates(lat: number, lng: number): Promise<ReverseGeocodeResult> {
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(lat),
      lon: String(lng),
      zoom: "18",
      addressdetails: "1",
    })

    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params.toString()}`, {
      headers: {
        "Accept-Language": "id,en",
        "User-Agent": getReverseGeocodeUserAgent(),
      },
      next: { revalidate: 60 * 60 * 24 },
    })

    if (!response.ok) {
      return { displayName: null }
    }

    const payload = (await response.json()) as { display_name?: string }
    return {
      displayName: payload.display_name?.trim() || null,
    }
  } catch {
    return { displayName: null }
  }
}
