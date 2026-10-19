package id.znetworks.nexus.feature.docs

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.BuilderPick
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
internal fun BlockEditorButton(kind:String,id:String,onSaved:()->Unit={}) {
    var open by remember(id){mutableStateOf(false)}
    TextButton(onClick={open=true}){Text(stringResource(R.string.be_edit))}
    if(open)BlockEditorDialog(kind,id,onSaved){open=false}
}

@Composable
private fun BlockEditorDialog(kind:String,id:String,onSaved:()->Unit,close:()->Unit) {
    val ctx=LocalContext.current
    val container=(ctx.applicationContext as NexusApplication).container
    val api=remember{BlockEditorApi(container.api)}
    val prefs=remember{ctx.getSharedPreferences("nexus.block-drafts",android.content.Context.MODE_PRIVATE)}
    val draftKey=container.sessionStore.current?.userId.orEmpty()+":"+kind+":"+id
    val scope=rememberCoroutineScope()
    var base by remember{mutableStateOf<JsonObject?>(null)}
    var doc by remember{mutableStateOf<JsonObject?>(null)}
    var canEdit by remember{mutableStateOf(false)}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var conflict by remember{mutableStateOf<JsonObject?>(null)}
    var discard by remember{mutableStateOf(false)}
    var retry by remember{mutableIntStateOf(0)}
    var remove by remember{mutableStateOf<List<Int>?>(null)}
    fun mirror(b:JsonObject,d:JsonObject){if(b==d)prefs.edit().remove(draftKey).apply()else prefs.edit().putString(draftKey,buildJsonObject{put("base",b);put("doc",d)}.toString()).apply()}
    fun edit(next:JsonObject){doc=next;base?.let{mirror(it,next)}}
    LaunchedEffect(kind,id,retry){
        try{val loaded=api.load(kind,id);canEdit=loaded.canEdit
            if(base==null){val pending=prefs.getString(draftKey,null)?.let{runCatching{Json.parseToJsonElement(it).jsonObject}.getOrNull()};val pbase=pending?.objectAt("base");val pdoc=pending?.objectAt("doc");if(pbase!=null&&pdoc!=null&&BlockTree.valid(pbase)&&BlockTree.valid(pdoc)){base=pbase;doc=pdoc}else{base=loaded.doc;doc=loaded.doc}}
            error=null
        }catch(e:ApiError){error=e.describe(ctx.resources)}
    }
    fun save(keepBoth:Boolean=false){val b=base?:return;val d=doc?:return;if(busy||!canEdit)return;busy=true;scope.launch{
        try{val saved=api.save(kind,id,b,d,keepBoth);base=saved;doc=saved;mirror(saved,saved);conflict=null;error=null;onSaved()}
        catch(e:ApiError){if(e is ApiError.Http&&e.status==409&&e.body?.objectAt("doc")?.let{BlockTree.valid(it)}==true)conflict=e.body.objectAt("doc")else error=e.describe(ctx.resources)}
        finally{busy=false}
    }}
    fun dismiss(){if(!busy){if(doc!=base)discard=true else close()}}
    Dialog(onDismissRequest=::dismiss,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Surface(Modifier.fillMaxSize()){Column(Modifier.safeDrawingPadding().imePadding()){
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){TextButton(onClick=::dismiss,enabled=!busy){Text(stringResource(R.string.au_close))};TextButton(onClick={save()},enabled=canEdit&&!busy&&doc!=null&&doc!=base){Text(stringResource(R.string.save))}}
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                Text(stringResource(R.string.be_edit),style=MaterialTheme.typography.titleLarge)
                if(base==null&&error==null||busy)LinearProgressIndicator(Modifier.fillMaxWidth())
                error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={retry++}){Text(stringResource(R.string.try_again))}}
                if(doc!=null&&!canEdit)Text(stringResource(R.string.be_readonly))
                val d=doc
                if(d!=null){BlockTree.lines(d).forEach{line->
                    val type=line.node.text("type")
                    Card{Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                        val label=when(type){"paragraph"->R.string.be_text;"heading"->R.string.be_heading;"codeBlock"->R.string.be_code;"detailsSummary"->R.string.be_toggle;else->R.string.be_kept}
                        Text(stringResource(label),style=MaterialTheme.typography.labelMedium)
                        if(line.editable)OutlinedTextField(BlockTree.text(line.node),{text->edit(BlockTree.update(d,line.path){BlockTree.replaceText(it,text)})},enabled=canEdit&&!busy,modifier=Modifier.fillMaxWidth())
                        else Text(BlockTree.text(line.node).ifBlank{stringResource(R.string.be_kept_help)})
                        val taskPath=line.path.indices.map{line.path.take(it+1)}.firstOrNull{BlockTree.at(d,it).text("type")=="taskItem"}
                        if(taskPath!=null){val item=BlockTree.at(d,taskPath);Row{Checkbox(item.objectAt("attrs").flag("checked"),{on->edit(BlockTree.update(d,taskPath){JsonObject(it+("attrs" to JsonObject(it.objectAt("attrs")+("checked" to JsonPrimitive(on)))) )})},enabled=canEdit&&!busy);Text(stringResource(R.string.be_done),Modifier.padding(top=12.dp))}}
                        if(canEdit){
                            if(line.editable)BlockWriting(api,kind,id,BlockTree.text(line.node),!busy,{value->edit(BlockTree.update(d,line.path){BlockTree.replaceText(it,value)})},{value->edit(BlockTree.append(d,BlockTree.paragraph(value)))})
                            if(line.editable)BuilderPick(stringResource(R.string.be_turn),type,listOf("paragraph" to stringResource(R.string.be_text),"heading" to stringResource(R.string.be_heading),"codeBlock" to stringResource(R.string.be_code)),!busy){next->edit(BlockTree.update(d,line.path){JsonObject(it+("type" to JsonPrimitive(next))+("attrs" to if(next=="heading")JsonObject(it.objectAt("attrs")+("level" to JsonPrimitive(2)))else it.objectAt("attrs")))})}
                            Row{if(line.path.last()>0)TextButton(onClick={edit(BlockTree.moveUp(d,line.path))},enabled=!busy){Text(stringResource(R.string.ab_up))};TextButton(onClick={remove=line.path},enabled=!busy){Text(stringResource(R.string.ab_remove))}}
                        }
                    }}
                }
                if(canEdit)BuilderPick(stringResource(R.string.be_add),"",listOf("paragraph" to stringResource(R.string.be_text),"heading" to stringResource(R.string.be_heading),"bulletList" to stringResource(R.string.be_bullet),"orderedList" to stringResource(R.string.be_numbered),"taskList" to stringResource(R.string.be_todo),"blockquote" to stringResource(R.string.be_quote),"details" to stringResource(R.string.be_toggle),"codeBlock" to stringResource(R.string.be_code),"horizontalRule" to stringResource(R.string.be_divider)),!busy){type->
                    val node=when(type){"bulletList","orderedList","taskList"->buildJsonObject{put("type",type);put("content",JsonArray(listOf(buildJsonObject{put("type",if(type=="taskList")"taskItem"else"listItem");if(type=="taskList")put("attrs",buildJsonObject{put("checked",false)});put("content",JsonArray(listOf(BlockTree.paragraph())))})))};"blockquote"->buildJsonObject{put("type",type);put("content",JsonArray(listOf(BlockTree.paragraph())))};"details"->buildJsonObject{put("type",type);put("content",JsonArray(listOf(buildJsonObject{put("type","detailsSummary")},buildJsonObject{put("type","detailsContent");put("content",JsonArray(listOf(BlockTree.paragraph())))})))};else->JsonObject(BlockTree.paragraph()+("type" to JsonPrimitive(type))+("attrs" to if(type=="heading")buildJsonObject{put("level",2)}else buildJsonObject{}))}
                    edit(BlockTree.append(d,node))
                }
                if(doc!=base)Text(stringResource(R.string.be_local))
                }
            }
        }}
    }
    conflict?.let{remote->AlertDialog(onDismissRequest={conflict=null},title={Text(stringResource(R.string.be_conflict))},text={Column{Text(stringResource(R.string.be_conflict_help));Text(BlockTree.text(remote).take(1500))}},confirmButton={TextButton(onClick={save(true)},enabled=!busy){Text(stringResource(R.string.be_keep_both))}},dismissButton={TextButton(onClick={base=remote;doc=remote;mirror(remote,remote);conflict=null},enabled=!busy){Text(stringResource(R.string.be_latest))}})}
    if(discard)AlertDialog(onDismissRequest={discard=false},title={Text(stringResource(R.string.be_leave))},confirmButton={TextButton(onClick=close){Text(stringResource(R.string.be_keep_draft))}},dismissButton={TextButton(onClick={prefs.edit().remove(draftKey).apply();close()}){Text(stringResource(R.string.ab_discard_action))}})
    remove?.let{path->AlertDialog(onDismissRequest={remove=null},title={Text(stringResource(R.string.be_delete))},confirmButton={TextButton(onClick={doc?.let{edit(BlockTree.remove(it,path))};remove=null}){Text(stringResource(R.string.ab_remove))}},dismissButton={TextButton(onClick={remove=null}){Text(stringResource(R.string.cancel))}})}
}
