package id.znetworks.nexus.feature.forms

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.AvatarStack
import id.znetworks.nexus.ui.theme.Nx

internal fun formEditorColor(value: String): Color = runCatching { Color(android.graphics.Color.parseColor(value)) }.getOrDefault(Color(0xFF8B5CF6))

@Composable internal fun FormEditors(editors: List<FormEditorPresence>) {
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        AvatarStack(editors.map { it.name to it.avatar }, max = 3)
        Text(stringResource(R.string.qa_form_editors, editors.joinToString(", ") { it.name }), color = Nx.colors.mutedFg, fontSize = 12.sp)
    }
}

@Composable internal fun FormQuestionEditors(editors: List<FormEditorPresence>) {
    if (editors.isEmpty()) return
    val first = editors.first()
    Text(if (editors.size == 1) stringResource(R.string.qa_form_editing, first.name) else stringResource(R.string.qa_form_editing_more, first.name, editors.size - 1),
        Modifier.background(formEditorColor(first.color).copy(alpha = .1f), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 4.dp), color = Nx.colors.foreground, fontSize = 12.sp)
}

/** The studio preview never creates a submission or navigates to the sending form. */
@Composable internal fun FormReadOnlyPreview(draft: FormStudioDraft) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        FormCoverBand(draft.branding)
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text(draft.name, color = Nx.colors.foreground, fontSize = 22.sp)
            if (draft.description.isNotBlank()) Text(draft.description, color = Nx.colors.mutedFg)
            draft.fields.forEach { QuestionPreview(it) }
        }
    }
}
