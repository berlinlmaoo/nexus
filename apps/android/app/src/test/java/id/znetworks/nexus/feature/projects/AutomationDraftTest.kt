package id.znetworks.nexus.feature.projects
import kotlinx.serialization.json.*
import org.junit.Test
import org.junit.Assert.*
class AutomationDraftTest {
    @Test fun weeklyDaysAndMonthlyBoundsMustBeComplete(){
        val action=listOf(Rule("MARK_COMPLETE"))
        fun schedule(frequency:String,days:List<Int> = emptyList(),day:String="1",time:String="09:00")=Rule("SCHEDULED",config=buildJsonObject{put("frequency",frequency);put("time",time);put("days",JsonArray(days.map{JsonPrimitive(it)}));put("dayOfMonth",day)})
        assertFalse(AutomationDraft.valid(schedule("weekly"),action,Conditions()))
        assertTrue(AutomationDraft.valid(schedule("weekly",listOf(1,7)),action,Conditions()))
        assertFalse(AutomationDraft.valid(schedule("monthly",day="0"),action,Conditions()))
        assertFalse(AutomationDraft.valid(schedule("monthly",day="29"),action,Conditions()))
        assertFalse(AutomationDraft.valid(schedule("daily",time="25:00"),action,Conditions()))
        assertTrue(AutomationDraft.valid(schedule("monthly",day="28"),action,Conditions()))
    }
    @Test fun sectionStatusRoutingKeepsTheSectionAndCompatibleEnum(){
        val lanes=listOf(Lane("first","Review A",taskStatus="IN_REVIEW"),Lane("second","Review B",taskStatus="IN_REVIEW"))
        val rule=Rule("STATUS_CHANGED",config=buildJsonObject{put("future","keep")})
        val from=AutomationDraft.status(rule,"from","first",lanes)
        val to=AutomationDraft.status(from,"to","second",lanes)
        assertEquals("IN_REVIEW",to.text);assertEquals(JsonPrimitive("first"),to.config!!["fromSection"]);assertEquals(JsonPrimitive("second"),to.config!!["toSection"])
        val any=AutomationDraft.status(to,"to","",lanes);assertNull(any.value);assertNull(any.config!!["toSection"]);assertEquals(JsonPrimitive("keep"),any.config!!["future"])
        val action=AutomationDraft.status(Rule("SET_STATUS"),"action","second",lanes)
        assertEquals("IN_REVIEW",action.text);assertEquals(JsonPrimitive("second"),action.config!!["sectionId"])
        assertNull(AutomationDraft.status(action,"action","status:DONE",lanes).config!!["sectionId"])
    }
    @Test fun customFieldOperatorsFollowTheirTypes(){
        val defs=listOf(CustomFieldDef("amount","Amount","NUMBER"),CustomFieldDef("date","Date","DATE"))
        assertTrue("gt" in AutomationDraft.operators("cf:amount",defs));assertFalse("contains" in AutomationDraft.operators("cf:amount",defs));assertTrue("within_days" in AutomationDraft.operators("cf:date",defs));assertEquals(listOf("is","is_not"),AutomationDraft.operators("status",defs))
    }
}
