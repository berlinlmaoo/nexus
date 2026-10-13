package id.znetworks.nexus.feature.home

import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.feature.projects.BoardTask
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate

class HomeLogicTest {
    @Test fun greetingByOfficeHour() {
        assertEquals(HomeLogic.Greeting.EVENING, HomeLogic.greeting(3))
        assertEquals(HomeLogic.Greeting.MORNING, HomeLogic.greeting(4))
        assertEquals(HomeLogic.Greeting.MORNING, HomeLogic.greeting(10))
        assertEquals(HomeLogic.Greeting.AFTERNOON, HomeLogic.greeting(11))
        assertEquals(HomeLogic.Greeting.EVENING, HomeLogic.greeting(18))
    }

    @Test fun agendaKeepsFourteenDaysFromToday() {
        val today = LocalDate.of(2026, 9, 28)
        val a = HomeLogic.agenda(listOf(
            BoardTask("past", dueDate = "2026-09-27T00:00:00.000Z"),
            BoardTask("today", dueDate = "2026-09-28T00:00:00.000Z"),
            BoardTask("last", dueDate = "2026-10-11"),
            BoardTask("beyond", dueDate = "2026-10-12"),
            BoardTask("none"),
        ), today)
        assertEquals(setOf(today, LocalDate.of(2026, 10, 11)), a.keys)
        assertEquals("today", a[today]!!.single().id)
    }

    @Test fun gamificationDecodesAndCountsClaimed() {
        val g = NexusJson.decodeFromString(Gamification.serializer(), """
            {"xp":{"totalXp":1250,"level":4,"levelName":"Ranger","floor":1000,"nextFloor":1500,"pct":50},
             "streak":{"current":3,"longest":9},
             "quests":[{"key":"a","title":"A","progress":2,"target":2,"xpReward":20,"claimed":true,"claimable":false},
                       {"key":"b","title":"B","progress":2,"target":2,"xpReward":10,"claimable":true}]}""")
        assertEquals(1, g.questsDone)
        // iOS / web: total XP over the next level's floor, whatever pct says (dev, 14 Oct: 1,000 / 1,150 drew an empty bar).
        assertEquals(1250f / 1500f, g.levelFraction, 0.001f)
        assertEquals(1000f / 1150f, g.copy(xp = g.xp.copy(totalXp = 1000, floor = 1000, nextFloor = 1150, pct = 0.0)).levelFraction, 0.001f)
        assertEquals(1f, g.copy(xp = g.xp.copy(nextFloor = null)).levelFraction, 0.001f)
        assertEquals("1,250 XP / 1,500", g.xpLabel(java.util.Locale.UK))
        assertEquals("1.250 XP", g.copy(xp = g.xp.copy(nextFloor = null)).xpLabel(java.util.Locale.forLanguageTag("id-ID")))
    }
}
