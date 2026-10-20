package id.znetworks.nexus.feature.projects

import id.znetworks.nexus.ui.components.NxOutlinedButton

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import okhttp3.Request
import java.net.URLEncoder

class WorkflowBundleApi(private val api:ApiClient){
    suspend fun list()=api.get("/api/workflow-bundles",JsonObject.serializer()).rows("bundles")
    suspend fun apply(project:String,bundle:String)=api.send(Request.Builder().url(api.url("/api/projects/${URLEncoder.encode(project,"UTF-8")}/apply-bundle")).post(buildJsonObject{put("bundleId",bundle)}.toString().toJsonBody()).build(),JsonObject.serializer())
}
@Composable
internal fun WorkflowBundleButton(project:String,onApplied:()->Unit){
    val ctx=LocalContext.current
    val api=remember{WorkflowBundleApi((ctx.applicationContext as NexusApplication).container.api)}
    val scope=rememberCoroutineScope()
    var open by remember{mutableStateOf(false)}
    var list by remember{mutableStateOf<List<JsonObject>?>(null)}
    var chosen by remember{mutableStateOf<JsonObject?>(null)}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var tick by remember{mutableIntStateOf(0)}
    LaunchedEffect(open,tick){if(open)try{list=api.list();error=null}catch(e:ApiError){error=e.describe(ctx.resources)}}
    NxOutlinedButton(onClick={open=true},modifier=Modifier.fillMaxWidth()){Text(stringResource(R.string.wb_title))}
    if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text(stringResource(R.string.wb_title))},text={Column(Modifier.heightIn(max=500.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(stringResource(R.string.wb_help))
        if(list==null&&error==null||busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={tick++},enabled=!busy){Text(stringResource(R.string.try_again))}}
        if(list?.isEmpty()==true)Text(stringResource(R.string.wb_empty))
        list.orEmpty().forEach{row->OutlinedCard(onClick={chosen=row},enabled=!busy,modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text(row.text("name"));Text(row.text("description"));Text(row.objectAt("createdBy").text("name"))}}}
    }},confirmButton={TextButton(onClick={open=false},enabled=!busy){Text(stringResource(R.string.au_close))}})
    chosen?.let{row->AlertDialog(onDismissRequest={if(!busy)chosen=null},title={Text(stringResource(R.string.wb_confirm,row.text("name")))},text={Text(stringResource(R.string.wb_help))},confirmButton={TextButton(onClick={busy=true;scope.launch{try{api.apply(project,row.text("id"));chosen=null;open=false;onApplied()}catch(e:ApiError){error=(e as? ApiError.Http)?.serverMessage?:e.describe(ctx.resources);chosen=null}finally{busy=false}}},enabled=!busy){Text(stringResource(R.string.wb_apply))}},dismissButton={TextButton(onClick={chosen=null},enabled=!busy){Text(stringResource(R.string.cancel))}})}
}
