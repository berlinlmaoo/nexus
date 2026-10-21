package id.znetworks.nexus.feature.docs

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.social.*
import kotlinx.serialization.json.*
import okhttp3.Request
import java.net.URLEncoder

/** JSON trees are copied only along an edited path. Unknown nodes and marks elsewhere stay exact. */
object BlockTree {
    data class Line(val path: List<Int>, val node: JsonObject, val editable: Boolean)
    private val textBlocks = setOf("paragraph","heading","codeBlock","detailsSummary")
    private val containers = setOf("doc","bulletList","orderedList","taskList","listItem","taskItem","blockquote","details","detailsContent")
    fun valid(doc: JsonObject) = doc.text("type") == "doc" && doc["content"] is JsonArray
    fun text(node: JsonElement?): String = when(node) { is JsonObject -> if(node.text("type")=="text") node.text("text") else if(node.text("type")=="hardBreak") "\n" else (node["content"] as? JsonArray)?.joinToString(""){text(it)}.orEmpty(); else -> "" }
    fun lines(doc: JsonObject): List<Line> = buildList {
        fun walk(node: JsonObject,path:List<Int>) {
            val type=node.text("type")
            if(type in containers) (node["content"] as? JsonArray)?.forEachIndexed{i,n->if(n is JsonObject)walk(n,path+i)}
            else add(Line(path,node,type in textBlocks && (node["content"] as? JsonArray).orEmpty().all { it is JsonObject && it.text("type") in setOf("text","hardBreak") }))
        };walk(doc,emptyList())
    }
    fun at(doc:JsonObject,path:List<Int>):JsonObject = path.fold(doc){n,i->n["content"]!!.jsonArray[i].jsonObject}
    fun update(doc:JsonObject,path:List<Int>,edit:(JsonObject)->JsonObject):JsonObject {
        if(path.isEmpty())return edit(doc)
        val children=doc["content"]!!.jsonArray.toMutableList();val i=path.first();children[i]=update(children[i].jsonObject,path.drop(1),edit)
        return JsonObject(doc+("content" to JsonArray(children)))
    }
    /** Changed text keeps the marks on the unchanged prefix/suffix and uses the insertion's nearby style. */
    fun replaceText(node:JsonObject,value:String):JsonObject {
        val old=text(node);if(old==value)return node
        val raw=(node["content"] as? JsonArray).orEmpty()
        // Keep a local empty run as the typing style when the user clears the field.
        // The canonical writer sanitizes empty text if an empty paragraph is saved.
        if(raw.any { it.jsonObject.text("type") !in setOf("text", "hardBreak") }) return node
        if(value.isEmpty() && raw.any { it.jsonObject.text("type")=="text" }) {
            val emptyRun = JsonObject(raw.first { it.jsonObject.text("type")=="text" }.jsonObject+("text" to JsonPrimitive("")))
            return JsonObject(node+("content" to JsonArray(listOf(emptyRun))))
        }
        var prefix=0;while(prefix<old.length&&prefix<value.length&&old[prefix]==value[prefix])prefix++
        if(prefix in 1 until old.length && old[prefix].isLowSurrogate() && old[prefix-1].isHighSurrogate()) prefix--
        var suffix=0;while(suffix<old.length-prefix&&suffix<value.length-prefix&&old[old.lastIndex-suffix]==value[value.lastIndex-suffix])suffix++
        if(suffix>0 && old.length-suffix>0 && old[old.length-suffix].isLowSurrogate() && old[old.length-suffix-1].isHighSurrogate()) suffix--
        fun slice(start:Int,end:Int):List<JsonElement>{var pos=0;return raw.mapNotNull{e->val n=e.jsonObject;val hardBreak=n.text("type")=="hardBreak";val t=if(hardBreak)"\n" else n.text("text");val a=maxOf(0,start-pos);val b=minOf(t.length,end-pos);pos+=t.length;if(a<b){if(hardBreak)n else JsonObject(n+("text" to JsonPrimitive(t.substring(a,b))))}else null}}
        val middle=value.substring(prefix,value.length-suffix)
        val style=(slice(0,prefix).lastOrNull { it.jsonObject.text("type")=="text" }?:raw.firstOrNull { it.jsonObject.text("type")=="text" }) as? JsonObject
        val inserted=if(middle.isEmpty())emptyList()else buildList<JsonElement> {
            middle.split('\n').forEachIndexed { i, part ->
                if(i>0)add(buildJsonObject{put("type","hardBreak")})
                if(part.isNotEmpty())add(JsonObject((style?:buildJsonObject{put("type","text")})+("text" to JsonPrimitive(part))))
            }
        }
        return JsonObject(node+("content" to JsonArray(slice(0,prefix)+inserted+slice(old.length-suffix,old.length))))
    }
    fun paragraph(value:String="")=buildJsonObject{put("type","paragraph");put("content",JsonArray(if(value.isEmpty())emptyList()else listOf(buildJsonObject{put("type","text");put("text",value)})))}
    fun append(doc:JsonObject,node:JsonObject)=JsonObject(doc+("content" to JsonArray((doc["content"] as? JsonArray).orEmpty()+node)))
    fun remove(doc:JsonObject,path:List<Int>):JsonObject=update(doc,path.dropLast(1)){parent->JsonObject(parent+("content" to JsonArray(parent["content"]!!.jsonArray.filterIndexed{i,_->i!=path.last()})))}
    fun moveUp(doc:JsonObject,path:List<Int>):JsonObject=if(path.last()==0)doc else update(doc,path.dropLast(1)){parent->val list=parent["content"]!!.jsonArray.toMutableList();val i=path.last();list.add(i-1,list.removeAt(i));JsonObject(parent+("content" to JsonArray(list)))}
}

data class CanonicalBody(val doc:JsonObject,val canEdit:Boolean)
class BlockEditorApi(private val api:ApiClient) {
    suspend fun load(kind:String,id:String):CanonicalBody {
        val safe=URLEncoder.encode(id,"UTF-8")
        val body=api.get(if(kind=="doc")"/api/docs/$safe?format=canonical" else "/api/tasks/$safe/body",JsonObject.serializer())
        val doc=if(kind=="doc")body.objectAt("doc").objectAt("content")else body.objectAt("doc")
        if(!BlockTree.valid(doc)||(kind=="doc"&&body.text("format")!="canonical"))throw ApiError.Decoding(IllegalStateException("Canonical document missing"))
        return CanonicalBody(doc,body.flag("canEdit"))
    }
    suspend fun write(kind:String,id:String,action:String,text:String,prompt:String,language:String):JsonObject {
        val body=buildJsonObject { put("action",action);put("text",text.take(12000));put("prompt",prompt.take(1000));if(action=="tone")put("tone",prompt.take(40));put("language",language);put(if(kind=="doc")"docId" else "taskId",id) }
        var final:JsonObject?=null
        var failure:String?=null
        api.sendEventLines(Request.Builder().url(api.url("/api/gideon/write")).header("Accept","text/event-stream").post(body.toString().toJsonBody()).build(),180000){line->
            if(line.startsWith("data:")){val event=runCatching{Json.parseToJsonElement(line.removePrefix("data:").trim()).jsonObject}.getOrNull()
                when(event?.text("type")){"final"->final=event;"error"->failure=event.text("content").ifBlank{"Writing failed"}}
            }
        }
        if(failure!=null)throw ApiError.Http(502,failure,null,null)
        val result = final?:throw ApiError.Decoding(IllegalStateException("Missing writing result"))
        if(result.text("content").isBlank())throw ApiError.Decoding(IllegalStateException("Empty writing result"))
        return result
    }
    suspend fun save(kind:String,id:String,base:JsonObject,doc:JsonObject,keepBoth:Boolean=false):JsonObject {
        val body=buildJsonObject{put("kind",kind);put("id",id);put("base",base);put("doc",doc);put("keepBoth",keepBoth)}
        val result=api.send(Request.Builder().url(api.url("/api/collab/edit")).post(body.toString().toJsonBody()).build(),JsonObject.serializer()).objectAt("doc")
        if(!BlockTree.valid(result))throw ApiError.Decoding(IllegalStateException("Saved document missing"))
        return result
    }
}
