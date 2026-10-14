package id.znetworks.nexus.feature.auth

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Which card the signed-out screen shows. Sign-up and reset each have a "code" second step. */
enum class AuthMode { LOGIN, SIGNUP, SIGNUP_CODE, FORGOT, FORGOT_CODE }

data class LoginUiState(
    val mode: AuthMode = AuthMode.LOGIN,
    /** Came from an invite: the reset flow reads "Set your password" (audit R12, iOS ResetPasswordView). */
    val invited: Boolean = false,
    val email: String = "",
    val password: String = "",
    val name: String = "",
    val workspaceCode: String = "",
    val code: String = "",
    val newPassword: String = "",
    /** The server's canonical email for the code steps. */
    val codeEmail: String = "",
    val resendIn: Int = 0,
    val busy: Boolean = false,
    val error: String? = null,
    val info: String? = null,
)

class LoginViewModel(app: Application) : AndroidViewModel(app) {
    private val c = (app as NexusApplication).container
    private val auth = c.auth
    private val account = AccountApi(c.api)
    private val res get() = getApplication<Application>().resources

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()
    private var countdown: Job? = null

    fun onEmail(v: String) = _state.update { it.copy(email = v, error = null) }
    fun onPassword(v: String) = _state.update { it.copy(password = v, error = null) }
    fun onName(v: String) = _state.update { it.copy(name = v, error = null) }
    fun onWorkspaceCode(v: String) = _state.update { it.copy(workspaceCode = v, error = null) }
    fun onCode(v: String) = _state.update { it.copy(code = v.filter(Char::isDigit).take(6), error = null) }
    fun onNewPassword(v: String) = _state.update { it.copy(newPassword = v, error = null) }

    /** Switching cards keeps the email (typed once), drops secrets and messages. */
    fun go(mode: AuthMode) = _state.update { it.copy(mode = mode, error = null, info = null, code = "", newPassword = "") }

    /** The invite email's "set your password" link lands here with the address filled in. */
    fun openReset(email: String?, invited: Boolean = false) = _state.update { it.copy(mode = AuthMode.FORGOT, email = email ?: it.email, invited = invited, error = null, info = null) }

    fun openRegister(code: String?) = _state.update { it.copy(mode = AuthMode.SIGNUP, workspaceCode = code ?: it.workspaceCode, error = null, info = null) }

    fun submit() {
        val s = _state.value
        if (s.busy) return
        val email = s.email.trim()
        if (email.isEmpty() || s.password.isEmpty()) {
            _state.update { it.copy(error = res.getString(R.string.lg_fill_both)) }
            return
        }
        run {
            try {
                auth.login(email, s.password)
                // Success: the session flow flips the root to the signed-in shell.
                _state.update { it.copy(password = "") }
            } catch (e: ApiError) {
                // Wrong credentials: the body only says "CredentialsSignin", no sentence for a person.
                _state.update { it.copy(error = when {
                    LoginErrors.deactivated(e) -> res.getString(R.string.off_deactivated)
                    e is ApiError.Http && e.status == 401 -> res.getString(R.string.lg_wrong)
                    else -> e.describe(res)
                }) }
            }
        }
    }

    fun passkey(activity: Context) = run {
        try {
            auth.signedInWith(account.passkeyLogin(activity))
        } catch (e: PasskeyCancelled) {
            // Closing the sheet is a normal thing to do.
        } catch (e: NoPasskey) {
            _state.update { it.copy(error = res.getString(R.string.passkey_none)) }
        } catch (e: ApiError) {
            _state.update { it.copy(error = when {
                LoginErrors.deactivated(e) -> res.getString(R.string.off_deactivated)
                e is ApiError.Http && e.status == 401 -> res.getString(R.string.passkey_failed)
                else -> e.describe(res)
            }) }
        } catch (e: Exception) {
            _state.update { it.copy(error = res.getString(R.string.passkey_failed)) }
        }
    }

    // region sign-up

    fun signupStart() {
        val s = _state.value
        when {
            s.name.isBlank() || s.email.isBlank() -> return say(R.string.signup_fill)
            s.password.length < 8 -> return say(R.string.password_min)
        }
        run {
            try {
                val sent = account.registerStart(s.name, s.email, s.password, s.workspaceCode)
                _state.update { it.copy(mode = AuthMode.SIGNUP_CODE, codeEmail = sent.email, code = "") }
                startCountdown(sent.cooldownSeconds)
            } catch (e: ApiError) { fail(e, signup = true) }
        }
    }

    fun signupVerify() {
        val s = _state.value
        if (s.code.length != 6) return say(R.string.code_six)
        run {
            try {
                account.registerVerify(s.codeEmail, s.code, s.workspaceCode)
                // Verify creates the account but does not sign in: the same email and password do.
                auth.login(s.codeEmail, s.password)
            } catch (e: ApiError) { fail(e) }
        }
    }

    fun signupResend() = run {
        try { startCountdown(account.registerResend(_state.value.codeEmail).cooldownSeconds); tell(R.string.code_resent) } catch (e: ApiError) { fail(e) }
    }

    // endregion

    // region reset

    fun resetRequest() {
        val email = _state.value.email.trim()
        if (email.isEmpty()) return say(R.string.reset_need_email)
        run {
            try {
                val sent = account.resetRequest(email)
                // Same answer whether or not the account exists (no probing): the code step either way.
                _state.update { it.copy(mode = AuthMode.FORGOT_CODE, codeEmail = sent.email, code = "") }
                startCountdown(sent.cooldownSeconds)
            } catch (e: ApiError) { fail(e) }
        }
    }

    fun resetVerify() {
        val s = _state.value
        when {
            s.code.length != 6 -> return say(R.string.code_six)
            s.newPassword.length < 8 -> return say(R.string.password_min)
        }
        run {
            try {
                account.resetVerify(s.codeEmail, s.code, s.newPassword)
                _state.update { it.copy(mode = AuthMode.LOGIN, email = s.codeEmail, password = "", info = res.getString(R.string.reset_done)) }
            } catch (e: ApiError) { fail(e) }
        }
    }

    fun resetResend() = run {
        try { startCountdown(account.resetResend(_state.value.codeEmail).cooldownSeconds); tell(R.string.code_resent) } catch (e: ApiError) { fail(e) }
    }

    // endregion

    private fun say(msg: Int) = _state.update { it.copy(error = res.getString(msg), info = null) }
    private fun tell(msg: Int) = _state.update { it.copy(info = res.getString(msg), error = null) }

    private fun run(block: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null, info = null) }
        viewModelScope.launch {
            try { block() } finally { _state.update { it.copy(busy = false) } }
        }
    }

    /** The server's sentence, the first field error on sign-up, and a named wait counted down. */
    private fun fail(e: ApiError, signup: Boolean = false) {
        val http = e as? ApiError.Http
        val msg = (if (signup) AccountApi.firstValidationMessage(http?.body) else null) ?: e.describe(res)
        val left = AccountApi.attemptsRemaining(http?.body)
        _state.update { it.copy(error = if (left != null) res.getString(R.string.code_attempts_left, msg, left) else msg) }
        AccountApi.retryAfter(http?.body)?.let(::startCountdown)
    }

    private fun startCountdown(seconds: Int) {
        countdown?.cancel()
        _state.update { it.copy(resendIn = seconds) }
        countdown = viewModelScope.launch {
            while (_state.value.resendIn > 0) { delay(1_000); _state.update { it.copy(resendIn = it.resendIn - 1) } }
        }
    }
}

/** Sign-in answers that need their own sentence. */
object LoginErrors {
    /** An offboarded account (owner, 8 Oct): 401 `{ error: "AccountDeactivated" }` from app-login and passkey verify. */
    fun deactivated(e: Throwable): Boolean {
        val h = e as? ApiError.Http ?: return false
        if (h.status != 401) return false
        val err = (h.body?.get("error") as? kotlinx.serialization.json.JsonPrimitive)?.takeIf { it.isString }?.content
        return err == "AccountDeactivated" || h.code == "ACCOUNT_DEACTIVATED"
    }
}

