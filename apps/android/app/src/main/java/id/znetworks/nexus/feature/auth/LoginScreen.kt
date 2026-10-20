package id.znetworks.nexus.feature.auth

import id.znetworks.nexus.ui.components.NxOutlinedButton

import id.znetworks.nexus.ui.components.NxTextField

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.filled.Key
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
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
 * Copy as the dev web (13 Oct 2026): Email, Password, Sign in, "Secure sign-in".
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
    val activity = context.findActivity()
    // Links that belong to the signed-out screens (API.md §3.3), held by the router until here.
    val router = (context.applicationContext as id.znetworks.nexus.NexusApplication).container.router
    val pending by router.pending.collectAsStateWithLifecycle()
    androidx.compose.runtime.LaunchedEffect(pending) {
        when (val t = pending) {
            is id.znetworks.nexus.core.nav.Target.ResetPassword -> { router.consumed(t); vm.openReset(t.email, t.invited) }
            is id.znetworks.nexus.core.nav.Target.Register -> { router.consumed(t); vm.openRegister(t.workspaceCode) }
            else -> Unit
        }
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
                        // Opaque: through a translucent card the elevation shadow shows as a pale
                        // rectangle (no frosted-glass material on Android to hide it, unlike iOS).
                        .background(Color.White, RoundedCornerShape(38.dp))
                        .border(1.dp, Color.White.copy(alpha = 0.65f), RoundedCornerShape(38.dp))
                        .padding(horizontal = 30.dp, vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Image(painterResource(R.drawable.nexus_mark), contentDescription = null, Modifier.size(72.dp))
                    Spacer(Modifier.height(22.dp))
                    Text("NEXUS PHAËTHON", fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 22.sp,
                        letterSpacing = 4.sp, color = c.onyx)
                    Spacer(Modifier.height(30.dp))

                    when (state.mode) {
                        AuthMode.LOGIN -> {
                            // The web's sign-in card (routes/login.tsx): Email, Password with "Forgot password?" beside
                            // its label, Sign in, "or", a passkey, then "New here? Request access".
                            FieldLabel(stringResource(R.string.lg_email))
                            NxField(
                                value = state.email, onChange = vm::onEmail, placeholder = stringResource(R.string.lg_email_ph),
                                keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                                actions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                            )
                            Spacer(Modifier.height(18.dp))
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.weight(1f)) { FieldLabel(stringResource(R.string.lg_password)) }
                                Text(stringResource(R.string.lg_forgot).uppercase(), style = FieldLabelStyle, color = c.onyx,
                                    modifier = Modifier.padding(bottom = 7.dp).clickable(enabled = !state.busy) { vm.go(AuthMode.FORGOT) })
                            }
                            NxField(
                                value = state.password, onChange = vm::onPassword, placeholder = "••••••••", secret = true,
                                keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                                actions = KeyboardActions(onGo = { focus.clearFocus(); vm.submit() }),
                            )
                            Messages(state)
                            Spacer(Modifier.height(26.dp))
                            PrimaryButton(stringResource(R.string.lg_sign_in), state.busy, arrow = true) { focus.clearFocus(); vm.submit() }
                            // Passkeys belong to nexus.znetworks.id (their RP id): not offered on the DEV server.
                            if (NexusConfig.env == id.znetworks.nexus.core.net.ServerEnv.PRODUCTION) {
                                Row(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Box(Modifier.weight(1f).height(1.dp).background(c.border))
                                    Text(stringResource(R.string.lg_or).uppercase(), style = FieldLabelStyle, color = c.mutedFg, modifier = Modifier.padding(horizontal = 12.dp))
                                    Box(Modifier.weight(1f).height(1.dp).background(c.border))
                                }
                                NxOutlinedButton(onClick = { activity?.let(vm::passkey) }, enabled = !state.busy && activity != null, shape = RoundedCornerShape(16.dp),
                                    border = androidx.compose.foundation.BorderStroke(1.dp, c.border), modifier = Modifier.fillMaxWidth().height(50.dp)) {
                                    Icon(Icons.Filled.Key, null, Modifier.size(16.dp), tint = c.onyx)
                                    Spacer(Modifier.size(8.dp))
                                    Text(stringResource(R.string.lg_passkey), color = c.onyx, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                                }
                            }
                            Spacer(Modifier.height(10.dp))
                            TextButton(onClick = { vm.go(AuthMode.SIGNUP) }, enabled = !state.busy) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(stringResource(R.string.lg_new_here), color = c.mutedFg, fontFamily = TextFont, fontSize = 14.sp)
                                    Spacer(Modifier.size(5.dp))
                                    Text(stringResource(R.string.lg_request_access), color = c.onyx, fontFamily = TextFont,
                                        fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                }
                            }
                            // Signed out on the DEV server (DEV-REDESIGN.md): the way back to Production.
                            if (NexusConfig.env == id.znetworks.nexus.core.net.ServerEnv.DEV) {
                                var toProd by androidx.compose.runtime.saveable.rememberSaveable { androidx.compose.runtime.mutableStateOf(false) }
                                TextButton(onClick = { toProd = true }, enabled = !state.busy) {
                                    Text(stringResource(R.string.login_server_dev), color = c.mutedFg, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                }
                                if (toProd) id.znetworks.nexus.ui.components.ServerSwitchDialog(id.znetworks.nexus.core.net.ServerEnv.PRODUCTION) { toProd = false }
                            }
                        }
                        AuthMode.SIGNUP -> {
                            Title(stringResource(R.string.signup_title), stringResource(R.string.signup_sub))
                            FieldLabel(stringResource(R.string.signup_name))
                            NxField(state.name, vm::onName, stringResource(R.string.signup_name_ph),
                                keyboard = KeyboardOptions(imeAction = ImeAction.Next), actions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                            Spacer(Modifier.height(14.dp))
                            FieldLabel(stringResource(R.string.lg_email))
                            NxField(state.email, vm::onEmail, "name@company.com",
                                keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next, autoCorrectEnabled = false),
                                actions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                            Spacer(Modifier.height(14.dp))
                            FieldLabel(stringResource(R.string.lg_password))
                            NxField(state.password, vm::onPassword, stringResource(R.string.password_min_ph), secret = true,
                                keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Next),
                                actions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }))
                            Spacer(Modifier.height(14.dp))
                            FieldLabel(stringResource(R.string.signup_code))
                            NxField(state.workspaceCode, vm::onWorkspaceCode, stringResource(R.string.signup_code_ph),
                                keyboard = KeyboardOptions(imeAction = ImeAction.Go, autoCorrectEnabled = false),
                                actions = KeyboardActions(onGo = { focus.clearFocus(); vm.signupStart() }))
                            Text(stringResource(R.string.signup_code_help), fontSize = 11.sp, color = c.mutedFg, fontFamily = TextFont,
                                modifier = Modifier.fillMaxWidth().padding(start = 4.dp, top = 6.dp))
                            Messages(state)
                            Spacer(Modifier.height(22.dp))
                            PrimaryButton(stringResource(R.string.signup_send_code), state.busy) { focus.clearFocus(); vm.signupStart() }
                            BackToLogin(vm, state.busy)
                        }
                        AuthMode.SIGNUP_CODE, AuthMode.FORGOT_CODE -> {
                            val signup = state.mode == AuthMode.SIGNUP_CODE
                            Title(stringResource(R.string.code_title), stringResource(R.string.code_sub, state.codeEmail))
                            FieldLabel(stringResource(R.string.code_label))
                            NxField(state.code, vm::onCode, "123456",
                                keyboard = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = if (signup) ImeAction.Go else ImeAction.Next),
                                actions = KeyboardActions(onGo = { focus.clearFocus(); vm.signupVerify() }, onNext = { focus.moveFocus(FocusDirection.Down) }))
                            if (!signup) {
                                Spacer(Modifier.height(14.dp))
                                FieldLabel(stringResource(R.string.reset_new_password))
                                NxField(state.newPassword, vm::onNewPassword, stringResource(R.string.password_min_ph), secret = true,
                                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                                    actions = KeyboardActions(onGo = { focus.clearFocus(); vm.resetVerify() }))
                            }
                            Messages(state)
                            Spacer(Modifier.height(22.dp))
                            PrimaryButton(stringResource(if (signup) R.string.signup_create else R.string.reset_set), state.busy) {
                                focus.clearFocus(); if (signup) vm.signupVerify() else vm.resetVerify()
                            }
                            TextButton(onClick = { if (signup) vm.signupResend() else vm.resetResend() }, enabled = !state.busy && state.resendIn == 0) {
                                Text(if (state.resendIn > 0) stringResource(R.string.code_resend_in, state.resendIn) else stringResource(R.string.code_resend),
                                    color = c.mutedFg, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            }
                            BackToLogin(vm, state.busy)
                        }
                        AuthMode.FORGOT -> {
                            Title(stringResource(if (state.invited) R.string.set_title else R.string.reset_title), stringResource(if (state.invited) R.string.set_sub else R.string.reset_sub))
                            FieldLabel(stringResource(R.string.lg_email))
                            NxField(state.email, vm::onEmail, "name@company.com",
                                keyboard = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                                actions = KeyboardActions(onGo = { focus.clearFocus(); vm.resetRequest() }))
                            Messages(state)
                            Spacer(Modifier.height(22.dp))
                            PrimaryButton(stringResource(R.string.signup_send_code), state.busy) { focus.clearFocus(); vm.resetRequest() }
                            BackToLogin(vm, state.busy)
                        }
                    }
                }
                Text(
                    stringResource(R.string.lg_secure),
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
    NxTextField(
        value = value, onValueChange = onChange, singleLine = true,
        placeholder = { Text(placeholder, color = c.mutedFg, fontFamily = TextFont) },
        visualTransformation = if (secret) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = keyboard, keyboardActions = actions,
        shape = RoundedCornerShape(12.dp),
        textStyle = androidx.compose.ui.text.TextStyle(fontFamily = TextFont, fontSize = 16.sp, color = c.foreground),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = c.muted, unfocusedContainerColor = c.muted,
            focusedBorderColor = c.onyx.copy(alpha = 0.5f), unfocusedBorderColor = c.border,
            cursorColor = c.onyx,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun Title(title: String, sub: String) {
    val c = Nx.colors
    Text(title, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = c.onyx, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(4.dp))
    Text(sub, fontFamily = TextFont, fontSize = 13.sp, color = c.mutedFg, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(18.dp))
}

@Composable
private fun Messages(state: LoginUiState) {
    val c = Nx.colors
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
    state.info?.let { msg ->
        Spacer(Modifier.height(18.dp))
        Text(
            msg, color = c.success, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            modifier = Modifier.fillMaxWidth()
                .background(c.success.copy(alpha = 0.08f), RoundedCornerShape(16.dp))
                .border(1.dp, c.success.copy(alpha = 0.2f), RoundedCornerShape(16.dp))
                .padding(horizontal = 14.dp, vertical = 11.dp),
        )
    }
}

@Composable
private fun PrimaryButton(label: String, busy: Boolean, arrow: Boolean = false, onClick: () -> Unit) {
    val c = Nx.colors
    Button(
        onClick = onClick, enabled = !busy, shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.buttonColors(containerColor = c.onyx, disabledContainerColor = c.onyx.copy(alpha = 0.7f),
            contentColor = Color.White, disabledContentColor = Color.White),
        modifier = Modifier.fillMaxWidth().height(54.dp),
    ) {
        if (busy) {
            CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
            Spacer(Modifier.size(8.dp))
            Text(stringResource(R.string.lg_signing_in), fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        } else {
            Text(label, fontFamily = DisplayFont, fontWeight = FontWeight.Bold, fontSize = 16.sp)
            if (arrow) { Spacer(Modifier.size(8.dp)); Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, Modifier.size(16.dp)) }
        }
    }
}

@Composable
private fun BackToLogin(vm: LoginViewModel, busy: Boolean) {
    TextButton(onClick = { vm.go(AuthMode.LOGIN) }, enabled = !busy) {
        Text(stringResource(R.string.back_to_login), color = Nx.colors.mutedFg, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    }
}

/** The Activity behind a (possibly wrapped, e.g. per-app locale) context: the passkey sheet needs one. */
fun android.content.Context.findActivity(): android.app.Activity? {
    var c: android.content.Context? = this
    while (c is android.content.ContextWrapper) {
        if (c is android.app.Activity) return c
        c = c.baseContext
    }
    return null
}
