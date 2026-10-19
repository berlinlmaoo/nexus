package id.znetworks.nexus.feature.vault

import id.znetworks.nexus.ui.components.NxTextField

import android.content.Intent
import androidx.core.content.FileProvider
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*
import okhttp3.Request
import java.io.File

class VaultZipApi(private val api:ApiClient){
    private fun body(ids:List<String>)=buildJsonObject{put("ids",JsonArray(ids.distinct().take(500).map{JsonPrimitive(it)}))}
    suspend fun check(ids:List<String>)=api.send(Request.Builder().url(api.url("/api/vault/zip?check=1")).post(body(ids).toString().toJsonBody()).build(),JsonObject.serializer())
    suspend fun download(ids:List<String>,target:File,progress:(Long,Long)->Unit)=api.download("/api/vault/zip",target,null,postBody=body(ids).toString().toJsonBody(),onProgress=progress)
}
@Composable
internal fun VaultZipButton(items:List<VaultItem>){
    val ctx=LocalContext.current
    val api=remember{VaultZipApi((ctx.applicationContext as NexusApplication).container.api)}
    val scope=rememberCoroutineScope()
    var open by remember{mutableStateOf(false)}
    var selected by remember{mutableStateOf<Set<String>>(emptySet())}
    var query by remember{mutableStateOf("")}
    var busy by remember{mutableStateOf(false)}
    var done by remember{mutableLongStateOf(0)}
    var total by remember{mutableLongStateOf(0)}
    var error by remember{mutableStateOf<String?>(null)}
    TextButton(onClick={selected=emptySet();query="";error=null;open=true},enabled=items.isNotEmpty()){Text(stringResource(R.string.vz_title))}
    if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text(stringResource(R.string.vz_title))},text={Column(Modifier.heightIn(max=500.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(stringResource(R.string.vz_help))
        NxTextField(query,{query=it},label={Text(stringResource(R.string.vault_search))},enabled=!busy)
        items.filter{it.name.contains(query,true)}.forEach{i->Row{Checkbox(i.id in selected,{on->selected=if(on)selected+i.id else selected-i.id},enabled=!busy&&(i.id in selected||selected.size<500));Text(i.name,Modifier.padding(top=12.dp))}}
        if(busy){LinearProgressIndicator(Modifier.fillMaxWidth());Text(stringResource(R.string.vz_progress,done/1024,total/1024))}
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    }},confirmButton={TextButton(onClick={val ids=selected.toList();busy=true;done=0;total=0;error=null;scope.launch{
        var part:File?=null
        try{val check=api.check(ids);total=check.number("bytes")?.toLong()?:0
            val output=withContext(Dispatchers.IO){val dir=File(ctx.cacheDir,"shared/vault-zip").apply{mkdirs()};val path=File(dir,"Vault-${System.currentTimeMillis()}.zip");val temp=File(path.path+".part");part=temp;api.download(ids,temp){bytes,_->done=bytes};if(!temp.renameTo(path))throw java.io.IOException("Archive move failed");path}
            val uri=FileProvider.getUriForFile(ctx,"${ctx.packageName}.files",output)
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/zip").putExtra(Intent.EXTRA_STREAM,uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),null));open=false
        }catch(e:ApiError){error=e.describe(ctx.resources)}catch(_:java.io.IOException){error=ctx.getString(R.string.vz_failed)}catch(_:android.content.ActivityNotFoundException){error=ctx.getString(R.string.vz_no_app)}finally{part?.delete();busy=false}
    }},enabled=!busy&&selected.isNotEmpty()){Text(stringResource(R.string.vz_download,selected.size))}},dismissButton={TextButton(onClick={open=false},enabled=!busy){Text(stringResource(R.string.cancel))}})
}
