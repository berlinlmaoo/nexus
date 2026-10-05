package id.znetworks.nexus.feature.calendar

import id.znetworks.nexus.core.net.ApiClient
import kotlinx.serialization.KSerializer
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap

/**
 * `/api/calendar/…` (server live 5 Oct 2026, nexus 70f0d67). Every route answers with an ETag; this
 * sends it back as If-None-Match and treats 304 as "unchanged", handing back what it already holds — so
 * the screen can poll every `values.calendarPollSeconds` while visible for the price of a header.
 * 401 (signed out) and 426 go through ApiClient as everywhere else.
 */
class CalendarApi(private val api: ApiClient) {
    /** A response and whether it changed since the last time this path was asked. */
    data class Fetched<T>(val value: T, val changed: Boolean)

    private class Held(val etag: String?, val value: Any?)
    private val held = ConcurrentHashMap<String, Held>()

    /** The Bagan as the Calendar groups by it (refetch when an items response names another `structureVersion`). */
    suspend fun structure(): Fetched<CalStructure> = fetch("/api/calendar/structure", CalStructure.serializer())

    /** Tasks due on the WIB days [from]..[to] inclusive (at most [MAX_DAYS] days; the server says BAD_RANGE / RANGE_TOO_LONG otherwise). */
    suspend fun items(from: String, to: String): Fetched<CalItems> {
        require(CalDays.isDayKey(from) && CalDays.isDayKey(to) && to >= from) { "from/to must be YYYY-MM-DD, to not before from" }
        require(CalDays.dayDiff(from, to) + 1 <= MAX_DAYS) { "at most $MAX_DAYS days" }
        return fetch("/api/calendar/items?from=${enc(from)}&to=${enc(to)}", CalItems.serializer())
    }

    /** Every open task with a day before today, newest day first (≤ 1000 + truncated). */
    suspend fun overdue(): Fetched<CalItems> = fetch("/api/calendar/overdue", CalItems.serializer())

    /** The widgets' / Watch's compact snapshot. */
    suspend fun glance(scope: GlanceScope): Fetched<CalGlance> = fetch("/api/calendar/glance?scope=${scope.wire}", CalGlance.serializer())

    /** Forget every held response (sign-out, another person). */
    fun clear() = held.clear()

    @Suppress("UNCHECKED_CAST")
    private suspend fun <T> fetch(path: String, serializer: KSerializer<T>): Fetched<T> {
        val mine = held[path]
        return when (val r = api.getConditional(path, serializer, mine?.etag?.takeIf { mine.value != null })) {
            is ApiClient.Conditional.Fresh -> {
                held[path] = Held(r.etag, r.value)
                Fetched(r.value, changed = true)
            }
            ApiClient.Conditional.NotModified -> {
                val value = mine?.value as T?
                if (value != null) Fetched(value, changed = false)
                else {
                    // 304 without anything held (cleared meanwhile): ask again, unconditionally.
                    held.remove(path)
                    val again = api.getConditional(path, serializer, null) as? ApiClient.Conditional.Fresh
                        ?: error("304 to an unconditional GET of $path")
                    held[path] = Held(again.etag, again.value)
                    Fetched(again.value, changed = true)
                }
            }
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    companion object {
        /** Longest range one items call may ask for, inclusive (server MAX_DAYS). */
        const val MAX_DAYS = 62
    }
}
