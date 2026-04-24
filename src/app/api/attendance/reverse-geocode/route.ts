import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { reverseGeocodeCoordinates } from "@/lib/reverse-geocode"
import { reverseGeocodeQuerySchema } from "@/lib/validations"

export async function GET(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const parsed = reverseGeocodeQuerySchema.safeParse({
      lat: request.nextUrl.searchParams.get("lat"),
      lng: request.nextUrl.searchParams.get("lng"),
    })

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const result = await reverseGeocodeCoordinates(parsed.data.lat, parsed.data.lng)
    return NextResponse.json({
      address: result.displayName,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
    })
  } catch (error) {
    console.error("Error reverse geocoding attendance location:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
