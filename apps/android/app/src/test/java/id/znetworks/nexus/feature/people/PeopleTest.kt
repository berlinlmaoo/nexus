package id.znetworks.nexus.feature.people

import id.znetworks.nexus.core.net.NexusJson
import org.junit.Assert.assertEquals
import org.junit.Test

class PeopleTest {
    @Test fun equalScoresShareAPlace() {
        val r = PeopleLogic.ranks(listOf(BoardRow("a", totalXp = 900), BoardRow("b", totalXp = 1100), BoardRow("c", totalXp = 1100), BoardRow("d", totalXp = 1000)))
        assertEquals(listOf(1 to "b", 1 to "c", 3 to "d", 4 to "a"), r.map { it.first to it.second.userId })
    }

    @Test fun competitionRanksTiesByNameAndSearch() {
        // 1, 1, 1, 4 (web competition-rank.ts); inside a tie by name A–Z.
        val r = PeopleLogic.ranks(listOf(BoardRow("z", "Zara", totalXp = 1000), BoardRow("a", "ani", totalXp = 1000), BoardRow("b", "Budi", totalXp = 1000), BoardRow("d", "Dewi", totalXp = 500)))
        assertEquals(listOf(1 to "a", 1 to "b", 1 to "z", 4 to "d"), r.map { it.first to it.second.userId })
        // Search keeps the board's ranks.
        assertEquals(listOf(4 to "d"), PeopleLogic.search(r, " dew ").map { it.first to it.second.userId })
        assertEquals(4, PeopleLogic.search(r, "").size)
    }

    @Test fun periodEndIsExclusive() {
        val (from, to) = PeopleLogic.periodDays(BoardPeriod("2026-09-30T17:00:00.000Z", "2026-10-31T17:00:00.000Z"))!!
        assertEquals(java.time.LocalDate.of(2026, 10, 1), from); assertEquals(java.time.LocalDate.of(2026, 10, 31), to)
    }

    @Test fun recordDecodesLeniently() {
        val m = NexusJson.decodeFromString(MemberRecord.serializer(), """{"person":{"id":"u","name":"Budi","isSelf":false},"viewer":{"scope":"ALL","canRemoveXp":true},
            "period":{"key":"2026-10","isCurrent":true,"previousKey":"2026-09"},"summary":{"score":{"worked":20,"working":22,"surplus":0},"counts":{"present":20,"lateDays":2,"lateMinutes":35}},
            "days":[{"date":"2026-09-28","day":28,"tone":"P","isToday":true}],"xp":{"entries":[{"id":"x","amount":0,"originalAmount":-25,"kind":"nocheckout","removed":{"by":{"name":"BoD"}}}],"hasOlder":true,"olderPeriod":"2026-09"},
            "requests":[{"id":"r","type":"PERMIT","status":"APPROVED"}]}""")
        assertEquals("-25", m.xp!!.entries.single().signed)
        assertEquals("2026-09", m.period.previousKey)
        assertEquals(35, m.summary!!.counts!!.lateMinutes)
    }
}
