package id.znetworks.nexus.feature.auth

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.NexusConfig
import id.znetworks.nexus.ui.theme.DisplayFont
import id.znetworks.nexus.ui.theme.FieldLabelStyle
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.NexusLightTheme
import id.znetworks.nexus.ui.theme.TextFont

/**
 * Port of iOS `LoginView` (itself a port of the web login): cream background with soft glows,
 * frosted card, X mark, "NEXUS PHAËTHON", uppercase labels, onyx CTA, coral pill. Light-only.
 *
 * Sign-up, reset and passkeys are Phase 2 (PRD §3.1). Until then "Forgot password?" and "Create
 * account" open the web pages, so neither button is a dead end.
 */
@Composable
fun LoginScreen(vm: LoginViewModel = viewModel()) = NexusLightTheme {
    val state by vm.state.collectAsStateWithLifecycle()
    val focus = LocalFocusManager.current
    val context = LocalContext.current
    val c = Nx.colors
    fun openWeb(path: String) {
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(NexusConfig.PUBLIC_BASE + path))) }
    }

    Box(Modifier.fillMaxSize().background(c.cream)) {
        Glow(c.onyx.copy(alpha = 0.10f), (-150).dp, (-260).dp, 360.dp)
        Glow(c.coral.copy(alpha = 0.22f), 150.dp, 320.dp, 360.dp)
        Glow(Color(0xFFA78BFA).copy(alpha = 0.16f), 120.dp, (-120).dp, 260.dp)

        Column(
            Modifier.fillMaxSize().systemBarsPadding().imePadding().verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Box(Modifier.widthIn(max = 460.dp).padding(horizontal = 22.dp, vertical = 24.dp)) {
                Column(
                    Modifier
                        .fillMaxWidth()
                        .shadow(40.dp, RoundedCornerShape(38.dp), ambientColor = Color.Black.copy(alpha = 0.1f))
                        .background(Color.White.copy(alpha = 0.85f), RoundedCornerShape(38.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.65f), RoundedCornerShape(38.dp))
                        .padding(horizontal = 30.dp, vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Image(painterResource(R.drawable.nexus_mark), contentDescription = null, Modifier.size(72.dp))
                    Spacer(Modifier.height(22.dp))
                    Text("NEXUS PHAËTHON", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp,
                        letterSpacing = 4.sp, color = c.onyx)
                    Spacer(Modifier.height(30.dp))

                    FieldLabel(stringResource(R.string.login_email_label))
                    NxField(
                        value = state.email, onChange = vm::onEmail, placeholder = "commander@nexus.app",
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                        actions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                    )
                    Spacer(Modifier.height(18.dp))
                    FieldLabel(stringResource(R.string.login_password_label))
                    NxField(
                        value = state.password, onChange = vm::onPassword, placeholder = "••••••••", secret = true,
                        keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                        actions = KeyboardActions(onGo = { focus.clearFocus(); vm.submit() }),
                    )

                    state.error?.let { err ->
                        Spacer(Modifier.height(18.dp))
                        Text(
                            err, color = c.danger, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
                            modifier = Modifier.fillMaxWidth()
                                .background(Color(0xFFFEF2F2), RoundedCornerShape(16.dp))
                                .border(1.dp, c.danger.copy(alpha = 0.2f), RoundedCornerShape(16.dp))
                                .padding(horizontal = 14.dp, vertical = 11.dp),
                        )
                    }

                    Spacer(Modifier.height(26.dp))
                    Button(
                        onClick = { focus.clearFocus(); vm.submit() },
                        enabled = !state.busy,
                        shape = RoundedCornerShape(16.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = c.onyx, disabledContainerColor = c.onyx.copy(alpha = 0.7f),
                            contentColor = Color.White, disabledContentColor = Color.White),
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                    ) {
                        if (state.busy) {
                            CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(Modifier.size(8.dp))
                            Text(stringResource(R.string.login_busy), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        } else {
                            Text(stringResource(R.string.login_cta), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Spacer(Modifier.size(8.dp))
                            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, Modifier.size(16.dp))
                        }
                    }

                    Spacer(Modifier.height(22.dp))
                    TextButton(onClick = { openWeb("/register") }, enabled = !state.busy) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(R.string.login_new_to_nexus), color = c.mutedFg, fontFamily = TextFont, fontSize = 14.sp)
                            Spacer(Modifier.size(5.dp))
                            Text(stringResource(R.string.login_create_account), color = c.onyx, fontFamily = TextFont,
                                fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        }
                    }
                    TextButton(onClick = { openWeb("/forgot-password") }, enabled = !state.busy) {
                        Text(stringResource(R.string.login_forgot_password), color = c.mutedFg, fontFamily = TextFont,
                            fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                }
                Text(
                    "SECURE UPLINK READY",
                    color = Color.White, fontFamily = TextFont, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 2.sp,
                    modifier = Modifier.align(Alignment.BottomCenter).offset(y = 14.dp)
                        .background(c.coral, CircleShape).border(2.dp, Color.White, CircleShape)
                        .padding(horizontal = 16.dp, vertical = 7.dp),
                )
            }
        }
    }
}

@Composable
private fun Glow(color: Color, x: androidx.compose.ui.unit.Dp, y: androidx.compose.ui.unit.Dp, size: androidx.compose.ui.unit.Dp) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        // A radial gradient, not Modifier.blur: blur clips to the box (hard square edges) and does
        // nothing at all below Android 12, where most staff phones sit.
        Box(Modifier.offset(x, y).size(size * 1.6f).background(Brush.radialGradient(listOf(color, Color.Transparent))))
    }
}

@Composable
private fun FieldLabel(text: String) {
    Text(text, style = FieldLabelStyle, color = Nx.colors.mutedFg, modifier = Modifier.fillMaxWidth().padding(start = 4.dp, bottom = 7.dp))
}

@Composable
private fun NxField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String,
    keyboard: KeyboardOptions,
    actions: KeyboardActions,
    secret: Boolean = false,
) {
    val c = Nx.colors
    OutlinedTextField(
        value = value, onValueChange = onChange, singleLine = true,
        placeholder = { Text(placeholder, color = c.mutedFg, fontFamily = TextFont) },
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = keyboard, keyboardActions = actions,
        shape = RoundedCornerShape(16.dp),
        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = TextFont, fontSize = 16.sp, color = c.foreground),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Color.White.copy(alpha = 0.7f), unfocusedContainerColor = Color.White.copy(alpha = 0.7f),
            focusedBorderColor = c.onyx.copy(alpha = 0.5f), unfocusedBorderColor = Color.White,
            cursorColor = c.onyx,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}
