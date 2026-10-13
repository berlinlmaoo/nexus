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
        assertEquals(0.5f, g.levelFraction, 0.001f)
        assertEquals(0.5f, g.copy(xp = g.xp.copy(pct = null)).levelFraction, 0.001f)
        assertEquals(0.25f, g.copy(xp = g.xp.copy(pct = 0.25)).levelFraction, 0.001f)
    }
}
