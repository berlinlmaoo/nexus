package id.znetworks.nexus.feature.legal

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.FileUpload
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.EmptyState
import id.znetworks.nexus.ui.components.NxButton
import id.znetworks.nexus.ui.components.NxButtonKind
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.launch

// Companies & numbering (owner, 14 Oct 2026; web LegalSettings, iOS LegalSettingsView): each issuing company's legal
// name and address as printed in contracts, its kop, and its numbering series. Only the owner and the BoD members he
// invited (invitePower ANY / STAFF) change these; everyone else reads them.

@Composable
fun LegalSettingsPane(canEdit: Boolean) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    var companies by remember { mutableStateOf<List<LgCompany>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var loading by remember { mutableStateOf(false) }
    LaunchedEffect(tick) {
        loading = true
        try { companies = api.companies(); error = null }
        catch (e: ApiError) { if (companies == null) error = legalMessage(ctx, e) else LegalToasts.failure(ctx, e) }
        loading = false
    }
    PullToRefreshBox(loading && companies != null, { tick++ }, Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (!canEdit) item { Text(stringResource(R.string.lg_settings_read_only), fontSize = 13.sp, color = c.mutedFg) }
            val l = companies
            when {
                l == null && error == null -> item { LgLoadingRow() }
                l == null -> item { EmptyState(Icons.Filled.Business, stringResource(R.string.lg_companies_failed), error!!, stringResource(R.string.try_again), { tick++ }) }
                l.isEmpty() -> item {
                    EmptyState(Icons.Filled.Business, stringResource(R.string.lg_no_companies), stringResource(R.string.lg_no_companies_body), stringResource(R.string.lg_reload), { tick++ })
                }
                else -> items(l, key = { it.id }) { co -> CompanyCard(co, canEdit) { tick++ } }
            }
            item {
                LgHelpCard(stringResource(R.string.lg_number_format), listOf(
                    "{SEQ:3}" to stringResource(R.string.lg_tok_seq),
                    "{ROMAWI}" to stringResource(R.string.lg_tok_romawi),
                    "{BLN} / {MM}" to stringResource(R.string.lg_tok_month),
                    "{YYYY} / {YY}" to stringResource(R.string.lg_tok_year),
                    "{CO}" to stringResource(R.string.lg_tok_co),
                    "{KOTA}" to stringResource(R.string.lg_tok_field),
                ), open = null)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CompanyCard(company: LgCompany, canEdit: Boolean, reload: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var name by remember(company) { mutableStateOf(company.name) }
    var code by remember(company) { mutableStateOf(company.code) }
    var legalName by remember(company) { mutableStateOf(company.legalName) }
    var address by remember(company) { mutableStateOf(company.address) }
    var saving by remember { mutableStateOf(false) }
    var kopBusy by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    val dirty = name != company.name || code != company.code || legalName != company.legalName || address != company.address
    val pickKop = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(api::describe)?.let { f ->
            kopBusy = true
            scope.launch {
                try { api.uploadKop(company.id, f); LegalToasts.success(ctx.getString(R.string.lg_kop_uploaded)); reload() } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                kopBusy = false
            }
        }
    }
    LgCard {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            Text(company.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
            Text(company.code, fontSize = 12.sp, fontFamily = LgMono, color = c.mutedFg)
            if (company.legalName.isEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.Warning, null, tint = c.warningFg, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(4.dp))
                Text(stringResource(R.string.lg_legal_name_missing), fontSize = 12.sp, color = c.warningFg)
            }
        }
        LgFormRow(stringResource(R.string.lg_name)) { LgTextField(name, { name = it }, enabled = canEdit) }
        LgFormRow(stringResource(R.string.lg_code_in_numbers)) { LgTextField(code, { code = it.uppercase() }, enabled = canEdit, mono = true) }
        LgFormRow(stringResource(R.string.lg_legal_name)) { LgTextField(legalName, { legalName = it }, enabled = canEdit, placeholder = "PT …") }
        LgFormRow(stringResource(R.string.lg_address)) { LgTextField(address, { address = it }, enabled = canEdit, singleLine = false, minLines = 2) }
        if (canEdit) NxButton(stringResource(R.string.save), {
            saving = true
            scope.launch {
                try {
                    api.updateCompany(company.id, lgBody("name" to name, "code" to code, "legalName" to legalName, "address" to address))
                    LegalToasts.success(ctx.getString(R.string.lg_saved)); reload()
                } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                saving = false
            }
        }, kind = NxButtonKind.PRIMARY, compact = true, enabled = dirty && !saving)
        // The kop: its file and date, download, and (for those who may) upload / replace.
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.muted.copy(alpha = 0.5f)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Text(stringResource(R.string.lg_kop), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                Spacer(Modifier.width(8.dp))
                Text(if (company.hasKop) stringResource(R.string.lg_kop_uploaded_on, company.kopFileName ?: "kop.docx", lgDate(company.kopUpdatedAt))
                    else stringResource(R.string.lg_kop_missing), fontSize = 13.sp, color = c.mutedFg)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (company.hasKop) NxButton(stringResource(R.string.lg_download), {
                    kopBusy = true
                    scope.launch {
                        try { LegalFiles.share(ctx, api.downloadKop(company.id)) } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                        kopBusy = false
                    }
                }, kind = NxButtonKind.GHOST, icon = Icons.Filled.FileDownload, compact = true, enabled = !kopBusy)
                if (canEdit) NxButton(stringResource(if (company.hasKop) R.string.lg_replace else R.string.lg_upload_kop), { pickKop.launch(LegalApi.DOCX_TYPES) },
                    icon = Icons.Filled.FileUpload, compact = true, enabled = !kopBusy)
                if (kopBusy) LgSmallSpinner()
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.lg_series), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, modifier = Modifier.weight(1f))
            if (canEdit && !adding) NxButton(stringResource(R.string.lg_add_series), { adding = true }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Add, compact = true)
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(c.background).border(1.dp, c.border, RoundedCornerShape(10.dp))) {
            company.series.forEachIndexed { i, s ->
                if (i > 0) HorizontalDivider(color = c.border)
                SeriesRow(s, canEdit, reload)
            }
            if (adding) {
                if (company.series.isNotEmpty()) HorizontalDivider(color = c.border)
                NewSeriesRow(company.id) { added -> adding = false; if (added) reload() }
            }
            if (company.series.isEmpty() && !adding) Text(stringResource(R.string.lg_no_series), fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.padding(12.dp))
        }
    }
}

@Composable
private fun SeriesRow(series: LgSeries, canEdit: Boolean, reload: () -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var label by remember { mutableStateOf(series.label) }
    var format by remember { mutableStateOf(series.format) }
    var reset by remember { mutableStateOf<String?>(series.resetPeriod) }
    var info by remember { mutableStateOf<LgSeriesInfo?>(null) }
    var saving by remember { mutableStateOf(false) }
    fun patch(body: kotlinx.serialization.json.JsonObject, after: () -> Unit = {}) {
        saving = true
        scope.launch {
            try { api.updateSeries(series.id, body); LegalToasts.success(ctx.getString(R.string.lg_saved)); after(); reload() }
            catch (e: ApiError) { LegalToasts.failure(ctx, e) }
            saving = false
        }
    }
    if (!editing) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f).then(if (series.active) Modifier else Modifier.background(c.background.copy(alpha = 0.4f))), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("${series.label}  ·  ${lgDocType(series.docType)}  ·  ${lgResetPeriod(series.resetPeriod)}", fontSize = 13.sp,
                    color = if (series.active) c.foreground else c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(series.format, fontSize = 12.sp, fontFamily = LgMono, color = c.mutedFg)
            }
            if (canEdit) {
                // "In use": off keeps the series and its numbers, it just isn't offered to new templates.
                Switch(series.active, { v -> patch(lgBody("active" to v)) }, enabled = !saving, colors = SwitchDefaults.colors(checkedTrackColor = c.violet))
                IconButton(onClick = { label = series.label; format = series.format; reset = series.resetPeriod; editing = true }) {
                    Icon(Icons.Filled.Edit, stringResource(R.string.lg_edit), tint = c.mutedFg, modifier = Modifier.size(18.dp))
                }
            }
        }
    } else {
        LaunchedEffect(series.id) { info = runCatching { api.series(series.id) }.getOrNull() }
        Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            LgTextField(label, { label = it }, placeholder = stringResource(R.string.lg_name))
            LgTextField(format, { format = it.uppercase() }, placeholder = stringResource(R.string.lg_format), mono = true)
            LgMenuPicker(listOf("YEAR" to stringResource(R.string.lg_yearly), "MONTH" to stringResource(R.string.lg_monthly)), reset, { reset = it })
            info?.let { i ->
                Text(stringResource(R.string.lg_series_info, i.issued, i.next) + if (i.issued > 0) " " + stringResource(R.string.lg_new_format_note) else "",
                    fontSize = 12.sp, color = c.mutedFg)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                NxButton(stringResource(R.string.save), { patch(lgBody("label" to label, "format" to format, "resetPeriod" to (reset ?: "YEAR"))) { editing = false } },
                    kind = NxButtonKind.PRIMARY, icon = Icons.Filled.Check, compact = true, enabled = !saving)
                NxButton(stringResource(R.string.cancel), { editing = false }, kind = NxButtonKind.GHOST, icon = Icons.Filled.Close, compact = true)
            }
        }
    }
}

@Composable
private fun NewSeriesRow(companyId: String, onDone: (Boolean) -> Unit) {
    val api = rememberLegalApi()
    val ctx = LocalContext.current
    val c = Nx.colors
    val scope = rememberCoroutineScope()
    var docType by remember { mutableStateOf<String?>("SURAT") }
    var label by remember { mutableStateOf("") }
    var format by remember { mutableStateOf("{SEQ:3}/{CO}/{ROMAWI}/{YYYY}") }
    var reset by remember { mutableStateOf<String?>("YEAR") }
    var adding by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.4f)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // An invoice counter restarts every month.
        LgMenuPicker(lgDocTypeOptions(), docType, { docType = it; if (it == "INVOICE") reset = "MONTH" })
        LgTextField(label, { label = it }, placeholder = stringResource(R.string.lg_series_name_hint))
        LgTextField(format, { format = it.uppercase() }, placeholder = stringResource(R.string.lg_format), mono = true)
        LgMenuPicker(listOf("YEAR" to stringResource(R.string.lg_yearly), "MONTH" to stringResource(R.string.lg_monthly)), reset, { reset = it })
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NxButton(stringResource(R.string.lg_add), {
                adding = true
                scope.launch {
                    try {
                        api.addSeries(companyId, docType ?: "SURAT", label.trim(), format, reset ?: "YEAR")
                        LegalToasts.success(ctx.getString(R.string.lg_series_added)); onDone(true)
                    } catch (e: ApiError) { LegalToasts.failure(ctx, e) }
                    adding = false
                }
            }, kind = NxButtonKind.PRIMARY, compact = true, enabled = label.isNotBlank() && !adding)
            NxButton(stringResource(R.string.cancel), { onDone(false) }, kind = NxButtonKind.GHOST, compact = true)
        }
    }
}
