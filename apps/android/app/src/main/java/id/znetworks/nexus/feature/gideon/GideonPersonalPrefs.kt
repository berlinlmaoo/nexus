package id.znetworks.nexus.feature.gideon

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*
import okhttp3.Request

@Serializable
data class GideonPersonalPrefs(val assistantName:String?=null,val instructions:String?=null,val updatedAt:String?=null,val reviewNotice:Boolean=false){val name:String get()=assistantName?.trim()?.takeIf{it.isNotBlank()}?:"GIDEON"}
class GideonPersonalApi(private val api:ApiClient){
    suspend fun load()=api.get("/api/gideon/prefs",GideonPersonalPrefs.serializer())
    suspend fun save(name:String,instructions:String)=put(buildJsonObject{put("assistantName",name.trim().takeIf{it.isNotEmpty()}?.let{JsonPrimitive(it)}?:JsonNull);put("instructions",instructions.trim().takeIf{it.isNotEmpty()}?.let{JsonPrimitive(it)}?:JsonNull)})
    suspend fun acknowledge()=put(buildJsonObject{put("reviewNoticeSeen",true)})
    private suspend fun put(body:JsonObject)=api.send(Request.Builder().url(api.url("/api/gideon/prefs")).put(body.toString().toJsonBody()).build(),GideonPersonalPrefs.serializer())
}
@Composable
internal fun GideonPersonalDialog(api:GideonPersonalApi,original:GideonPersonalPrefs?,updated:(GideonPersonalPrefs)->Unit,close:()->Unit){
    val ctx=LocalContext.current
    val scope=rememberCoroutineScope()
    var loaded by remember{mutableStateOf(original)}
    var name by remember{mutableStateOf(original?.assistantName.orEmpty())}
    var instructions by remember{mutableStateOf(original?.instructions.orEmpty())}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var retry by remember{mutableIntStateOf(0)}
    var discard by remember{mutableStateOf(false)}
    LaunchedEffect(retry){if(loaded==null)try{val p=api.load();loaded=p;name=p.assistantName.orEmpty();instructions=p.instructions.orEmpty();updated(p);error=null}catch(e:ApiError){error=e.describe(ctx.resources)}}
    val dirty=name!=loaded?.assistantName.orEmpty()||instructions!=loaded?.instructions.orEmpty()
    fun dismiss(){if(!busy){if(dirty)discard=true else close()}}
    AlertDialog(onDismissRequest=::dismiss,title={Text(stringResource(R.string.gp_personalize))},text={Column(Modifier.verticalScroll(rememberScrollState())){
        Text(stringResource(R.string.gp_help))
        if(loaded==null&&error==null||busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        OutlinedTextField(name,{if(it.length<=40)name=it},label={Text(stringResource(R.string.gp_name))},enabled=loaded!=null&&!busy,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(instructions,{if(it.length<=2000)instructions=it},label={Text(stringResource(R.string.gp_instructions))},enabled=loaded!=null&&!busy,modifier=Modifier.fillMaxWidth())
        Text(stringResource(R.string.gp_private))
        error?.let{Text(it,color=MaterialTheme.colorScheme.error);if(loaded==null)TextButton(onClick={retry++}){Text(stringResource(R.string.try_again))}}
    }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{updated(api.save(name,instructions));close()}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=loaded!=null&&!busy&&dirty){Text(stringResource(R.string.save))}},dismissButton={TextButton(onClick=::dismiss,enabled=!busy){Text(stringResource(R.string.cancel))}})
    if(discard)AlertDialog(onDismissRequest={discard=false},title={Text(stringResource(R.string.ab_discard))},confirmButton={TextButton(onClick=close){Text(stringResource(R.string.ab_discard_action))}},dismissButton={TextButton(onClick={discard=false}){Text(stringResource(R.string.cancel))}})
}
