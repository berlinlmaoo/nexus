package id.znetworks.nexus.feature.people

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class RecordPeriodLabelTest {
    private val period = RecPeriod(key = "2026-10", from = "2026-09-28", to = "2026-10-27", label = "28 Sep – 27 Oct 2026")

    @Test fun indonesianDoesNotReuseTheEnglishServerLabel() {
        assertEquals("28 Sep – 27 Okt 2026", PeopleLogic.recordPeriodLabel(period, Locale.forLanguageTag("id-ID")))
    }

    @Test fun englishKeepsTheExistingRangeAndInclusiveLastDay() {
        assertEquals("28 Sep – 27 Oct 2026", PeopleLogic.recordPeriodLabel(period, Locale.US))
    }

    @Test fun timestampBoundsRemainCalendarDaysAcrossTheYearBoundary() {
        val p = period.copy(from = "2026-12-28T00:00:00Z", to = "2027-01-27T23:59:59Z")
        assertEquals("28 Des – 27 Jan 2027", PeopleLogic.recordPeriodLabel(p, Locale.forLanguageTag("id-ID")))
    }

    @Test fun olderOrMalformedResponsesKeepTheirFallback() {
        assertEquals("Legacy range", PeopleLogic.recordPeriodLabel(RecPeriod(label = "Legacy range"), Locale.US))
        assertEquals("2026-10", PeopleLogic.recordPeriodLabel(RecPeriod(key = "2026-10", from = "bad", to = "2026-10-27"), Locale.US))
    }
}
