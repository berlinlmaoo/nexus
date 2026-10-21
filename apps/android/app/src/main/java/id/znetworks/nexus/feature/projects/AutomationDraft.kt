package id.znetworks.nexus.feature.projects

import kotlinx.serialization.json.*

/** Builder limits and typed condition operators mirror automation-meta.ts and automation-rules.ts. */
object AutomationDraft {
    fun kind(field:String,defs:List<CustomFieldDef>):String = when(field){
        "status","priority","section"->"choice"
        "assignee","creator"->"person"
        "dueDate","startDate"->"date"
        else->when(defs.find{"cf:${it.id}"==field}?.kind){"NUMBER","RATING"->"number";"DATE","CREATED"->"date";"SELECT","DROPDOWN","MULTI_SELECT","STATUS","CHECKBOX"->"select";"PEOPLE"->"person";else->"text"}
    }
    fun operators(field:String,defs:List<CustomFieldDef>)=when(kind(field,defs)){
        "choice"->listOf("is","is_not")
        "person"->listOf("is","is_not","is_empty","is_not_empty")
        "date"->listOf("overdue","within_days","is_empty","is_not_empty","lt","gt")
        "number"->listOf("is","gt","lt","is_empty","is_not_empty")
        "select"->listOf("is","is_not","contains","is_empty","is_not_empty")
        else->listOf("contains","not_contains","is","is_empty","is_not_empty")
    }
    fun valid(trigger:Rule,actions:List<Rule>,conditions:Conditions):Boolean {
        if(actions.size !in 1..10 || conditions.rules.size>10 || trigger.type !in AutomationText.TRIGGERS || trigger.type == "WEBHOOK_RECEIVED")return false
        val cfg=trigger.config.orEmpty()
        fun config(key:String)=(cfg[key]as?JsonPrimitive)?.contentOrNull
        if(trigger.type=="FIELD_CHANGED"&&trigger.field.isNullOrBlank())return false
        if(trigger.type=="DUE_DATE_APPROACHING"&&trigger.text!=null&&trigger.text?.toDoubleOrNull()?.let{it in 1.0..720.0}!=true)return false
        if(trigger.type=="SCHEDULED"){
            if(!Regex("([01][0-9]|2[0-3]):[0-5][0-9]").matches(config("time")?:"09:00"))return false
            when(config("frequency")?:"daily"){
                "weekly"->if((cfg["days"]as?JsonArray).isNullOrEmpty())return false
                "monthly"->if((config("dayOfMonth")?:"1").toIntOrNull() !in 1..28)return false
                "daily","weekdays"->Unit
                else->return false
            }
        }
        if(actions.any{a->when(a.type){"SET_STATUS"->a.text !in AutomationText.STATUSES;"SET_PRIORITY"->a.text !in AutomationText.PRIORITIES;"ASSIGN_TO","UNASSIGN","MOVE_TO_SECTION","ADD_TAG","REMOVE_TAG","ADD_COMMENT"->a.text.isNullOrBlank();"SET_FIELD"->a.field.isNullOrBlank();else->a.type !in AutomationText.ACTIONS}})return false
        if(conditions.rules.any{it.field.isBlank()||it.op.isBlank()||(it.op !in listOf("is_empty","is_not_empty","overdue")&&it.text.isNullOrBlank())})return false
        return true
    }
    fun status(rule:Rule,side:String,value:String,lanes:List<Lane>):Rule {
        val cfg=rule.config.orEmpty().toMutableMap()
        val section=lanes.find{it.id==value}
        val status=if(value.startsWith("status:"))value.removePrefix("status:")else section?.taskStatus
        if(side=="action"){
            if(section==null)cfg.remove("sectionId")else cfg["sectionId"]=JsonPrimitive(section.id)
            return rule.copy(value=status?.let{JsonPrimitive(it)},config=JsonObject(cfg))
        }
        cfg["bySection"]=JsonPrimitive(true)
        if(section==null)cfg.remove(if(side=="from")"fromSection" else "toSection")else cfg[if(side=="from")"fromSection" else "toSection"]=JsonPrimitive(section.id)
        if(side=="from"){if(status==null)cfg.remove("from")else cfg["from"]=JsonPrimitive(status);return rule.copy(config=JsonObject(cfg))}
        return rule.copy(value=status?.let{JsonPrimitive(it)},config=JsonObject(cfg))
    }
}
