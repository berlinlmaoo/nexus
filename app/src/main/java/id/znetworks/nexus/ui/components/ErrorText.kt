package id.znetworks.nexus.ui.components

import android.content.res.Resources
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError

/**
 * The sentence a person sees for a failed call (API.md §1.7). The server's own sentence always
 * wins and is shown word for word: it is often Indonesian and already says what to do.
 */
fun ApiError.describe(res: Resources): String = when (this) {
    is ApiError.Http -> serverMessage
        ?: if (ApiError.isEdgeOnly(status)) res.getString(R.string.error_cant_reach)
        else res.getString(R.string.error_server_status, status)
    is ApiError.UpgradeRequired -> serverMessage ?: res.getString(R.string.update_required_title)
    is ApiError.Transport -> res.getString(R.string.error_cant_reach)
    is ApiError.Decoding -> res.getString(R.string.error_decoding)
    ApiError.Unauthorized -> res.getString(R.string.error_signed_out)
}
