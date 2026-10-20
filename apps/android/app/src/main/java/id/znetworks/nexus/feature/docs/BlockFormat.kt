package id.znetworks.nexus.feature.docs

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import id.znetworks.nexus.R

import id.znetworks.nexus.feature.social.*
import kotlinx.serialization.json.*

object BlockMarks {
    fun safeLink(href:String):Boolean {
        if(href.any { it.isWhitespace() || it.code < 32 })return false
        if(href.startsWith("/")&&!href.startsWith("//"))return true
        val uri=runCatching { java.net.URI(href) }.getOrNull()?:return false
        return when(uri.scheme?.lowercase()) { "https","http" -> !uri.host.isNullOrBlank(); "mailto" -> !uri.schemeSpecificPart.isNullOrBlank(); else -> false }
    }
    fun remove(node:JsonObject,type:String):JsonObject = JsonObject(node+("content" to JsonArray((node["content"]as?JsonArray).orEmpty().map{raw->val n=raw as?JsonObject?:return@map raw;val marks=(n["marks"]as?JsonArray)?:return@map n;val next=marks.filter{(it as?JsonObject)?.text("type")!=type};if(next.isEmpty())JsonObject(n-"marks")else JsonObject(n+("marks" to JsonArray(next)))})))
    fun apply(node:JsonObject,type:String,attrs:JsonObject?=null):JsonObject {
        val content=(node["content"] as? JsonArray).orEmpty()
        val allMarked=content.filterIsInstance<JsonObject>().filter{it.text("type")=="text"}.let{it.isNotEmpty()&&it.all{n->(n["marks"]as?JsonArray).orEmpty().any{m->(m as?JsonObject)?.text("type")==type}}}
        return JsonObject(node+("content" to JsonArray(content.map{raw->val n=raw as?JsonObject?:return@map raw;if(n.text("type")!="text")return@map n
            val marks=(n["marks"]as?JsonArray).orEmpty().filter{(it as?JsonObject)?.text("type")!=type}
            val next=if(allMarked&&attrs==null)marks else marks+buildJsonObject{put("type",type);attrs?.let{put("attrs",it)}}
            if(next.isEmpty())JsonObject(n-"marks")else JsonObject(n+("marks" to JsonArray(next)))
        })))
    }
}
@Composable
internal fun BlockFormat(node:JsonObject,enabled:Boolean,change:(JsonObject)->Unit){
    var link by remember{mutableStateOf(false)}
    var href by remember{mutableStateOf("")}
    BlockPick(stringResource(R.string.be_format),"",listOf("bold" to stringResource(R.string.be_bold),"italic" to stringResource(R.string.be_italic),"underline" to stringResource(R.string.be_underline),"strike" to stringResource(R.string.be_strike),"code" to stringResource(R.string.be_code),"link" to stringResource(R.string.be_link)),enabled){type->if(type=="link"){href="";link=true}else change(BlockMarks.apply(node,type))}
    if(node.text("type")=="heading")BlockPick(stringResource(R.string.be_level),node.objectAt("attrs").text("level").ifBlank{"2"},listOf("1" to "1","2" to "2","3" to "3"),enabled){value->change(JsonObject(node+("attrs" to JsonObject(node.objectAt("attrs")+("level" to JsonPrimitive(value.toInt()))))))}
    if(link)AlertDialog(onDismissRequest={link=false},title={Text(stringResource(R.string.be_link))},text={NxTextField(href,{href=it},label={Text(stringResource(R.string.be_url))})},confirmButton={TextButton(onClick={change(BlockMarks.apply(node,"link",buildJsonObject{put("href",href.trim())}));link=false},enabled=BlockMarks.safeLink(href.trim())){Text(stringResource(R.string.save))}},dismissButton={Row{TextButton(onClick={change(BlockMarks.remove(node,"link"));link=false}){Text(stringResource(R.string.be_remove))};TextButton(onClick={link=false}){Text(stringResource(R.string.cancel))}}})
}
