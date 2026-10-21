package id.znetworks.nexus.feature.docs

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError

import id.znetworks.nexus.feature.social.text
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.launch

@Composable
internal fun BlockWriting(api:BlockEditorApi,kind:String,id:String,text:String,enabled:Boolean,replace:(String)->Unit,insert:(String)->Unit){
    val ctx=LocalContext.current
    val scope=rememberCoroutineScope()
    var open by remember{mutableStateOf(false)}
    var action by remember{mutableStateOf("improve")}
    var prompt by remember{mutableStateOf("")}
    var language by remember{mutableStateOf(if(ctx.resources.configuration.locales[0].language in listOf("id","in"))"id" else "en")}
    var result by remember{mutableStateOf<String?>(null)}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf<String?>(null)}
    TextButton(onClick={open=true},enabled=enabled){Text(stringResource(R.string.be_ask))}
    if(open)AlertDialog(onDismissRequest={if(!busy)open=false},title={Text(stringResource(R.string.be_ask))},text={Column(Modifier.verticalScroll(rememberScrollState())){
        BlockPick(stringResource(R.string.be_action),action,listOf("improve" to R.string.be_improve,"fix" to R.string.be_fix,"shorter" to R.string.be_shorter,"longer" to R.string.be_longer,"summarize" to R.string.be_summarize,"translate" to R.string.be_translate,"continue" to R.string.be_continue,"explain" to R.string.be_explain,"action_items" to R.string.be_actions,"tone" to R.string.be_tone,"custom" to R.string.be_custom).map{it.first to stringResource(it.second)},!busy){action=it}
        if(action=="translate")BlockPick(stringResource(R.string.be_language),language,listOf("en" to stringResource(R.string.be_language_en),"id" to stringResource(R.string.be_language_id)),!busy){language=it}
        if(action=="custom"||action=="tone")NxTextField(prompt,{if(it.length<=1000)prompt=it},label={Text(stringResource(R.string.be_instructions))},enabled=!busy)
        TextButton(onClick={busy=true;error=null;result=null;scope.launch{try{result=api.write(kind,id,action,text,prompt,language).text("content")}catch(e:ApiError){error=e.describe(ctx.resources)}finally{busy=false}}},enabled=!busy&&(text.isNotBlank()||action=="continue"||action=="custom"&&prompt.isNotBlank())){Text(stringResource(R.string.be_generate))}
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
        result?.let{Text(it)}
    }},confirmButton={result?.let{value->TextButton(onClick={replace(value);open=false},enabled=!busy){Text(stringResource(R.string.be_replace))}}},dismissButton={Row{result?.let{value->TextButton(onClick={insert(value);open=false},enabled=!busy){Text(stringResource(R.string.be_insert))}};TextButton(onClick={open=false},enabled=!busy){Text(stringResource(R.string.cancel))}}})
}
