package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.ui.components.NxTextField

import android.content.ClipData
import android.content.ClipboardManager
import android.os.PersistableBundle
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
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

class McpTokensApi(private val api:ApiClient){
    suspend fun list()=api.get("/api/mcp/tokens",JsonObject.serializer()).rows("tokens")
    suspend fun create(name:String,days:Int)=api.send(Request.Builder().url(api.url("/api/mcp/tokens")).post(buildJsonObject{put("name",name.trim());put("expiresInDays",days)}.toString().toJsonBody()).build(),JsonObject.serializer())
    suspend fun revoke(id:String)=api.send(Request.Builder().url(api.url("/api/mcp/tokens?id="+URLEncoder.encode(id,"UTF-8"))).delete().build(),JsonObject.serializer())
}
@Composable
internal fun McpTokensCard(){
    val ctx=LocalContext.current
    val api=remember{McpTokensApi((ctx.applicationContext as NexusApplication).container.api)}
    val scope=rememberCoroutineScope()
    var tokens by remember{mutableStateOf<List<JsonObject>?>(null)}
    var error by remember{mutableStateOf<String?>(null)}
    var busy by remember{mutableStateOf(false)}
    var tick by remember{mutableIntStateOf(0)}
    var create by remember{mutableStateOf(false)}
    var name by remember{mutableStateOf("")}
    var days by remember{mutableStateOf("90")}
    var secret by remember{mutableStateOf<String?>(null)}
    var revoke by remember{mutableStateOf<JsonObject?>(null)}
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle){val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP)secret=null};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer);secret=null}}
    LaunchedEffect(tick){try{tokens=api.list();error=null}catch(e:ApiError){error=e.describe(ctx.resources)}}
    Card(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text(stringResource(R.string.mt_title),style=MaterialTheme.typography.titleMedium)
        if(tokens==null&&error==null||busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={tick++},enabled=!busy){Text(stringResource(R.string.try_again))}}
        if(tokens?.isEmpty()==true)Text(stringResource(R.string.mt_empty))
        tokens.orEmpty().forEach{t->Column{
            Text(t.text("name"),style=MaterialTheme.typography.titleSmall)
            Text(stringResource(R.string.mt_expires,t.text("expiresAt")))
            Text(stringResource(R.string.mt_last_used,t.text("lastUsedAt").ifBlank{stringResource(R.string.mt_never)}))
            Text((t["scopes"] as? JsonArray).orEmpty().mapNotNull{(it as? JsonPrimitive)?.contentOrNull}.joinToString(" · "))
            TextButton(onClick={error=null;revoke=t},enabled=!busy){Text(stringResource(R.string.mt_revoke))}
        }}
        TextButton(onClick={name="";days="90";create=true},enabled=!busy&&tokens!=null&&tokens!!.size<10){Text(stringResource(R.string.mt_create))}
    }}
    if(create)AlertDialog(onDismissRequest={if(!busy)create=false},title={Text(stringResource(R.string.mt_create))},text={Column{
        NxTextField(name,{if(it.length<=80)name=it},label={Text(stringResource(R.string.ab_name))},enabled=!busy)
        NxTextField(days,{if(it.length<=3)days=it},label={Text(stringResource(R.string.mt_days))},enabled=!busy)
        Text(stringResource(R.string.mt_once))
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    }},confirmButton={TextButton(onClick={busy=true;scope.launch{try{val result=api.create(name,days.toInt());val token=result.text("token");if(token.isBlank())throw ApiError.Decoding(IllegalStateException("Missing token"));secret=token.takeIf{lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};create=false;tick++;error=null}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=!busy&&name.trim().isNotEmpty()&&days.toIntOrNull() in 1..365){Text(stringResource(R.string.mt_create))}},dismissButton={TextButton(onClick={create=false},enabled=!busy){Text(stringResource(R.string.cancel))}})
    secret?.let{token->AlertDialog(onDismissRequest={secret=null},title={Text(stringResource(R.string.mt_once))},text={Column(Modifier.verticalScroll(rememberScrollState())){SelectionContainer{Text(token)};Text(stringResource(R.string.mt_once_help))}},confirmButton={TextButton(onClick={val clip=ClipData.newPlainText(ctx.getString(R.string.mt_clipboard),token);clip.description.extras=PersistableBundle().apply{putBoolean("android.content.extra.IS_SENSITIVE",true)};ctx.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(clip)}){Text(stringResource(R.string.st_copy))}},dismissButton={TextButton(onClick={secret=null}){Text(stringResource(R.string.au_close))}})}
    revoke?.let{t->AlertDialog(onDismissRequest={if(!busy)revoke=null},title={Text(stringResource(R.string.mt_revoke_confirm,t.text("name")))},text={error?.let{Text(it,color=MaterialTheme.colorScheme.error)}},confirmButton={TextButton(onClick={busy=true;scope.launch{try{api.revoke(t.text("id"));revoke=null;tick++;error=null}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=!busy){Text(stringResource(R.string.mt_revoke))}},dismissButton={TextButton(onClick={revoke=null},enabled=!busy){Text(stringResource(R.string.cancel))}})}
}
