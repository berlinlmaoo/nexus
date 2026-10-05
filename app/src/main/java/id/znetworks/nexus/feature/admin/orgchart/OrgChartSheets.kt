package id.znetworks.nexus.feature.admin.orgchart

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Business
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.VerticalAlignTop
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.feature.admin.AdminKeyboard
import id.znetworks.nexus.feature.admin.dismissKeyboardOnTapOrDrag
import id.znetworks.nexus.ui.components.Avatar
import id.znetworks.nexus.ui.components.describe
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val KIND_LABEL = mapOf("IP" to "IP / Perusahaan", "DIVISION" to "Divisi / Team", "GROUP" to "Grup")
private val KIND_SUB = mapOf("IP" to "Punya logo sendiri", "DIVISION" to "Tim kerja, tanpa logo", "GROUP" to "Cuma mengelompokkan kartu")
private fun kindIcon(kind: String): ImageVector = when (kind) { "IP" -> Icons.Filled.Business; "DIVISION" -> Icons.Filled.Groups; else -> Icons.Filled.GridView }

/** The web's guess for a new card's kind from the cards it will sit next to (a company under the top, a division under a company). */
fun guessKind(tree: OrgTree, parentId: String?): String {
    if (parentId == null) return "IP"
    val next = tree.units.filter { it.parentId == parentId && !it.isGroup }
    if (next.isNotEmpty()) return if (next.count { it.kind == "IP" } * 2 > next.size) "IP" else "DIVISION"
    val p = tree.byId[parentId]
    return if (p != null && p.parentId == null && !p.isGroup) "IP" else "DIVISION"
}

/** Who may lead a card under [parentId]: the BoD / OAA / Manager of the parent card — through groups, of the card above them. */
fun leadCard(tree: OrgTree, parentId: String?): String? {
    val seen = HashSet<String>()
    var p = parentId
    while (p != null && tree.byId[p]?.isGroup == true && seen.add(p)) p = tree.byId[p]?.parentId
    return p?.takeIf { tree.byId[it]?.isGroup == false }
}

@Composable
private fun SheetFrame(onClose: () -> Unit, header: @Composable () -> Unit, footer: @Composable RowScope.() -> Unit, body: @Composable () -> Unit) {
    val c = Nx.colors
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Column(Modifier.fillMaxSize().background(c.background).safeDrawingPadding().imePadding()) {
            header()
            HorizontalDivider(color = c.border)
            Column(Modifier.weight(1f).fillMaxWidth().dismissKeyboardOnTapOrDrag().verticalScroll(rememberScrollState()).padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(18.dp)) { body() }
            HorizontalDivider(color = c.border)
            Row(Modifier.fillMaxWidth().background(c.muted.copy(alpha = 0.3f)).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { footer() }
        }
    }
}

@Composable
private fun FieldLabel(text: String, hint: String? = null) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().padding(bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
        Text(text.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, letterSpacing = 0.9.sp, color = c.mutedFg, modifier = Modifier.weight(1f))
        hint?.let { Text(it, fontSize = 11.sp, color = c.mutedFg) }
    }
}

@Composable
private fun KindTile(kind: String, logoUrl: String?, size: Int) {
    if (kind == "IP" && logoUrl != null) { UnitLogo(logoUrl, null, size, RoundedCornerShape(8.dp)) { KindTile(kind, null, size) }; return }
    val c = Nx.colors
    val dark = c.background.luminance() < 0.5f
    val (bg, fg) = when (kind) {
        "IP" -> Color(0xFF1E3A5F) to Color.White
        "DIVISION" -> (if (dark) Color(0xFF1A2A41) else Color(0xFFEDF2F9)) to (if (dark) Color(0xFFDCE7F6) else Color(0xFF1E3A5F))
        else -> c.muted to c.mutedFg
    }
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(8.dp)).background(bg), contentAlignment = Alignment.Center) {
        Icon(kindIcon(kind), null, tint = fg, modifier = Modifier.size((size * 0.55f).dp))
    }
}

/**
 * Tambah atau ubah satu kartu (web UnitDialog): jenis, nama, logo (IP), letaknya, pemimpin, and the people
 * on the card with their title and who they sit under. Positions are never touched.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UnitSheet(tree: OrgTree, api: OrgChartApi, unit: OrgUnit?, parentId: String?, onAddChild: () -> Unit, onFocus: (() -> Unit)?, onClose: () -> Unit, onSaved: (String) -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val res = context.resources
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf(unit?.name ?: "") }
    var parent by remember { mutableStateOf(parentId) }
    var kind by remember { mutableStateOf(unit?.kind ?: guessKind(tree, parentId)) }
    var kindPicked by remember { mutableStateOf(unit != null) }
    var logo by remember { mutableStateOf(unit?.logoUrl) }
    var pendingLogo by remember { mutableStateOf<Triple<ByteArray, String, String>?>(null) }
    var lead by remember { mutableStateOf(unit?.leadUserId) }
    var saving by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var pickingParent by remember { mutableStateOf(false) }
    fun fail(e: Throwable) { problem = (e as? ApiError.Http)?.serverMessage ?: (e as? ApiError)?.describe(res) ?: "Coba lagi." }

    val leadUnit = leadCard(tree, parent)
    val viaGroup = parent != null && tree.byId[parent]?.isGroup == true
    val candidates = leadUnit?.let { lu -> tree.people.filter { lu in it.unitIds && it.isLead } } ?: emptyList()
    val leadValid = lead == null || candidates.any { it.userId == lead }
    val cardPeople = unit?.let { u -> tree.people.filter { u.id in it.unitIds } } ?: emptyList()
    val isGroup = kind == "GROUP"
    val groupBlocked = isGroup && unit?.kind != "GROUP" && cardPeople.isNotEmpty()
    val parentUnit = parent?.let(tree.byId::get)
    fun kindTitle(k: String) = if (k == "DIVISION" && parentUnit?.kind == "DIVISION") "Sub-divisi" else KIND_LABEL.getValue(k)
    val examples = tree.units.filter { it.kind == kind && it.id != unit?.id && (kind != "IP" || it.parentId != null) }.take(3).map { it.name }
    val members = unit?.let { tree.membersOf[it.id].orEmpty().size } ?: 0
    val subUnits = unit?.let { tree.childUnits[it.id].orEmpty().size } ?: 0
    val excluded = unit?.let { tree.descendantsOf(it.id).apply { add(it.id) } } ?: emptySet()

    val pickLogo = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        scope.launch {
            val mime = context.contentResolver.getType(uri) ?: "image/png"
            if (mime !in setOf("image/png", "image/jpeg", "image/webp")) { problem = "Logo harus PNG, JPG, atau WebP."; return@launch }
            val bytes = withContext(Dispatchers.IO) { runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull() }
            if (bytes == null) { problem = "File itu tidak bisa dibaca."; return@launch }
            if (bytes.size > 2 * 1024 * 1024) { problem = "Logo maksimal 2 MB."; return@launch }
            val fileName = runCatching { context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } }.getOrNull() ?: "logo"
            if (unit == null) { pendingLogo = Triple(bytes, mime, fileName); return@launch }
            uploading = true; problem = null
            try { logo = api.uploadLogo(unit.id, bytes, mime, fileName).logoUrl } catch (e: ApiError) { fail(e) }
            uploading = false
        }
    }
    fun save() {
        val clean = name.trim()
        if (clean.isEmpty()) { problem = "Namanya diisi dulu."; return }
        saving = true; problem = null
        scope.launch {
            try {
                val chosenLead = if (isGroup || !leadValid) null else lead
                if (unit != null) {
                    api.update(unit.id, name = clean, kind = kind, parentId = parent, setParent = true, leadUserId = chosenLead, setLead = true)
                    onSaved("Tersimpan")
                } else {
                    val made = api.create(clean, kind, parent)
                    if (chosenLead != null) api.update(made.id, leadUserId = chosenLead, setLead = true)
                    var note = "$clean ditambahkan"
                    val pl = pendingLogo
                    if (kind == "IP" && pl != null) runCatching { api.uploadLogo(made.id, pl.first, pl.second, pl.third) }
                        .onFailure { note = "$clean ditambahkan. Logo gagal diunggah — pasang lagi dari kartunya." }
                    onSaved(note)
                }
            } catch (e: ApiError) { fail(e); saving = false }
        }
    }

    val title = unit?.name ?: parentUnit?.let { "Tambah di bawah ${it.name}" } ?: "Tambah ke bagan"
    val subtitle = if (unit != null) listOfNotNull(kindTitle(unit.kind), "$members orang", if (subUnits > 0) "$subUnits di bawahnya" else null).joinToString(" · ")
        else "Pilih jenisnya, beri nama, lalu cek letaknya."

    SheetFrame(onClose, header = {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            KindTile(kind, if (pendingLogo != null) null else logo, 40)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(if (unit != null) "Ubah $title" else title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(subtitle, fontSize = 12.sp, color = c.mutedFg, maxLines = 2)
            }
            if (onFocus != null && unit != null) TextButton(onClick = onFocus) { Text("Lihat isinya", fontWeight = FontWeight.SemiBold, fontSize = 12.sp) }
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Tutup") }
        }
    }, footer = {
        if (unit != null) {
            TextButton(onClick = { confirmDelete = true }, enabled = !saving) { Text("Hapus", color = c.danger, fontWeight = FontWeight.SemiBold) }
            TextButton(onClick = onAddChild) { Text(if (unit.isGroup) "Tambah ke grup ini" else "Tambah di bawahnya", fontWeight = FontWeight.SemiBold) }
        } else TextButton(onClick = onClose) { Text("Batal") }
        Spacer(Modifier.weight(1f))
        Button(onClick = ::save, enabled = !saving && !groupBlocked) {
            if (saving) { CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White); Spacer(Modifier.width(6.dp)) }
            Text(if (unit != null) "Simpan" else "Tambah")
        }
    }) {
        problem?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger) }
        Column {
            FieldLabel(if (unit != null) "Jenis" else "Mau nambah apa?")
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("IP", "DIVISION", "GROUP").forEach { k ->
                    val on = kind == k
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(if (on) 2.dp else 1.dp, if (on) Color(0xFF1E3A5F) else c.border, RoundedCornerShape(12.dp))
                        .background(if (on) Color(0xFF1E3A5F).copy(alpha = 0.06f) else Color.Transparent).clickable { kind = k; kindPicked = true }.padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        KindTile(k, null, 26); Spacer(Modifier.width(10.dp))
                        Column {
                            Text(kindTitle(k), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                            Text(KIND_SUB.getValue(k), fontSize = 11.sp, color = c.mutedFg)
                        }
                    }
                }
            }
            if (examples.isNotEmpty()) Text("Contoh di bagan: ${examples.joinToString(", ")}", fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(top = 6.dp))
            if (isGroup) Text(
                if (groupBlocked) "Kartu ini masih berisi ${cardPeople.size} orang. Lepas orangnya dulu sebelum dijadikan Grup."
                else "Grup hanya mengelompokkan kartu — tanpa logo, tanpa orang, tanpa pemimpin. Isinya disusun otomatis di dalamnya.",
                fontSize = 11.sp, color = if (groupBlocked) c.danger else c.mutedFg,
                modifier = Modifier.padding(top = 8.dp).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (groupBlocked) c.danger.copy(alpha = 0.08f) else c.muted.copy(alpha = 0.6f)).padding(10.dp))
        }
        Column {
            FieldLabel("Nama")
            OutlinedTextField(name, { name = it.take(80) }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = AdminKeyboard.Done,
                placeholder = { Text(when (kind) { "IP" -> "Misal: PATS"; "GROUP" -> "Misal: Creative"; else -> "Misal: Multimedia" }) })
        }
        if (kind == "IP") Column {
            FieldLabel("Logo", "PNG, JPG, atau WebP · maks 2 MB")
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).background(c.muted.copy(alpha = 0.5f)), contentAlignment = Alignment.Center) {
                    if (pendingLogo != null) Icon(Icons.Filled.Check, null, tint = c.success)
                    else if (logo != null) UnitLogo(logo, null, 52, RoundedCornerShape(10.dp))
                    else Icon(Icons.Filled.Business, null, tint = c.mutedFg)
                }
                Spacer(Modifier.width(12.dp))
                Column {
                    Row {
                        TextButton(onClick = { pickLogo.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !uploading) {
                            if (uploading) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(if (logo != null || pendingLogo != null) "Ganti logo" else "Pasang logo")
                        }
                        if (logo != null || pendingLogo != null) TextButton(enabled = !uploading, onClick = {
                            if (unit == null) pendingLogo = null
                            else scope.launch { uploading = true; try { api.update(unit.id, logoRemoved = true); logo = null } catch (e: ApiError) { fail(e) }; uploading = false }
                        }) { Text("Hapus logo", color = c.mutedFg) }
                    }
                    Text(if (unit != null) "Sebaiknya persegi." else "Opsional, bisa juga nanti. Sebaiknya persegi.", fontSize = 11.sp, color = c.mutedFg)
                }
            }
        }
        Column {
            FieldLabel("Letaknya")
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, c.border, RoundedCornerShape(12.dp)).clickable { pickingParent = true }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                if (parentUnit != null) KindTile(parentUnit.kind, parentUnit.logoUrl, 28)
                else Box(Modifier.size(28.dp).clip(RoundedCornerShape(8.dp)).background(c.muted), contentAlignment = Alignment.Center) { Icon(Icons.Filled.VerticalAlignTop, null, tint = c.mutedFg, modifier = Modifier.size(16.dp)) }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(parentUnit?.name ?: "Paling atas", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(parentUnit?.let { tree.parentTrail(it).ifEmpty { "paling atas" } } ?: "tanpa induk", fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text("Ganti", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF1E3A5F))
            }
        }
        if (!isGroup && parent != null && candidates.isNotEmpty()) Column {
            FieldLabel("Dipimpin oleh", "opsional")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                LeadChip(lead == null || !leadValid, { lead = null }) { Text("Tidak ada", fontSize = 12.sp) }
                candidates.forEach { p ->
                    LeadChip(lead == p.userId, { lead = p.userId }) {
                        Avatar(p.name, p.avatar, 20.dp); Spacer(Modifier.width(6.dp))
                        Text(p.label, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.foreground)
                        Spacer(Modifier.width(4.dp))
                        Text(leadUnit?.let { p.titles[it] } ?: ROLE_SUB[p.role] ?: p.role, fontSize = 12.sp, color = c.mutedFg)
                    }
                }
            }
            Text((if (viaGroup) "Dari BoD/Manager ${leadUnit?.let(tree.byId::get)?.name ?: "kartu di atas grup"}. " else "") +
                "Kartu ini digambar di bawah orang yang dipilih, dan garisnya ditarik dari dia.", fontSize = 11.sp, color = c.mutedFg, modifier = Modifier.padding(top = 6.dp))
        }
        if (unit != null && !isGroup && cardPeople.isNotEmpty()) Column {
            FieldLabel("Orang di kartu ini · ${cardPeople.size}", "jabatan tampil di bagan")
            cardPeople.forEach { p -> TitleRow(api, p, unit.id, cardPeople.filter { it.userId != p.userId && it.isLead }, onError = { problem = it }) }
        }
    }
    if (pickingParent) ParentPicker(tree, parent, excluded, onPick = { id -> parent = id; if (!kindPicked) kind = guessKind(tree, id); pickingParent = false }) { pickingParent = false }
    if (confirmDelete && unit != null) AlertDialog(
        onDismissRequest = { confirmDelete = false },
        title = { Text("Hapus ${unit.name}?") },
        text = { Text((if (members > 0) "$members orang dilepas dari kartu ini (tetap di IP/Team lainnya). " else "") +
            (if (subUnits > 0) "$subUnits sub-IP/Team naik ke induknya. " else "") + "Tidak ada akses project yang berubah.") },
        confirmButton = { TextButton(onClick = {
            confirmDelete = false; saving = true
            scope.launch { try { api.delete(unit.id); onSaved("${unit.name} dihapus") } catch (e: ApiError) { fail(e); saving = false } }
        }) { Text("Hapus", color = c.danger, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Batal") } },
    )
}

@Composable
private fun LeadChip(on: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    val c = Nx.colors
    Row(Modifier.clip(CircleShape).border(if (on) 2.dp else 1.dp, if (on) Color(0xFF1E3A5F) else c.border, CircleShape)
        .background(if (on) Color(0xFF1E3A5F).copy(alpha = 0.07f) else Color.Transparent).clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically) { content() }
}

/** One person's title on one card (saved on Done / leaving the field; empty = none) and who they sit under. */
@Composable
private fun TitleRow(api: OrgChartApi, person: OrgPerson, unitId: String, leaders: List<OrgPerson>, onError: (String) -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    val initial = person.titles[unitId] ?: ""
    var v by remember(person.userId, unitId) { mutableStateOf(initial) }
    var saved by remember(person.userId, unitId) { mutableStateOf(initial) }
    var saving by remember { mutableStateOf(false) }
    var under by remember(person.userId, unitId) { mutableStateOf(person.reportsTo[unitId]) }
    var menu by remember { mutableStateOf(false) }
    fun saveTitle() {
        val next = v.trim()
        if (next == saved) return
        saving = true
        scope.launch {
            try { api.setTitle(person.userId, unitId, next.ifEmpty { null }); saved = next }
            catch (e: ApiError) { onError("Gagal menyimpan jabatan: " + ((e as? ApiError.Http)?.serverMessage ?: e.describe(res))); v = saved }
            saving = false
        }
    }
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(person.name, person.avatar, 28.dp); Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(person.label, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(ROLE_SUB[person.role] ?: person.role, fontSize = 11.sp, color = c.mutedFg)
        }
        OutlinedTextField(v, { v = it.take(40) }, singleLine = true, enabled = !saving, placeholder = { Text("Jabatan", fontSize = 12.sp) },
            textStyle = androidx.compose.ui.text.TextStyle(fontSize = 12.sp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { saveTitle() }),
            modifier = Modifier.width(110.dp).onFocusChanged { if (!it.isFocused) saveTitle() })
        if (!person.isBoD && leaders.isNotEmpty()) Box {
            TextButton(onClick = { menu = true }, enabled = !saving) {
                Text(leaders.firstOrNull { it.userId == under }?.label?.split(" ")?.first() ?: "— di bawah —", fontSize = 12.sp, maxLines = 1)
            }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem({ Text("— di bawah —") }, { menu = false; setUnder(api, person, unitId, null, scope, res, onError) { under = null } })
                leaders.forEach { l -> DropdownMenuItem({ Text(l.label) }, { menu = false; setUnder(api, person, unitId, l.userId, scope, res, onError) { under = l.userId } }) }
            }
        }
    }
}
private fun setUnder(api: OrgChartApi, person: OrgPerson, unitId: String, to: String?, scope: kotlinx.coroutines.CoroutineScope,
                     res: android.content.res.Resources, onError: (String) -> Unit, done: () -> Unit) {
    scope.launch {
        try { api.setReportsTo(person.userId, unitId, to); done() }
        catch (e: ApiError) { onError("Gagal menyimpan atasan: " + ((e as? ApiError.Http)?.serverMessage ?: e.describe(res))) }
    }
}

/** Where a card sits: the whole chart as an indented list (its own branch left out); typing filters by path. */
@Composable
private fun ParentPicker(tree: OrgTree, value: String?, excluded: Set<String>, onPick: (String?) -> Unit, onClose: () -> Unit) {
    val c = Nx.colors
    var q by remember { mutableStateOf("") }
    val rows = remember(tree, excluded) {
        val kids = tree.units.groupBy { if (it.parentId != null && tree.byId.containsKey(it.parentId)) it.parentId else null }.mapValues { (_, v) -> v.sortedWith(byPos) }
        val out = mutableListOf<Pair<OrgUnit, Int>>(); val seen = HashSet<String>()
        fun walk(p: String?, depth: Int) { for (u in kids[p].orEmpty()) { if (u.id in excluded || !seen.add(u.id)) continue; out += u to depth; walk(u.id, depth + 1) } }
        walk(null, 0); out
    }
    val needle = q.trim().lowercase()
    val shown = if (needle.isEmpty()) rows else rows.filter { (u, _) -> tree.pathOf(u).lowercase().contains(needle) }
    SheetFrame(onClose, header = {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text("Cari IP, divisi, atau grup…") }, modifier = Modifier.weight(1f), keyboardOptions = AdminKeyboard.Done)
            TextButton(onClick = onClose) { Text("Tutup") }
        }
    }, footer = {}) {
        Column {
            if (needle.isEmpty()) PickRow(value == null, 0, "Paling atas", "tanpa induk", { Icon(Icons.Filled.VerticalAlignTop, null, tint = c.mutedFg, modifier = Modifier.size(22.dp)) }) { onPick(null) }
            shown.forEach { (u, depth) ->
                PickRow(value == u.id, if (needle.isEmpty()) depth else 0, u.name,
                    if (needle.isNotEmpty()) tree.parentTrail(u).ifEmpty { null } else if (u.isGroup) "grup" else null, { KindTile(u.kind, u.logoUrl, 22) }) { onPick(u.id) }
            }
            if (shown.isEmpty()) Text("Nggak ada yang cocok.", fontSize = 12.sp, color = c.mutedFg, modifier = Modifier.padding(12.dp))
        }
    }
}

@Composable
private fun PickRow(selected: Boolean, depth: Int, label: String, sub: String?, icon: @Composable () -> Unit, onClick: () -> Unit) {
    val c = Nx.colors
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (selected) Color(0xFF1E3A5F).copy(alpha = 0.07f) else Color.Transparent)
        .clickable(onClick = onClick).padding(start = (8 + depth * 18).dp, end = 8.dp, top = 8.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        icon(); Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(label, fontSize = 14.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            sub?.let { Text(it, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        if (selected) Icon(Icons.Filled.Check, null, tint = Color(0xFF1E3A5F), modifier = Modifier.size(18.dp))
    }
}

/** A person (web UnitPicker): "Di bawah siapa" — every BoD/OAA/Manager per card — and the IP/Team checklist. Each tap saves at once. */
@Composable
fun PersonSheet(tree: OrgTree, api: OrgChartApi, person: OrgPerson, onChanged: (String) -> Unit, onClose: () -> Unit) {
    val c = Nx.colors
    val res = LocalContext.current.resources
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var q by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    // Local copy so a tap shows at once; the chart reloads behind.
    var unitIds by remember(person.userId) { mutableStateOf(person.unitIds.toSet()) }
    var reportsTo by remember(person.userId) { mutableStateOf(person.reportsTo) }
    val needle = q.trim().lowercase()
    fun run(msg: String, work: suspend () -> Unit, after: () -> Unit) {
        busy = true; problem = null
        scope.launch {
            try { work(); after(); onChanged(msg) }
            catch (e: ApiError) { problem = (e as? ApiError.Http)?.serverMessage ?: e.describe(res) }
            busy = false
        }
    }
    val canBeUnder = !person.isBoD
    val leaderRows = if (!canBeUnder) emptyList() else tree.people.filter { it.userId != person.userId && it.isLead }
        .flatMap { p -> p.unitIds.mapNotNull { uid -> tree.byId[uid]?.takeIf { !it.isGroup }?.let { Triple(p, it, p.titles[uid]) } } }
        .filter { (p, u, t) -> needle.isEmpty() || "${p.label} ${t ?: ""} ${u.name}".lowercase().contains(needle) }
        .sortedWith { a, b -> idCompare(a.first.label, b.first.label).takeIf { it != 0 } ?: idCompare(a.second.name, b.second.name) }
    val current = reportsTo.mapNotNull { (uid, lid) -> val u = tree.byId[uid]; val l = tree.people.firstOrNull { it.userId == lid }; if (u != null && l != null) Triple(uid, u, l) else null }
    val unitRows = tree.units.filter { !it.isGroup }.map { it to tree.pathOf(it) }.filter { needle.isEmpty() || it.second.lowercase().contains(needle) }.sortedWith { a, b -> idCompare(a.second, b.second) }

    SheetFrame(onClose, header = {
        Column(Modifier.fillMaxWidth().padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(person.name, person.avatar, 32.dp); Spacer(Modifier.width(10.dp))
                Text(person.label, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = c.foreground, modifier = Modifier.weight(1f))
                IconButton(onClick = onClose) { Icon(Icons.Filled.Close, "Tutup") }
            }
            Text("Taruh di bawah seseorang, atau centang IP/Team-nya. Tidak mengubah akses project.", fontSize = 11.sp, color = c.mutedFg)
            OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text("Cari nama, jabatan, atau IP/Team…") }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp), keyboardOptions = AdminKeyboard.Done)
        }
    }, footer = {
        Button(onClick = onClose, modifier = Modifier.fillMaxWidth()) { Text("Selesai") }
    }) {
        problem?.let { Text(it, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = c.danger) }
        if (canBeUnder) Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FieldLabel("Di bawah siapa")
            current.forEach { (uid, u, l) ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.violet.copy(alpha = 0.1f)).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Sekarang di bawah: ${l.name ?: l.label} · ${u.name}", fontSize = 12.sp, color = c.foreground, modifier = Modifier.weight(1f), maxLines = 2)
                    TextButton(enabled = !busy, onClick = { run("${person.name ?: "Orang"} tidak lagi di bawah siapa pun", { api.setReportsTo(person.userId, uid, null) }) { reportsTo = reportsTo - uid } }) {
                        Text("Lepas", color = c.danger, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            leaderRows.forEach { (l, u, t) ->
                val on = reportsTo[u.id] == l.userId
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (on) c.violet.copy(alpha = 0.1f) else Color.Transparent)
                    .clickable(enabled = !busy && !on) {
                        // "Di bawah siapa": into the leader's card first if needed, then under the leader.
                        run("${person.name ?: "Orang"} di bawah ${l.name ?: "atasannya"}", {
                            if (u.id !in unitIds) api.addMember(person.userId, u.id)
                            api.setReportsTo(person.userId, u.id, l.userId)
                        }) { unitIds = unitIds + u.id; reportsTo = reportsTo + (u.id to l.userId) }
                    }.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(l.name, l.avatar, 24.dp); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(l.label + (t?.let { " — $it" } ?: ""), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(u.name, fontSize = 11.sp, color = c.mutedFg, maxLines = 1)
                    }
                    if (on) Text("sekarang", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = c.violetText)
                }
            }
            if (leaderRows.isEmpty()) Text(if (needle.isNotEmpty()) "Nggak ada yang cocok." else "Belum ada BoD atau Manager di kartu mana pun.", fontSize = 12.sp, color = c.mutedFg)
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            FieldLabel("IP/Team")
            unitRows.forEach { (u, path) ->
                val on = u.id in unitIds
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (on) c.violet.copy(alpha = 0.08f) else Color.Transparent)
                    .clickable(enabled = !busy) {
                        if (on) run("${person.name ?: "Orang"} dilepas dari ${u.name}", { api.removeMember(person.userId, u.id) }) { unitIds = unitIds - u.id }
                        else run("${person.name ?: "Orang"} + ${u.name}", { api.addMember(person.userId, u.id) }) { unitIds = unitIds + u.id }
                    }.padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(on, null, enabled = !busy)
                    KindTile(u.kind, u.logoUrl, 24); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(u.name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val parent = path.substringBeforeLast(" › ", "")
                        if (parent.isNotEmpty()) Text(parent, fontSize = 11.sp, color = c.mutedFg, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (unitRows.isEmpty()) Text(if (tree.units.isEmpty()) "Belum ada IP/Team. Tambahkan dulu." else "Nggak ada yang cocok.", fontSize = 12.sp, color = c.mutedFg)
        }
    }
}
