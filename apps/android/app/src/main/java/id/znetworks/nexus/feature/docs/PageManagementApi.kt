package id.znetworks.nexus.feature.docs

import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import kotlinx.serialization.json.*
import id.znetworks.nexus.feature.social.*
import okhttp3.Request
import java.net.URLEncoder

class PageManagementApi(private val api:ApiClient){
    private fun enc(s:String)=URLEncoder.encode(s,"UTF-8")
    suspend fun templates(workspace:String)=api.get("/api/docs/templates?workspaceId=${enc(workspace)}",JsonObject.serializer()).rows("templates")
    suspend fun create(project:String,title:String,template:String?,parent:String?,content:JsonObject?=null)=send("/api/docs","POST",buildJsonObject{put("projectId",project);put("title",title.trim());if(content!=null)put("content",content)else template?.let{put("templateId",it)};parent?.let{put("parentId",it)}}).createdId()
    suspend fun update(id:String,base:String?,patch:JsonObject)=send("/api/docs/${enc(id)}","PATCH",JsonObject(patch+(base?.let{mapOf("baseUpdatedAt" to JsonPrimitive(it))}?:emptyMap())))
    suspend fun duplicate(id:String)=send("/api/docs/${enc(id)}/duplicate","POST").createdId()
    suspend fun delete(id:String)=send("/api/docs/${enc(id)}","DELETE")
    private fun JsonObject.createdId() = objectAt("doc").text("id").takeIf { it.isNotBlank() } ?: throw ApiError.Decoding(IllegalStateException("Missing page id"))
    private suspend fun send(path:String,method:String,body:JsonObject=buildJsonObject{})=api.send(Request.Builder().url(api.url(path)).method(method,if(method=="DELETE")null else body.toString().toJsonBody()).build(),JsonObject.serializer())
}
object PageTree {
    fun descendants(id:String,docs:List<Doc>):Set<String>{val found=mutableSetOf(id);while(true){val before=found.size;docs.filter{it.parentId in found}.forEach{found+=it.id};if(found.size==before)return found}}
    fun ordered(docs:List<Doc>):List<Pair<Doc,Int>>{val seen=mutableSetOf<String>();val result=mutableListOf<Pair<Doc,Int>>();fun visit(d:Doc,depth:Int){if(!seen.add(d.id))return;result+=d to depth;docs.filter{it.parentId==d.id}.sortedBy{it.position?:0}.forEach{visit(it,(depth+1).coerceAtMost(8))}};val ids=docs.map{it.id}.toSet();docs.filter{it.parentId !in ids}.sortedBy{it.position?:0}.forEach{visit(it,0)};docs.forEach{visit(it,0)};return result}
}

/** Old gallery seeds use {blocks:[{type,content:String}]}; POST only accepts canonical docs. */
object PageTemplates {
    fun canonical(content: JsonObject): JsonObject {
        if (BlockTree.valid(content)) return content
        val blocks = content["blocks"] as? JsonArray ?: throw ApiError.Decoding(IllegalStateException("Unsupported template"))
        return buildJsonObject {
            put("type", "doc")
            put("content", JsonArray(blocks.map { raw ->
                val block = raw as? JsonObject ?: throw ApiError.Decoding(IllegalStateException("Unsupported template block"))
                val type = block.text("type")
                if (type !in setOf("heading", "paragraph") || block["content"] !is JsonPrimitive) throw ApiError.Decoding(IllegalStateException("Unsupported template block"))
                val node = BlockTree.paragraph(block.text("content"))
                if (type == "heading") JsonObject(node + ("type" to JsonPrimitive("heading")) + ("attrs" to buildJsonObject { put("level", 2) })) else node
            }))
        }
    }
}
