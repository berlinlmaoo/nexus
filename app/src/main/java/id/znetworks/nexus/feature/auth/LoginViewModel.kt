package id.znetworks.nexus.feature.auth

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.ui.components.describe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val busy: Boolean = false,
    val error: String? = null,
)

class LoginViewModel(app: Application) : AndroidViewModel(app) {
    private val auth = (app as NexusApplication).container.auth
    private val res get() = getApplication<Application>().resources

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    fun onEmail(v: String) = _state.update { it.copy(email = v, error = null) }
    fun onPassword(v: String) = _state.update { it.copy(password = v, error = null) }

    fun submit() {
        val s = _state.value
        if (s.busy) return
        val email = s.email.trim()
        if (email.isEmpty() || s.password.isEmpty()) {
            _state.update { it.copy(error = res.getString(R.string.login_fill_both)) }
            return
        }
        _state.update { it.copy(busy = true, error = null) }
        viewModelScope.launch {
            try {
                auth.login(email, s.password)
                // Success: the session flow flips the root to the signed-in shell.
                _state.update { it.copy(busy = false, password = "") }
            } catch (e: ApiError) {
                val msg = when {
                    // Wrong credentials. The body only says "CredentialsSignin", which is no
                    // sentence for a person.
                    e is ApiError.Http && e.status == 401 -> res.getString(R.string.login_failed)
                    else -> e.describe(res)
                }
                _state.update { it.copy(busy = false, error = msg) }
            }
        }
    }
}
