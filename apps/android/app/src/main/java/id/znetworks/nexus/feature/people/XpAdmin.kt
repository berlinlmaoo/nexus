package id.znetworks.nexus.feature.people

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiClient
import id.znetworks.nexus.core.net.ApiClient.Companion.toJsonBody
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.projects.BuilderPick
import id.znetworks.nexus.feature.social.*
import id.znetworks.nexus.feature.chat.chatTime
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import okhttp3.Request

class XpAdminApi(private val api:ApiClient){
    suspend fun people()=api.get("/api/gamification/leaderboard",Leaderboard.serializer()).rows
    suspend fun penalties()=api.get("/api/gamification/my-penalties",JsonObject.serializer()).rows("penalties")
    suspend fun adjust(user:String,amount:Int,note:String)=api.send(Request.Builder().url(api.url("/api/gamification/xp-adjust")).post(buildJsonObject{put("userId",user);put("amount",amount);put("note",note.trim().replace(Regex("\\s+")," ").take(120))}.toString().toJsonBody()).build(),JsonObject.serializer())
}
@Composable
internal fun XpAdjustButton(changed:()->Unit){
    val ctx=LocalContext.current
    val container=(ctx.applicationContext as NexusApplication).container
    if(!container.viewer.isBoD)return
    val api=remember{XpAdminApi(container.api)}
    val scope=rememberCoroutineScope()
    var open by remember{mutableStateOf(false)}
    var people by remember{mutableStateOf<List<BoardRow>?>(null)}
    var user by remember{mutableStateOf("")}
    var magnitude by remember{mutableStateOf("")}
    var negative by remember{mutableStateOf(true)}
    var note by remember{mutableStateOf("")}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    var confirm by remember{mutableStateOf(false)}
    var tick by remember{mutableIntStateOf(0)}
    LaunchedEffect(open,tick){if(open)try{people=api.people();error=null}catch(e:ApiError){error=e.describe(ctx.resources)}}
    TextButton(onClick={user="";magnitude="";note="";negative=true;open=true}){Text(stringResource(R.string.xad_adjust))}
    val amount=(magnitude.toIntOrNull()?:0)*(if(negative)-1 else 1)
    if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text(stringResource(R.string.xad_adjust))},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(stringResource(R.string.xad_help))
        if(people==null&&error==null||busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        BuilderPick(stringResource(R.string.xad_person),user,people.orEmpty().map{it.userId to "${it.name.orEmpty()} · ${it.totalXp} XP"},!busy){user=it}
        Row{FilterChip(negative,{negative=true},label={Text(stringResource(R.string.xpa_deducted))},enabled=!busy);FilterChip(!negative,{negative=false},label={Text(stringResource(R.string.xpa_added))},enabled=!busy)}
        NxTextField(magnitude,{if(it.length<=4&&it.all{c->c.isDigit()})magnitude=it},label={Text(stringResource(R.string.xad_amount))},enabled=!busy)
        NxTextField(note,{if(it.length<=120)note=it},label={Text(stringResource(R.string.xad_note))},enabled=!busy)
        error?.let{Text(it,color=MaterialTheme.colorScheme.error);TextButton(onClick={tick++},enabled=!busy){Text(stringResource(R.string.try_again))}}
    }},confirmButton={TextButton(onClick={confirm=true},enabled=!busy&&user.isNotBlank()&&kotlin.math.abs(amount) in 1..1000){Text(stringResource(R.string.xad_adjust))}},dismissButton={TextButton(onClick={open=false},enabled=!busy){Text(stringResource(R.string.cancel))}})
    if(confirm)AlertDialog(onDismissRequest={if(!busy)confirm=false},title={Text(stringResource(R.string.xad_confirm,amount,people?.find{it.userId==user}?.name.orEmpty()))},text={Text(note)},confirmButton={TextButton(onClick={busy=true;scope.launch{try{api.adjust(user,amount,note);confirm=false;open=false;changed()}catch(e:ApiError){error=e.describe(ctx.resources);confirm=false}finally{busy=false}}},enabled=!busy){Text(stringResource(R.string.confirm))}},dismissButton={TextButton(onClick={confirm=false},enabled=!busy){Text(stringResource(R.string.cancel))}})
}

object XpPenaltyRules{
    fun fresh(rows:List<JsonObject>,seen:Set<String>)=rows.filter{it.text("id").isNotBlank()&&it.text("id") !in seen&&(it.number("amount")?:0.0)<0}.distinctBy{it.text("id")}
    fun dismissed(seen:List<String>,rows:List<JsonObject>)=(seen+rows.map{it.text("id")}).distinct().takeLast(150)
}
@Composable
internal fun XpPenaltyHost(allowed:Boolean,onState:(loading:Boolean,pending:Boolean)->Unit = {_,_->}){
    val ctx=LocalContext.current
    val container=(ctx.applicationContext as NexusApplication).container
    val user=container.sessionStore.current?.userId?:return
    val api=remember{XpAdminApi(container.api)}
    val seenKey=container.api.url("/").toString()+":"+user
    val prefs=remember{ctx.getSharedPreferences("nexus.xp-penalties",android.content.Context.MODE_PRIVATE)}
    var rows by remember(seenKey){mutableStateOf<List<JsonObject>>(emptyList())}
    var seen by remember(seenKey){mutableStateOf(prefs.getString(seenKey,"").orEmpty().split("|").filter{it.isNotBlank()})}
    var loading by remember(seenKey){mutableStateOf(true)}
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(seenKey,lifecycle){lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED){delay(1800);while(true){try{rows=api.penalties()}catch(_:ApiError){}finally{loading=false};delay(30000)}}}
    val fresh=XpPenaltyRules.fresh(rows,seen.toSet())
    SideEffect { onState(loading,fresh.isNotEmpty()) }
    fun dismiss(){seen=XpPenaltyRules.dismissed(seen,fresh);prefs.edit().putString(seenKey,seen.joinToString("|")).apply()}
    if(allowed&&fresh.isNotEmpty())AlertDialog(onDismissRequest=::dismiss,title={Text(stringResource(R.string.xad_penalties))},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
        fresh.forEach{p->val label=when(p.text("kind")){"late"->ctx.getString(R.string.xad_late,p.number("lateMinutes")?.toInt()?.toString()?:kotlin.math.abs(p.number("amount")?.toInt()?:0).let{if(it>=120)"120+"else it.toString()});"nocheckout"->ctx.getString(R.string.xad_nocheckout);"alpha"->ctx.getString(R.string.xad_absent);"admin"->ctx.getString(R.string.xad_admin,p.text("reason").removePrefix("admin:adjust:").takeIf{p.text("reason").startsWith("admin:adjust:")}.orEmpty());else->ctx.getString(R.string.xad_lost)}
            Text(label,style=MaterialTheme.typography.titleSmall);Text("${p.number("amount")?.toInt()?:0} XP · ${chatTime(p.text("createdAt"))}")}
        Text(stringResource(R.string.xad_total,fresh.sumOf{it.number("amount")?.toInt()?:0}))
    }},confirmButton={TextButton(onClick=::dismiss){Text(stringResource(R.string.xad_got_it))}})
}
