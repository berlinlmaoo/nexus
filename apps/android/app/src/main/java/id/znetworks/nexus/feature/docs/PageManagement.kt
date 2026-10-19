package id.znetworks.nexus.feature.docs

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.*
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

@Composable
internal fun NewPageButton(projectId:String?=null,parentId:String?=null,onCreated:(String)->Unit){
    var open by remember{mutableStateOf(false)}
    TextButton(onClick={open=true}){Text(stringResource(R.string.pm_new))}
    if(open)NewPageDialog(projectId,parentId,onCreated){open=false}
}
@Composable
private fun NewPageDialog(initialProject:String?,parent:String?,created:(String)->Unit,close:()->Unit){
    val ctx=LocalContext.current;val container=(ctx.applicationContext as NexusApplication).container
    val api=remember{PageManagementApi(container.api)};val projectsApi=remember{ProjectsApi(container.api)};val scope=rememberCoroutineScope()
    var projects by remember{mutableStateOf<List<Project>?>(null)};var project by remember{mutableStateOf(initialProject.orEmpty())}
    var templates by remember{mutableStateOf<List<JsonObject>>(emptyList())};var template by remember{mutableStateOf("")};var title by remember{mutableStateOf("")}
    var busy by remember{mutableStateOf(false)};var loading by remember{mutableStateOf(true)};var canEdit by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)};var tick by remember{mutableIntStateOf(0)};var discard by remember{mutableStateOf(false)}
    LaunchedEffect(tick){try{projects=projectsApi.projects().value;error=null}catch(e:ApiError){error=e.describe(ctx.resources)};loading=false}
    LaunchedEffect(project,tick,projects){canEdit=false;templates=emptyList();template="";if(project.isNotBlank())try{val detail=projectsApi.project(project).value;canEdit=ProjectAccess.of(detail).canEdit;val workspace=projects?.find{it.id==project}?.workspaceId;if(workspace!=null)templates=api.templates(workspace);error=null}catch(e:ApiError){error=e.describe(ctx.resources)}}
    fun dismiss(){if(!busy){if(title.isNotBlank()||template.isNotBlank())discard=true else close()}}
    AlertDialog(onDismissRequest=::dismiss,title={Text(stringResource(R.string.pm_new))},text={Column(Modifier.verticalScroll(rememberScrollState())){
        if(loading||busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        BuilderPick(stringResource(R.string.pm_project),project,projects.orEmpty().map{it.id to it.name},!busy&&initialProject==null){project=it}
        OutlinedTextField(title,{if(it.length<=200)title=it},label={Text(stringResource(R.string.pm_title))},enabled=!busy,modifier=Modifier.fillMaxWidth())
        BuilderPick(stringResource(R.string.pm_template),template,listOf("" to stringResource(R.string.pm_blank))+templates.map{it.text("id") to (it.text("title")+" / "+it.text("category"))},!busy){template=it}
        templates.find{it.text("id")==template}?.let{t->val content=t.objectAt("content");Text(if(content.text("type")=="doc")BlockTree.text(content).take(2000)else content.rows("blocks").joinToString("\n"){it.text("content")}.take(2000))}
        if(project.isNotBlank()&&!canEdit)Text(stringResource(R.string.be_readonly))
        error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={tick++}){Text(stringResource(R.string.try_again))}}
    }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{val id=api.create(project,title,template.ifBlank{null},parent);created(id);close()}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=!busy&&canEdit&&title.isNotBlank()){Text(stringResource(R.string.pm_create))}},dismissButton={TextButton(onClick=::dismiss,enabled=!busy){Text(stringResource(R.string.cancel))}})
    if(discard)AlertDialog(onDismissRequest={discard=false},title={Text(stringResource(R.string.ab_discard))},confirmButton={TextButton(onClick=close){Text(stringResource(R.string.ab_discard_action))}},dismissButton={TextButton(onClick={discard=false}){Text(stringResource(R.string.cancel))}})
}
@Composable
internal fun PageManageButton(doc:Doc,changed:()->Unit,open:(String)->Unit,deleted:()->Unit){
    val ctx=LocalContext.current;val container=(ctx.applicationContext as NexusApplication).container;val api=remember{PageManagementApi(container.api)};val scope=rememberCoroutineScope()
    var show by remember(doc.id){mutableStateOf(false)};var title by remember(doc.id,doc.title){mutableStateOf(doc.title)};var icon by remember(doc.id,doc.icon){mutableStateOf(doc.icon.orEmpty())};var parent by remember(doc.id,doc.parentId){mutableStateOf(doc.parentId.orEmpty())}
    var wide by remember(doc.id,doc.fullWidth){mutableStateOf(doc.fullWidth)};var cover by remember(doc.id,doc.coverImage){mutableStateOf(doc.coverImage.orEmpty())}
    var pages by remember{mutableStateOf<List<Doc>>(emptyList())};var busy by remember{mutableStateOf(false)};var error by remember{mutableStateOf<String?>(null)};var confirm by remember{mutableStateOf(false)};var discard by remember{mutableStateOf(false)}
    val dirty=title!=doc.title||icon!=doc.icon.orEmpty()||parent!=doc.parentId.orEmpty()||wide!=doc.fullWidth||cover!=doc.coverImage.orEmpty()
    LaunchedEffect(show){if(show&&doc.projectId!=null)try{pages=DocsApi(container.api).all(doc.projectId);error=null}catch(e:ApiError){error=e.describe(ctx.resources)}}
    fun dismiss(){if(!busy){if(dirty)discard=true else show=false}}
    TextButton(onClick={title=doc.title;icon=doc.icon.orEmpty();parent=doc.parentId.orEmpty();wide=doc.fullWidth;cover=doc.coverImage.orEmpty();error=null;show=true}){Text(stringResource(R.string.pm_manage))}
    if(show)AlertDialog(onDismissRequest=::dismiss,title={Text(stringResource(R.string.pm_manage))},text={Column(Modifier.verticalScroll(rememberScrollState())){
        OutlinedTextField(title,{if(it.length<=500)title=it},label={Text(stringResource(R.string.pm_title))},enabled=!busy)
        OutlinedTextField(icon,{if(it.length<=64)icon=it},label={Text(stringResource(R.string.pm_icon))},enabled=!busy)
        val excluded=PageTree.descendants(doc.id,pages)
        BuilderPick(stringResource(R.string.pm_parent),parent,listOf("" to stringResource(R.string.pm_top))+pages.filter{it.id !in excluded}.map{it.id to it.title},!busy){parent=it}
        OutlinedTextField(cover,{if(it.length<=1000)cover=it},label={Text(stringResource(R.string.pm_cover))},enabled=!busy)
        Row{Text(stringResource(R.string.pm_wide),Modifier.weight(1f));Switch(wide,{wide=it},enabled=!busy)}
        doc.projectId?.let{NewPageButton(it,doc.id){id->show=false;open(id)}}
        TextButton(onClick={busy=true;scope.launch{try{val id=api.duplicate(doc.id);show=false;open(id)}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=!busy){Text(stringResource(R.string.pm_duplicate))}
        TextButton(onClick={confirm=true},enabled=!busy){Text(stringResource(R.string.delete))}
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={show=false;changed()}){Text(stringResource(R.string.be_latest))}}
    }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{api.update(doc.id,doc.updatedAt,buildJsonObject{put("title",title.trim());put("icon",icon.ifBlank{null}?.let{JsonPrimitive(it)}?:JsonNull);put("parentId",parent.ifBlank{null}?.let{JsonPrimitive(it)}?:JsonNull);put("fullWidth",wide);put("coverImage",cover.ifBlank{null}?.let{JsonPrimitive(it)}?:JsonNull)});show=false;changed()}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=!busy&&dirty&&title.isNotBlank()&&(cover.isBlank()||cover.startsWith("https://")||cover.startsWith("/")||cover.startsWith("gradient:"))){Text(stringResource(R.string.save))}},dismissButton={TextButton(onClick=::dismiss,enabled=!busy){Text(stringResource(R.string.cancel))}})
    if(confirm)AlertDialog(onDismissRequest={if(!busy)confirm=false},title={Text(stringResource(R.string.pm_delete,doc.title))},text={Text(stringResource(R.string.pm_delete_help))},confirmButton={TextButton(onClick={busy=true;scope.launch{try{api.delete(doc.id);confirm=false;show=false;deleted()}catch(e:ApiError){error=e.describe(ctx.resources);confirm=false}finally{busy=false}}},enabled=!busy){Text(stringResource(R.string.delete))}},dismissButton={TextButton(onClick={confirm=false},enabled=!busy){Text(stringResource(R.string.cancel))}})
    if(discard)AlertDialog(onDismissRequest={discard=false},title={Text(stringResource(R.string.ab_discard))},confirmButton={TextButton(onClick={discard=false;show=false}){Text(stringResource(R.string.ab_discard_action))}},dismissButton={TextButton(onClick={discard=false}){Text(stringResource(R.string.cancel))}})
}
