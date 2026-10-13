package id.znetworks.nexus.feature.attendance

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull

/**
 * One fresh, high-accuracy fix per tap (REQ-ATT-06): never a cached `lastLocation` from before
 * the tap. Carries the signals the server's spoof check reads (REQ-ATT-09).
 */
class LocationProvider(private val context: Context) {

    sealed class Failure : Exception() {
        /** No location permission at all: only Settings can fix it. */
        class Denied : Failure()
        /** Only "approximate" granted (Android 12+): not enough to prove where the person is. */
        class ApproximateOnly : Failure()
        /** The device's location switch is off. */
        class ServicesOff : Failure()
        /** No fix in time (indoors, weak GPS). */
        class Unavailable : Failure()
    }

    fun hasFine(): Boolean = granted(Manifest.permission.ACCESS_FINE_LOCATION)
    fun hasCoarse(): Boolean = granted(Manifest.permission.ACCESS_COARSE_LOCATION)
    fun servicesOn(): Boolean {
        val lm = context.getSystemService(LocationManager::class.java) ?: return false
        return if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
        else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    @SuppressLint("MissingPermission")
    suspend fun currentFix(timeoutMs: Long = 20_000): LocationFix {
        if (!hasFine()) throw if (hasCoarse()) Failure.ApproximateOnly() else Failure.Denied()
        if (!servicesOn()) throw Failure.ServicesOff()
        val client = LocationServices.getFusedLocationProviderClient(context)
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setMaxUpdateAgeMillis(0) // fresh, never cached
            .setDurationMillis(timeoutMs)
            .build()
        val cancel = CancellationTokenSource()
        val location = try {
            withTimeoutOrNull(timeoutMs + 2_000) { client.getCurrentLocation(request, cancel.token).await() }
        } catch (e: SecurityException) {
            throw Failure.Denied()
        } catch (e: Exception) {
            null
        } finally {
            cancel.cancel()
        }
        return location?.toFix() ?: throw Failure.Unavailable()
    }

    /** Cheap, possibly stale fix for display only ("which office am I near"). Never sent. */
    @SuppressLint("MissingPermission")
    suspend fun roughFix(): LocationFix? {
        if (!hasFine() && !hasCoarse()) return null
        val client = LocationServices.getFusedLocationProviderClient(context)
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_BALANCED_POWER_ACCURACY)
            .setMaxUpdateAgeMillis(60_000)
            .setDurationMillis(10_000)
            .build()
        return runCatching { withTimeoutOrNull(12_000) { client.getCurrentLocation(request, null).await() } }
            .getOrNull()?.toFix()
    }

    private fun granted(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    companion object {
        fun Location.toFix() = LocationFix(
            lat = latitude,
            lng = longitude,
            accuracyM = if (hasAccuracy()) accuracy.toDouble() else null,
            altitudeM = if (hasAltitude()) altitude else null,
            speedMps = if (hasSpeed()) speed.toDouble() else null,
            simulated = isMockLocation(),
            capturedAtMillis = time,
        )

        @Suppress("DEPRECATION")
        private fun Location.isMockLocation(): Boolean =
            if (Build.VERSION.SDK_INT >= 31) isMock else isFromMockProvider
    }
}
